import type {
  CardLanguage,
  CatalogCoverage,
  CatalogSourcePolicy,
  CatalogUpdateRequest,
  CatalogUpdateResult,
  ReleaseRegion
} from '../shared/catalog'
import { CatalogDatabase } from './catalog-database'
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

const COMBINED_SOURCE_NAME = `${YGOPRODECK_SOURCE_NAME}＋${YGOCDB_SOURCE_NAME}`
const EARLIEST_MONTH: Record<ReleaseRegion, string> = { ocg: '1999-01', tcg: '2002-01' }

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

const requiredLanguageGaps = (
  card: CatalogImportRecord,
  localization: ChineseLocalization | undefined
): CardLanguage[] => {
  const gaps: CardLanguage[] = []
  if (!localization?.nameZh || !localization.ruleTextZh) gaps.push('zh')
  if (card.tcgReleaseDate && !(localization?.nameEn || card.name)) gaps.push('en')
  if (card.ocgReleaseDate && !localization?.nameJa) gaps.push('ja')
  return gaps
}

const countLanguageGaps = (analyses: Array<{ gaps: CardLanguage[] }>): Record<CardLanguage, number> => ({
  zh: analyses.filter((item) => item.gaps.includes('zh')).length,
  en: analyses.filter((item) => item.gaps.includes('en')).length,
  ja: analyses.filter((item) => item.gaps.includes('ja')).length
})

const formatLanguageGaps = (gaps: Record<CardLanguage, number>): string =>
  ([['zh', '中文'], ['en', '英文'], ['ja', '日文']] as const)
    .flatMap(([key, label]) => gaps[key] > 0 ? [`${label} ${gaps[key]} 張`] : [])
    .join('、')

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
  nameZh: localization.nameZh as string,
  nameJa: localization.nameJa ?? '',
  nameEn: localization.nameEn ?? card.name,
  ruleTextZh: localization.ruleTextZh as string,
  pendulumTextZh: localization.pendulumTextZh,
  localizationSourceName: `${YGOCDB_SOURCE_NAME} 中／日名稱＋${YGOPRODECK_SOURCE_NAME} 英文＋OpenCC 台灣正體`,
  localizationSourceUrl: localization.sourceUrl
})

export class CatalogUpdateService {
  private readonly metadataSource = new YgoprodeckSource()
  private readonly chineseSource = new YgocdbSource()

  constructor(private readonly database: CatalogDatabase) {}

  policies(): CatalogSourcePolicy[] {
    return [YGOPRODECK_POLICY, YGOCDB_POLICY]
  }

  async run(value: unknown): Promise<CatalogUpdateResult> {
    const request = validateCatalogUpdateRequest(value)
    return request.mode === 'through' ? this.runThrough(request) : this.runMonth(request)
  }

  private async runMonth(request: CatalogUpdateRequest): Promise<CatalogUpdateResult> {
    const totals = emptyTotals()
    const { result } = await this.metadataSource.fetchReleaseMonth(request)
    totals.metadataRequests = result.requestsUsed
    totals.skipped = result.skipped
    if (!result.complete) throw new Error('單月資料超過 YGOPRODeck 本次請求上限，請稍後重試。')

    const selected = result.records.slice(0, YGOCDB_POLICY.maxCardsPerRun)
    totals.fetched = selected.length
    const chinese = await this.chineseSource.localize(selected)
    totals.chineseRequests = chinese.requestsUsed
    const analyses = selected.map((card) => {
      const localization = chinese.localizations.get(card.passcode)
      return { card, localization, gaps: requiredLanguageGaps(card, localization) }
    })
    addLanguageGaps(totals, analyses)
    const localized = analyses.flatMap(({ card, localization, gaps }): CatalogImportRecord[] => {
      return localization == null || gaps.length > 0 ? [] : [applyLocalization(card, localization)]
    })
    totals.localized = localized.length
    if (localized.length > 0) {
      const imported = this.database.importSourceMonth(localized, request)
      totals.inserted = imported.inserted
      totals.updated = imported.updated
    }
    const limited = result.records.length > selected.length
    return this.buildResult(
      request,
      totals,
      limited || totals.missingRequiredLanguages > 0,
      totals.missingRequiredLanguages > 0 ? 'waiting-language' : limited ? 'chinese-card-limit' : 'complete',
      this.database.getCoverage(request.region)
    )
  }

  private async runThrough(request: CatalogUpdateRequest): Promise<CatalogUpdateResult> {
    const totals = emptyTotals()
    const target = monthKey(request.year, request.month)
    let coverage = this.database.getCoverage(request.region)
    let cursor = coverage.resumeMonth
      ?? (coverage.completeThrough ? afterCompletedDate(coverage.completeThrough) : EARLIEST_MONTH[request.region])

    if (cursor > target) {
      coverage = {
        ...coverage,
        targetMonth: target,
        status: 'complete',
        note: `指定範圍已完整收錄至 ${coverage.completeThrough ?? target}。`
      }
      this.database.saveCoverage(coverage)
      return this.buildResult(request, totals, false, 'complete', coverage)
    }

    let stoppedBy: CatalogUpdateResult['stoppedBy'] = 'complete'
    while (cursor <= target) {
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
      const { result } = await this.metadataSource.fetchReleaseMonth(monthRequest, remainingMetadataRequests)
      totals.metadataRequests += result.requestsUsed
      if (!result.complete) {
        stoppedBy = 'metadata-request-limit'
        coverage = this.limitCoverage(coverage, request.region, target, cursor, coverage.resumeMonth === cursor ? coverage.resumeOffset : 0, '月份尚未完整讀取，已在卡片結構來源上限前停止。')
        break
      }
      totals.skipped += result.skipped

      const offset = coverage.resumeMonth === cursor ? coverage.resumeOffset : 0
      const remainingCards = YGOCDB_POLICY.maxCardsPerRun - totals.fetched
      const remainingChineseRequests = YGOCDB_POLICY.maxRequestsPerRun - totals.chineseRequests
      const remainingChineseCapacity = remainingChineseRequests * YGOCDB_POLICY.batchSize
      const selected = result.records.slice(offset, offset + Math.min(remainingCards, remainingChineseCapacity))
      totals.fetched += selected.length

      if (selected.length > 0) {
        const chinese = await this.chineseSource.localize(selected)
        totals.chineseRequests += chinese.requestsUsed
        const analyses = selected.map((card) => {
          const localization = chinese.localizations.get(card.passcode)
          return { card, localization, gaps: requiredLanguageGaps(card, localization) }
        })
        const batchLanguageGaps = addLanguageGaps(totals, analyses)
        let localizedPrefixLength = 0
        while (
          localizedPrefixLength < selected.length &&
          analyses[localizedPrefixLength].gaps.length === 0
        ) localizedPrefixLength += 1

        const localized = analyses.flatMap(({ card, localization, gaps }): CatalogImportRecord[] => {
          return localization == null || gaps.length > 0 ? [] : [applyLocalization(card, localization)]
        })
        totals.localized += localized.length
        if (localized.length > 0) {
          const imported = this.database.importSourceMonth(localized, monthRequest)
          totals.inserted += imported.inserted
          totals.updated += imported.updated
        }
        if (localizedPrefixLength < selected.length) {
          stoppedBy = 'waiting-language'
          const completedCount = offset + localizedPrefixLength
          const advancedCoverage = this.advanceCompleteThrough(coverage, result.records, completedCount)
          coverage = {
            ...advancedCoverage,
            region: request.region,
            resumeMonth: cursor,
            resumeOffset: offset + localizedPrefixLength,
            targetMonth: target,
            status: 'waiting-language',
            note: `${cursor} 本批有 ${formatLanguageGaps(batchLanguageGaps)}尚未符合發行區域語系規則；其餘語系完整卡已匯入，續傳仍停在月內第 ${offset + localizedPrefixLength + 1} 張的第一個缺口。`
          }
          break
        }
      }

      const nextOffset = offset + selected.length
      if (nextOffset < result.records.length) {
        stoppedBy = 'chinese-card-limit'
        coverage = this.limitCoverage(
          this.advanceCompleteThrough(coverage, result.records, nextOffset),
          request.region,
          target,
          cursor,
          nextOffset,
          '已達中文來源的單次卡片上限。'
        )
        break
      }

      coverage = {
        region: request.region,
        completeThrough: endOfMonth(cursor),
        resumeMonth: null,
        resumeOffset: 0,
        targetMonth: target,
        status: cursor === target ? 'complete' : 'source-limit',
        note: cursor === target ? `已完整收錄至 ${endOfMonth(cursor)}。` : `已完整處理 ${cursor}，下次由 ${nextMonth(cursor)} 繼續。`
      }
      this.database.saveCoverage(coverage)
      cursor = nextMonth(cursor)
    }

    if (coverage.status !== 'complete') this.database.saveCoverage(coverage)
    return this.buildResult(request, totals, stoppedBy !== 'complete', stoppedBy, coverage)
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

  private advanceCompleteThrough(
    current: CatalogCoverage,
    chronologicalRecords: CatalogImportRecord[],
    completedCount: number
  ): CatalogCoverage {
    if (completedCount <= 0 || completedCount >= chronologicalRecords.length) return current
    const lastCompletedDate = chronologicalRecords[completedCount - 1]?.releaseDate
    const nextIncompleteDate = chronologicalRecords[completedCount]?.releaseDate
    if (
      !lastCompletedDate || !nextIncompleteDate || lastCompletedDate >= nextIncompleteDate ||
      (current.completeThrough != null && lastCompletedDate <= current.completeThrough)
    ) return current
    return { ...current, completeThrough: lastCompletedDate }
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
