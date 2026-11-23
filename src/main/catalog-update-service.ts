import type {
  CardLanguage,
  CatalogMissingField,
  CatalogCoverage,
  CatalogSourcePolicy,
  CatalogUpdateProgress,
  CatalogUpdateRequest,
  CatalogUpdateResult,
  ReleaseRegion
} from '../shared/catalog'
import type { CatalogDatabase, CatalogPendingRecord } from './catalog-database'
import {
  type CatalogImportRecord,
  validateCatalogUpdateRequest,
  YGOPRODECK_POLICY,
  YGOPRODECK_SOURCE_NAME,
  YgoprodeckSource
} from './ygoprodeck-source'
import {
  type ChineseLocalization,
  YGOCDB_POLICY,
  YGOCDB_SOURCE_NAME,
  YgocdbSource
} from './ygocdb-source'
import { YGORESOURCES_POLICY, YGORESOURCES_SOURCE_NAME, YgoresourcesSource } from './ygoresources-source'

const COMBINED_SOURCE_NAME = `${YGOPRODECK_SOURCE_NAME}＋${YGOCDB_SOURCE_NAME}＋${YGORESOURCES_SOURCE_NAME}`
const EARLIEST_MONTH: Record<ReleaseRegion, string> = { ocg: '1999-01', tcg: '2002-01' }

export interface CatalogRunOptions {
  signal?: AbortSignal
  onProgress?: (progress: CatalogUpdateProgress) => void
  repairRecords?: CatalogPendingRecord[]
}

interface RunTotals {
  fetched: number
  localized: number
  missingChinese: number
  missingRequiredLanguages: number
  languageGaps: Record<CardLanguage, number>
  inserted: number
  updated: number
  skipped: number
  metadataRequests: number
  chineseRequests: number
}

const emptyTotals = (): RunTotals => ({
  fetched: 0,
  localized: 0,
  missingChinese: 0,
  missingRequiredLanguages: 0,
  languageGaps: { zh: 0, en: 0, ja: 0 },
  inserted: 0,
  updated: 0,
  skipped: 0,
  metadataRequests: 0,
  chineseRequests: 0
})

const monthKey = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}`

const parseMonthKey = (value: string): { year: number; month: number } => {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) throw new Error('本機更新游標格式不正確。')
  return { year: Number(match[1]), month: Number(match[2]) }
}

const nextMonth = (value: string): string => {
  const { year, month } = parseMonthKey(value)
  return month === 12 ? monthKey(year + 1, 1) : monthKey(year, month + 1)
}

const endOfMonth = (value: string): string => {
  const { year, month } = parseMonthKey(value)
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${value}-${String(day).padStart(2, '0')}`
}

const afterCompletedDate = (value: string): string => nextMonth(value.slice(0, 7))

const missingFields = (
  card: CatalogImportRecord,
  localization: ChineseLocalization | undefined,
  region: ReleaseRegion
): CatalogMissingField[] => {
  const gaps: CatalogMissingField[] = []
  if (!localization?.nameZh) gaps.push('nameZh')
  if (!localization?.ruleTextZh) gaps.push('ruleTextZh')
  // OCG updates require only Chinese, including cards also released in the TCG.
  if (region !== 'ocg') {
    if (card.tcgReleaseDate && !(localization?.nameEn || card.name)) gaps.push('nameEn')
    if (card.ocgReleaseDate && !localization?.nameJa) gaps.push('nameJa')
  }
  return gaps
}

const countLanguageGaps = (analyses: Array<{ gaps: CardLanguage[] }>): Record<CardLanguage, number> => ({
  zh: analyses.filter((item) => item.gaps.includes('zh')).length,
  en: analyses.filter((item) => item.gaps.includes('en')).length,
  ja: analyses.filter((item) => item.gaps.includes('ja')).length
})

const addLanguageGaps = (
  totals: RunTotals,
  analyses: Array<{ gaps: CardLanguage[] }>
): Record<CardLanguage, number> => {
  const gaps = countLanguageGaps(analyses)
  totals.missingRequiredLanguages += analyses.filter((item) => item.gaps.length > 0).length
  totals.missingChinese += gaps.zh
  totals.languageGaps.zh += gaps.zh
  totals.languageGaps.en += gaps.en
  totals.languageGaps.ja += gaps.ja
  return gaps
}

const applyLocalization = (
  card: CatalogImportRecord,
  localization: ChineseLocalization
): CatalogImportRecord => ({
  ...card,
  konamiId: localization.konamiId ?? card.konamiId,
  nameZh: localization.nameZh ?? '',
  nameJa: localization.nameJa ?? '',
  nameEn: localization.nameEn ?? card.name,
  ruleTextZh: localization.ruleTextZh ?? '',
  pendulumTextZh: localization.pendulumTextZh,
  localizationSourceName: `${YGOCDB_SOURCE_NAME} 中／日名稱＋${YGOPRODECK_SOURCE_NAME} 英文＋OpenCC 台灣正體`,
  localizationSourceUrl: localization.sourceUrl
})

const applyFallbackLocalization = (
  card: CatalogImportRecord,
  localization: ChineseLocalization | undefined,
  fields: CatalogMissingField[]
): CatalogImportRecord => fields.length === 0 && localization
  ? applyLocalization(card, localization)
  : {
      ...card,
      nameZh: localization?.nameZh ?? card.name,
      nameJa: localization?.nameJa ?? '',
      nameEn: localization?.nameEn ?? card.name,
      ruleTextZh: localization?.ruleTextZh ?? card.ruleText,
      pendulumTextZh: localization?.pendulumTextZh ?? card.pendulumText,
      localizationSourceName: localization
        ? `${YGOCDB_SOURCE_NAME} 部分語系＋${YGOPRODECK_SOURCE_NAME} 英文暫代`
        : `${YGOPRODECK_SOURCE_NAME} 英文暫代`,
      localizationSourceUrl: localization?.sourceUrl ?? card.sourceUrl,
      localizationStatus: 'english-fallback'
    }

type UpdateDatabase = Pick<CatalogDatabase,
  'getCoverage' | 'saveCoverage' | 'importSourceMonth' | 'savePendingCards' | 'resolvePendingCards' | 'pendingRecords'
> & Partial<Pick<CatalogDatabase,
  'getMetaValue' | 'setMetaValue' | 'recordsNeedingLocalization' | 'refreshSourceRecords' |
  'passcodesNeedingSourceRefresh' | 'catalogPasscodes'
>>

type MetadataSource = Pick<YgoprodeckSource, 'fetchReleaseMonth'> & Partial<Pick<YgoprodeckSource,
  'fetchDatabaseVersion' | 'fetchInventory' | 'fetchByPasscodes'
>>

export class CatalogUpdateService {
  constructor(
    private readonly database: UpdateDatabase,
    private readonly metadataSource: MetadataSource = new YgoprodeckSource(),
    private readonly chineseSource: Pick<YgocdbSource, 'localize'> = new YgocdbSource(),
    private readonly artworkSource: (Pick<YgoresourcesSource, 'enrich'> & Partial<Pick<YgoresourcesSource, 'fetchVersion'>>) | null = new YgoresourcesSource()
  ) {}

  policies(): CatalogSourcePolicy[] {
    return [YGOPRODECK_POLICY, YGOCDB_POLICY, YGORESOURCES_POLICY]
  }

  repairQueue(request: CatalogUpdateRequest): CatalogPendingRecord[] {
    return this.database.pendingRecords(request.region, monthKey(request.year, request.month))
  }

  private saveCoverage(coverage: CatalogCoverage): CatalogCoverage {
    this.database.saveCoverage(coverage)
    return this.database.getCoverage(coverage.region)
  }

  private importLocalized(
    cards: CatalogImportRecord[], localizations: Map<string, ChineseLocalization>,
    request: CatalogUpdateRequest, totals: RunTotals, allowFallback = false
  ): void {
    const analyses = cards.map((card) => {
      const localization = localizations.get(card.passcode)
      const fields = missingFields(card, localization, request.region)
      const gaps = [...new Set(fields.map((field): CardLanguage => field === 'nameJa' ? 'ja' : field === 'nameEn' ? 'en' : 'zh'))]
      return { card, localization, fields, gaps }
    })
    addLanguageGaps(totals, analyses)
    // Persist incomplete payloads before advancing the scan cursor. Successful cards alone enter the catalog.
    this.database.savePendingCards(analyses.filter((item) => item.fields.length > 0).map((item) => ({
      card: item.localization ? applyLocalization(item.card, item.localization) : item.card,
      missingFields: item.fields,
      reason: item.localization ? '來源尚未提供必要欄位' : '中文來源未回傳此卡片',
      releaseMonth: monthKey(request.year, request.month)
    })), request.region)
    const importable = analyses.flatMap(({ card, localization, fields }): CatalogImportRecord[] => {
      if (localization && fields.length === 0) return [applyLocalization(card, localization)]
      return allowFallback ? [applyFallbackLocalization(card, localization, fields)] : []
    })
    if (importable.length > 0) {
      const imported = this.database.importSourceMonth(importable, request)
      totals.inserted += imported.inserted
      totals.updated += imported.updated
      const localized = analyses.filter((item) => item.localization && item.fields.length === 0).map((item) => item.card.passcode)
      totals.localized += localized.length
      this.database.resolvePendingCards(localized, request.region)
    }
  }

  async reconcileInventory(
    value: unknown,
    options: CatalogRunOptions = {},
    force = false
  ): Promise<CatalogUpdateResult | null> {
    const request = validateCatalogUpdateRequest(value)
    const fetchVersion = this.metadataSource.fetchDatabaseVersion
    const fetchInventory = this.metadataSource.fetchInventory
    const getMeta = this.database.getMetaValue
    const setMeta = this.database.setMetaValue
    const recordsNeedingLocalization = this.database.recordsNeedingLocalization
    const refreshSourceRecords = this.database.refreshSourceRecords
    const passcodesNeedingSourceRefresh = this.database.passcodesNeedingSourceRefresh
    const catalogPasscodes = this.database.catalogPasscodes
    if (!fetchVersion || !fetchInventory || !getMeta || !setMeta || !recordsNeedingLocalization || !refreshSourceRecords) return null

    const totals = emptyTotals()
    const version = await fetchVersion.call(this.metadataSource, options.signal)
    totals.metadataRequests += version.requestsUsed
    const versionKey = `inventory_${request.region}_ygoprodeck_version`
    const artworkManifestVersionKey = 'artwork_ygoresources_manifest_version'
    const artworkVersion = this.artworkSource?.fetchVersion
      ? await this.artworkSource.fetchVersion(options.signal)
      : null
    if (
      !force && getMeta.call(this.database, versionKey) === version.version &&
      (artworkVersion == null || getMeta.call(this.database, artworkManifestVersionKey) === artworkVersion.version)
    ) return null

    const inventory = await fetchInventory.call(
      this.metadataSource,
      request,
      YGOPRODECK_POLICY.maxRequestsPerRun - totals.metadataRequests,
      options.signal
    )
    totals.metadataRequests += inventory.result.requestsUsed
    totals.skipped += inventory.result.skipped
    if (!inventory.result.complete) throw new Error('全庫清冊超過本次來源請求上限，完整性檢查未寫入。')

    const inventoryByPasscode = new Map(inventory.result.records.map((card) => [card.passcode, card]))
    if (this.metadataSource.fetchByPasscodes && passcodesNeedingSourceRefresh) {
      const passcodes = new Set(passcodesNeedingSourceRefresh.call(this.database))
      catalogPasscodes?.call(this.database).forEach((passcode) => {
        if (!inventoryByPasscode.has(passcode)) passcodes.add(passcode)
      })
      if (passcodes.size > 0) {
        const lookup = await this.metadataSource.fetchByPasscodes.call(
          this.metadataSource,
          request,
          [...passcodes],
          YGOPRODECK_POLICY.maxRequestsPerRun - totals.metadataRequests,
          options.signal
        )
        totals.metadataRequests += lookup.result.requestsUsed
        totals.skipped += lookup.result.skipped
        if (!lookup.result.complete) throw new Error('定向來源補查超過本次請求上限，完整性檢查未寫入。')
        lookup.result.records.forEach((card) => inventoryByPasscode.set(card.passcode, card))
      }
    }
    const regionRecords = [...inventoryByPasscode.values()].filter((card) => card.releaseDate != null)
    const artworkInventory = this.artworkSource
      ? await this.artworkSource.enrich(regionRecords, options.signal)
      : { records: regionRecords, version: 'unavailable', requestsUsed: 0, cardsWithArtwork: 0, artworkCount: 0 }
    const candidates = recordsNeedingLocalization.call(this.database, artworkInventory.records)
    const selected = candidates.slice(0, YGOCDB_POLICY.maxCardsPerRun)
    const chinese = selected.length > 0
      ? await this.chineseSource.localize(selected, options.signal)
      : { localizations: new Map<string, ChineseLocalization>(), missingPasscodes: [], requestsUsed: 0 }
    totals.chineseRequests += chinese.requestsUsed
    totals.fetched = candidates.length
    totals.updated += refreshSourceRecords.call(this.database, artworkInventory.records, request)
    this.importLocalized(candidates, chinese.localizations, request, totals, true)

    setMeta.call(this.database, versionKey, version.version)
    setMeta.call(this.database, `inventory_${request.region}_audited_at`, new Date().toISOString())
    setMeta.call(this.database, `inventory_${request.region}_source_rows`, String(inventory.result.totalRows))
    setMeta.call(this.database, 'artwork_ygoresources_version', artworkInventory.version)
    setMeta.call(this.database, 'artwork_ygoresources_count', String(artworkInventory.artworkCount))
    if (artworkVersion) setMeta.call(this.database, artworkManifestVersionKey, artworkVersion.version)
    const coverage = this.database.getCoverage(request.region)
    options.onProgress?.(this.progress(request, coverage, monthKey(request.year, request.month), candidates.length, candidates.length, totals))
    return this.buildResult(request, totals, false, 'complete', coverage)
  }

  getProgress(request: CatalogUpdateRequest): CatalogUpdateProgress {
    const coverage = this.database.getCoverage(request.region)
    const cursor = request.mode !== 'through' ? monthKey(request.year, request.month) : this.cursor(coverage)
    return this.progress(request, coverage, cursor, request.mode === 'through' && coverage.resumeMonth === cursor ? coverage.resumeOffset : 0, null, emptyTotals())
  }

  private cursor(coverage: CatalogCoverage): string {
    return coverage.resumeMonth
      ?? (coverage.scannedThrough ? afterCompletedDate(coverage.scannedThrough) : EARLIEST_MONTH[coverage.region])
  }

  private progress(
    request: CatalogUpdateRequest, coverage: CatalogCoverage, currentMonth: string,
    monthProcessed: number, monthTotal: number | null, totals: RunTotals
  ): CatalogUpdateProgress {
    const index = (key: string): number => {
      const { year, month } = parseMonthKey(key)
      return year * 12 + month - 1
    }
    const target = monthKey(request.year, request.month)
    const start = request.mode === 'month' ? target : EARLIEST_MONTH[request.region]
    const totalMonths = Math.max(1, index(target) - index(start) + 1)
    const fraction = monthTotal == null ? 0 : monthTotal === 0 ? 1 : Math.min(1, monthProcessed / monthTotal)
    const done = Math.max(0, Math.min(totalMonths, index(currentMonth) - index(start) + fraction))
    return {
      currentMonth: currentMonth > target ? target : currentMonth,
      monthProcessed, monthTotal, completedMonths: Math.floor(done), totalMonths,
      percent: Math.min(100, done / totalMonths * 100), coverage: { ...coverage },
      fetched: totals.fetched, inserted: totals.inserted, updated: totals.updated, deferred: totals.missingRequiredLanguages
    }
  }

  async run(value: unknown, options: CatalogRunOptions = {}): Promise<CatalogUpdateResult> {
    const request = validateCatalogUpdateRequest(value)
    options.signal?.throwIfAborted()
    if (request.mode === 'repair') return this.runRepair(request, options)
    return request.mode === 'through' ? this.runThrough(request, options) : this.runMonth(request, options)
  }

  private async runMonth(request: CatalogUpdateRequest, options: CatalogRunOptions): Promise<CatalogUpdateResult> {
    const totals = emptyTotals()
    const { result } = await this.metadataSource.fetchReleaseMonth(request, undefined, options.signal)
    totals.metadataRequests = result.requestsUsed
    totals.skipped = result.skipped
    if (!result.complete) throw new Error('單月資料超過 YGOPRODeck 本次請求上限，請稍後重試。')

    const selected = result.records.slice(0, YGOCDB_POLICY.maxCardsPerRun)
    totals.fetched = selected.length
    options.onProgress?.(this.progress(request, this.database.getCoverage(request.region), monthKey(request.year, request.month), 0, result.records.length, totals))
    const chinese = await this.chineseSource.localize(selected, options.signal)
    options.signal?.throwIfAborted()
    totals.chineseRequests = chinese.requestsUsed
    this.importLocalized(selected, chinese.localizations, request, totals)
    const limited = result.records.length > selected.length
    options.onProgress?.(this.progress(request, this.database.getCoverage(request.region), monthKey(request.year, request.month), selected.length, result.records.length, totals))
    return this.buildResult(
      request,
      totals,
      limited,
      limited ? 'chinese-card-limit' : 'complete',
      this.database.getCoverage(request.region)
    )
  }

  private async runThrough(request: CatalogUpdateRequest, options: CatalogRunOptions): Promise<CatalogUpdateResult> {
    const totals = emptyTotals()
    const target = monthKey(request.year, request.month)
    let coverage = this.database.getCoverage(request.region)
    let cursor = this.cursor(coverage)
    let reportedMonth = cursor
    let reportedTotal: number | null = null
    const report = (processed: number, total: number | null): void => {
      if (reportedMonth !== cursor) { reportedMonth = cursor; reportedTotal = null }
      if (total != null) reportedTotal = total
      options.onProgress?.(this.progress(request, coverage, cursor, processed, reportedTotal, totals))
    }

    if (cursor > target) {
      const audited = await this.reconcileInventory(request, options)
      if (audited) return audited
      coverage = {
        ...coverage,
        targetMonth: target,
        status: 'complete',
        note: `指定範圍已掃描至 ${target}；未補齊的卡片另存缺漏清單。`
      }
      coverage = this.saveCoverage(coverage)
      report(0, null)
      return this.buildResult(request, totals, false, 'complete', coverage)
    }

    let stoppedBy: CatalogUpdateResult['stoppedBy'] = 'complete'
    months: while (cursor <= target) {
      options.signal?.throwIfAborted()
      report(coverage.resumeMonth === cursor ? coverage.resumeOffset : 0, null)
      if (totals.metadataRequests >= YGOPRODECK_POLICY.maxRequestsPerRun) {
        stoppedBy = 'metadata-request-limit'
        coverage = this.limitCoverage(coverage, request.region, target, cursor, 0, '已達卡片結構來源的單次請求上限。')
        break
      }
      if (totals.fetched >= YGOCDB_POLICY.maxCardsPerRun) {
        stoppedBy = 'chinese-card-limit'
        coverage = this.limitCoverage(coverage, request.region, target, cursor, 0, '已達中文來源的單次卡片上限。')
        break
      }
      if (totals.chineseRequests >= YGOCDB_POLICY.maxRequestsPerRun) {
        stoppedBy = 'chinese-card-limit'
        coverage = this.limitCoverage(coverage, request.region, target, cursor, 0, '已達中文來源的單次請求上限。')
        break
      }

      const { year, month } = parseMonthKey(cursor)
      const monthRequest: CatalogUpdateRequest = { mode: 'through', year, month, region: request.region }
      const remainingMetadataRequests = YGOPRODECK_POLICY.maxRequestsPerRun - totals.metadataRequests
      const { result } = await this.metadataSource.fetchReleaseMonth(monthRequest, remainingMetadataRequests, options.signal)
      options.signal?.throwIfAborted()
      totals.metadataRequests += result.requestsUsed
      if (!result.complete) {
        stoppedBy = 'metadata-request-limit'
        coverage = this.limitCoverage(coverage, request.region, target, cursor, coverage.resumeMonth === cursor ? coverage.resumeOffset : 0, '月份尚未完整讀取，已在卡片結構來源上限前停止。')
        break
      }
      totals.skipped += result.skipped

      let offset = coverage.resumeMonth === cursor ? coverage.resumeOffset : 0
      report(offset, result.records.length)
      while (offset < result.records.length) {
        options.signal?.throwIfAborted()
        const remainingCards = YGOCDB_POLICY.maxCardsPerRun - totals.fetched
        if (remainingCards <= 0 || totals.chineseRequests >= YGOCDB_POLICY.maxRequestsPerRun) {
          stoppedBy = 'chinese-card-limit'
          coverage = this.limitCoverage(coverage, request.region, target, cursor, offset, '已達中文來源的單批安全上限，等待下一批接續。')
          break months
        }
        // Save each source-sized chunk before starting another network request.
        const selected = result.records.slice(offset, offset + Math.min(remainingCards, YGOCDB_POLICY.batchSize))
        const chinese = await this.chineseSource.localize(selected, options.signal)
        options.signal?.throwIfAborted()
        totals.fetched += selected.length
        totals.chineseRequests += chinese.requestsUsed
        this.importLocalized(selected, chinese.localizations, monthRequest, totals)
        offset += selected.length
        coverage = this.limitCoverage(
          this.advanceScannedThrough(coverage, result.records, offset),
          request.region, target, cursor, offset, '已保存月內進度，可安全接續。'
        )
        coverage = this.saveCoverage(coverage)
        report(offset, result.records.length)
      }

      coverage = {
        region: request.region,
        completeThrough: endOfMonth(cursor),
        scannedThrough: endOfMonth(cursor),
        pendingCards: coverage.pendingCards,
        resumeMonth: null,
        resumeOffset: 0,
        targetMonth: target,
        status: cursor === target ? 'complete' : 'source-limit',
        note: cursor === target ? `已掃描至 ${endOfMonth(cursor)}；缺漏卡片另存清單，可日後補查。` : `已掃描 ${cursor}，接續 ${nextMonth(cursor)}；缺漏不影響後續更新。`
      }
      coverage = this.saveCoverage(coverage)
      report(result.records.length, result.records.length)
      cursor = nextMonth(cursor)
    }

    if (stoppedBy === 'complete') {
      const audited = await this.reconcileInventory(request, options)
      if (audited) return audited
    }

    if (stoppedBy !== 'complete') {
      coverage = this.saveCoverage(coverage)
      report(coverage.resumeMonth === cursor ? coverage.resumeOffset : 0, null)
    }
    return this.buildResult(request, totals, stoppedBy !== 'complete', stoppedBy, coverage)
  }

  private async runRepair(request: CatalogUpdateRequest, options: CatalogRunOptions): Promise<CatalogUpdateResult> {
    const totals = emptyTotals()
    const queue = options.repairRecords ?? this.repairQueue(request)
    const selected = queue.slice(0, YGOCDB_POLICY.maxCardsPerRun)
    for (let offset = 0; offset < selected.length; offset += YGOCDB_POLICY.batchSize) {
      options.signal?.throwIfAborted()
      const entries = selected.slice(offset, offset + YGOCDB_POLICY.batchSize)
      const localized = await this.chineseSource.localize(entries.map((entry) => entry.card), options.signal)
      options.signal?.throwIfAborted()
      totals.chineseRequests += localized.requestsUsed
      // Preserve each saved release month; no need to download the entire month's metadata again.
      for (const sourceMonth of new Set(entries.map((entry) => entry.releaseMonth))) {
        const monthRequest = { ...request, ...parseMonthKey(sourceMonth) }
        this.importLocalized(entries.filter((entry) => entry.releaseMonth === sourceMonth).map((entry) => entry.card), localized.localizations, monthRequest, totals)
      }
      totals.fetched += entries.length
      const progress = this.progress(request, this.database.getCoverage(request.region), entries.at(-1)!.releaseMonth, totals.fetched, selected.length, totals)
      options.onProgress?.({ ...progress, percent: selected.length ? totals.fetched / selected.length * 100 : 100 })
    }
    const limited = selected.length < queue.length
    return this.buildResult(request, totals, limited, limited ? 'chinese-card-limit' : 'complete', this.database.getCoverage(request.region))
  }

  private limitCoverage(
    current: CatalogCoverage,
    region: ReleaseRegion,
    targetMonth: string,
    resumeMonth: string,
    resumeOffset: number,
    note: string
  ): CatalogCoverage {
    return {
      ...current,
      region,
      resumeMonth,
      resumeOffset,
      targetMonth,
      status: 'source-limit',
      note
    }
  }

  private advanceScannedThrough(
    current: CatalogCoverage,
    chronologicalRecords: CatalogImportRecord[],
    completedCount: number
  ): CatalogCoverage {
    if (completedCount <= 0 || completedCount >= chronologicalRecords.length) return current
    const lastCompletedDate = chronologicalRecords[completedCount - 1]?.releaseDate
    const nextIncompleteDate = chronologicalRecords[completedCount]?.releaseDate
    if (
      !lastCompletedDate || !nextIncompleteDate || lastCompletedDate >= nextIncompleteDate ||
      (current.scannedThrough != null && lastCompletedDate <= current.scannedThrough)
    ) return current
    return { ...current, completeThrough: lastCompletedDate, scannedThrough: lastCompletedDate }
  }

  private buildResult(
    request: CatalogUpdateRequest,
    totals: RunTotals,
    limitReached: boolean,
    stoppedBy: CatalogUpdateResult['stoppedBy'],
    coverage: CatalogCoverage
  ): CatalogUpdateResult {
    return {
      sourceName: COMBINED_SOURCE_NAME,
      sourceUrl: YGOCDB_POLICY.guideUrl,
      region: request.region,
      mode: request.mode,
      year: request.year,
      month: request.month,
      fetched: totals.fetched,
      localized: totals.localized,
      missingChinese: totals.missingChinese,
      missingRequiredLanguages: totals.missingRequiredLanguages,
      languageGaps: totals.languageGaps,
      inserted: totals.inserted,
      updated: totals.updated,
      skipped: totals.skipped,
      limitReached,
      stoppedBy,
      pendingCards: coverage.pendingCards,
      releaseCompleteThrough: coverage.completeThrough,
      resumeMonth: coverage.resumeMonth,
      sourceRequests: [
        { sourceId: 'ygoprodeck', requests: totals.metadataRequests },
        { sourceId: 'ygocdb', requests: totals.chineseRequests }
      ],
      runCompletedAt: new Date().toISOString()
    }
  }
}
