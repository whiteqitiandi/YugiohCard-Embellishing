import type {
  CardFrame,
  CardKind,
  CatalogSourcePolicy,
  CatalogUpdateRequest,
  SpellTrapIcon
} from '../shared/catalog'
import { waitForUpdate } from './update-control'

export const YGOPRODECK_SOURCE_NAME = 'YGOPRODeck API v7'
export const YGOPRODECK_GUIDE_URL = 'https://ygoprodeck.com/api-guide/'

const CARD_ENDPOINT = 'https://db.ygoprodeck.com/api/v7/cardinfo.php'
const VERSION_ENDPOINT = 'https://db.ygoprodeck.com/api/v7/checkDBVer.php'
const PAGE_SIZE = 100
const INVENTORY_PAGE_SIZE = 500
const MAX_CARDS_PER_MONTH = 1_000
const MAX_INVENTORY_CARDS = 20_000
const REQUEST_INTERVAL_MS = 1_000
const RESPONSE_SIZE_LIMIT = 12 * 1024 * 1024

export const YGOPRODECK_POLICY: CatalogSourcePolicy = {
  id: 'ygoprodeck',
  name: YGOPRODECK_SOURCE_NAME,
  role: '卡片結構、英文名稱、OCG／TCG 發行日期與插圖清單',
  language: '英文結構資料',
  guideUrl: YGOPRODECK_GUIDE_URL,
  requestIntervalMs: REQUEST_INTERVAL_MS,
  batchSize: PAGE_SIZE,
  maxRequestsPerRun: 40,
  maxCardsPerRun: MAX_CARDS_PER_MONTH
}

interface YgoprodeckImage {
  id?: unknown
  image_url_cropped?: unknown
}

interface YgoprodeckMisc {
  konami_id?: unknown
  tcg_date?: unknown
  ocg_date?: unknown
}

interface YgoprodeckCard {
  id?: unknown
  name?: unknown
  type?: unknown
  frameType?: unknown
  desc?: unknown
  pend_desc?: unknown
  monster_desc?: unknown
  atk?: unknown
  def?: unknown
  level?: unknown
  race?: unknown
  attribute?: unknown
  archetype?: unknown
  scale?: unknown
  linkval?: unknown
  linkmarkers?: unknown
  ygoprodeck_url?: unknown
  card_images?: unknown
  misc_info?: unknown
}

interface YgoprodeckResponse {
  data?: unknown
  meta?: {
    total_rows?: unknown
    rows_remaining?: unknown
  }
  error?: unknown
}

export interface CatalogImportArtwork {
  id: string
  variantLabel: string
  sourceUrl: string
  sourceName?: string
  shardKey: string
}

export interface CatalogImportRecord {
  id: string
  remoteId: number
  passcode: string
  konamiId: number | null
  name: string
  kind: CardKind
  frame: CardFrame
  attribute: string
  race: string
  typeLine: string
  level: number | null
  rank: number | null
  linkRating: number | null
  linkArrows: number[]
  spellTrapIcon: SpellTrapIcon | null
  pendulumScaleLeft: number | null
  pendulumScaleRight: number | null
  pendulumText: string | null
  atk: number | null
  def: number | null
  ruleText: string
  archetype: string | null
  artworks: CatalogImportArtwork[]
  accent: string
  sourceUrl: string
  releaseDate: string | null
  ocgReleaseDate: string | null
  tcgReleaseDate: string | null
  nameZh?: string
  nameJa?: string
  nameEn?: string
  ruleTextZh?: string
  pendulumTextZh?: string | null
  localizationSourceName?: string
  localizationSourceUrl?: string
  localizationStatus?: 'zh-tw-converted' | 'english-fallback'
}

export interface SourceMonthResult {
  records: CatalogImportRecord[]
  skipped: number
  complete: boolean
  requestsUsed: number
}

export interface SourceInventoryResult extends SourceMonthResult {
  totalRows: number
}

export interface SourceDatabaseVersion {
  version: string
  lastUpdate: string | null
  requestsUsed: number
}

export interface SourceLookupResult extends SourceMonthResult {}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const attributeLabels: Record<string, string> = {
  DARK: '暗',
  DIVINE: '神',
  EARTH: '地',
  FIRE: '炎',
  LIGHT: '光',
  WATER: '水',
  WIND: '風'
}

const raceLabels: Record<string, string> = {
  Aqua: '水族',
  Beast: '獸族',
  'Beast-Warrior': '獸戰士族',
  'Creator-God': '創造神族',
  Cyberse: '電子界族',
  Dinosaur: '恐龍族',
  'Divine-Beast': '幻神獸族',
  Dragon: '龍族',
  Fairy: '天使族',
  Fiend: '惡魔族',
  Fish: '魚族',
  Illusion: '幻想魔族',
  Insect: '昆蟲族',
  Machine: '機械族',
  Plant: '植物族',
  Psychic: '超能族',
  Pyro: '炎族',
  Reptile: '爬蟲類族',
  Rock: '岩石族',
  'Sea Serpent': '海龍族',
  Spellcaster: '魔法使族',
  Thunder: '雷族',
  Warrior: '戰士族',
  'Winged Beast': '鳥獸族',
  Wyrm: '幻龍族',
  Zombie: '不死族'
}

const spellTrapRaceLabels: Record<string, string> = {
  Continuous: '永續',
  Counter: '反擊',
  Equip: '裝備',
  Field: '場地',
  Normal: '通常',
  'Quick-Play': '速攻',
  Ritual: '儀式'
}

const spellTrapIcons: Record<string, SpellTrapIcon> = {
  Continuous: 'continuous',
  Counter: 'counter',
  Equip: 'equip',
  Field: 'field',
  'Quick-Play': 'quick-play',
  Ritual: 'ritual'
}

const linkArrowValues: Record<string, number> = {
  'Bottom-Left': 1,
  Bottom: 2,
  'Bottom-Right': 3,
  Left: 4,
  Right: 6,
  'Top-Left': 7,
  Top: 8,
  'Top-Right': 9
}

const frameAccents: Record<CardFrame, string> = {
  normal: '#c79b53',
  effect: '#c77b48',
  ritual: '#4c91b5',
  fusion: '#8462a9',
  synchro: '#d8d8cf',
  xyz: '#33373d',
  link: '#2e6da4',
  spell: '#4a9a86',
  trap: '#a34f8a'
}

const getDateRange = (year: number, month: number): { start: string; end: string } => {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { start, end: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` }
}

export const validateCatalogUpdateRequest = (value: unknown): CatalogUpdateRequest => {
  if (!value || typeof value !== 'object') throw new Error('更新條件格式不正確。')
  const input = value as Partial<CatalogUpdateRequest>
  const maximumYear = new Date().getUTCFullYear() + 1
  if (!Number.isInteger(input.year) || Number(input.year) < 1999 || Number(input.year) > maximumYear) {
    throw new Error(`發行年份必須介於 1999 與 ${maximumYear} 之間。`)
  }
  if (!Number.isInteger(input.month) || Number(input.month) < 1 || Number(input.month) > 12) {
    throw new Error('發行月份必須介於 1 與 12 之間。')
  }
  if (input.region !== 'ocg' && input.region !== 'tcg') throw new Error('請選擇 OCG 或 TCG 發行地區。')
  if (input.mode !== 'month' && input.mode !== 'through' && input.mode !== 'repair') throw new Error('請選擇單月、截至月份更新或缺漏補查。')
  return { mode: input.mode, year: Number(input.year), month: Number(input.month), region: input.region }
}

const mapFrame = (frameType: string, type: string): CardFrame => {
  const normalized = frameType.toLowerCase().replace('_pendulum', '')
  if (normalized === 'normal' || normalized === 'effect' || normalized === 'ritual' ||
      normalized === 'fusion' || normalized === 'synchro' || normalized === 'xyz' ||
      normalized === 'link' || normalized === 'spell' || normalized === 'trap') {
    return normalized
  }
  const loweredType = type.toLowerCase()
  if (loweredType.includes('spell')) return 'spell'
  if (loweredType.includes('trap')) return 'trap'
  if (loweredType.includes('ritual')) return 'ritual'
  if (loweredType.includes('fusion')) return 'fusion'
  if (loweredType.includes('synchro')) return 'synchro'
  if (loweredType.includes('xyz')) return 'xyz'
  if (loweredType.includes('link')) return 'link'
  if (loweredType.includes('normal')) return 'normal'
  return 'effect'
}

const getKind = (frame: CardFrame): CardKind =>
  frame === 'spell' ? 'spell' : frame === 'trap' ? 'trap' : 'monster'

const monsterTypeLine = (race: string, type: string): string => {
  const lowered = type.toLowerCase()
  const traits: string[] = []
  if (lowered.includes('ritual')) traits.push('儀式')
  if (lowered.includes('fusion')) traits.push('融合')
  if (lowered.includes('synchro')) traits.push('同步')
  if (lowered.includes('xyz')) traits.push('超量')
  if (lowered.includes('link')) traits.push('連結')
  if (lowered.includes('pendulum')) traits.push('靈擺')
  if (lowered.includes('tuner')) traits.push('協調')
  if (lowered.includes('flip')) traits.push('反轉')
  if (lowered.includes('spirit')) traits.push('靈魂')
  if (lowered.includes('toon')) traits.push('卡通')
  if (lowered.includes('union')) traits.push('聯合')
  if (lowered.includes('gemini')) traits.push('二重')
  if (lowered.includes('normal')) traits.push('通常')
  else if (lowered.includes('effect') || lowered.includes('link')) traits.push('效果')
  return [race, ...new Set(traits)].join('／')
}

const safeSourceUrl = (value: unknown, remoteId: number): string => {
  const candidate = asString(value)
  if (candidate) {
    try {
      const url = new URL(candidate)
      if (url.protocol === 'https:' && (url.hostname === 'ygoprodeck.com' || url.hostname.endsWith('.ygoprodeck.com'))) {
        return url.toString()
      }
    } catch {
      // Fall through to the stable source page.
    }
  }
  return `https://ygoprodeck.com/card/?search=${remoteId}`
}

const mapCard = (
  raw: YgoprodeckCard,
  request: CatalogUpdateRequest
): CatalogImportRecord | null => {
  const remoteId = asNumber(raw.id)
  const name = asString(raw.name)
  const type = asString(raw.type)
  if (remoteId == null || remoteId <= 0 || !Number.isInteger(remoteId) || !name || !type) return null
  const loweredType = type.toLowerCase()
  if (loweredType.includes('rush') || loweredType.includes('skill') || loweredType.includes('token')) return null

  const frame = mapFrame(asString(raw.frameType) ?? '', type)
  const kind = getKind(frame)
  const sourceRace = asString(raw.race) ?? (kind === 'monster' ? 'Unknown' : 'Normal')
  const race = kind === 'monster' ? (raceLabels[sourceRace] ?? sourceRace) : `${spellTrapRaceLabels[sourceRace] ?? sourceRace}${kind === 'spell' ? '魔法' : '陷阱'}`
  const sourceLevel = asNumber(raw.level)
  const sourceScale = asNumber(raw.scale)
  const misc = Array.isArray(raw.misc_info) ? raw.misc_info[0] as YgoprodeckMisc | undefined : undefined
  const ocgReleaseDate = asString(misc?.ocg_date)
  const tcgReleaseDate = asString(misc?.tcg_date)
  const releaseDate = request.region === 'ocg' ? ocgReleaseDate : tcgReleaseDate
  const images = Array.isArray(raw.card_images) ? raw.card_images as YgoprodeckImage[] : []
  const artworks = images.flatMap((image, index): CatalogImportArtwork[] => {
    const sourceUrl = asString(image.image_url_cropped)
    if (!sourceUrl) return []
    try {
      const url = new URL(sourceUrl)
      if (url.protocol !== 'https:' || url.hostname !== 'images.ygoprodeck.com') return []
    } catch {
      return []
    }
    const imageId = asNumber(image.id) ?? index
    return [{
      id: `ygoprodeck-art-${remoteId}-${imageId}-${index}`,
      variantLabel: index === 0 ? 'YGOPRODeck 主插圖' : `YGOPRODeck 異圖 ${index + 1}`,
      sourceUrl,
      shardKey: `${request.region}-${request.year}`
    }]
  })
  const description = asString(raw.monster_desc) ?? asString(raw.desc) ?? 'No card text supplied by source.'
  const pendulumText = asString(raw.pend_desc)
  const linkMarkers = Array.isArray(raw.linkmarkers) ? raw.linkmarkers : []
  const linkArrows = linkMarkers.flatMap((marker): number[] => {
    const value = typeof marker === 'string' ? linkArrowValues[marker] : undefined
    return value == null ? [] : [value]
  })

  return {
    id: `ygoprodeck-${remoteId}`,
    remoteId,
    passcode: String(remoteId).padStart(8, '0'),
    konamiId: asNumber(misc?.konami_id),
    name,
    kind,
    frame,
    attribute: kind === 'monster' ? (attributeLabels[asString(raw.attribute) ?? ''] ?? asString(raw.attribute) ?? '未知') : kind === 'spell' ? '魔法' : '陷阱',
    race,
    typeLine: kind === 'monster' ? monsterTypeLine(race, type) : race,
    level: kind === 'monster' && frame !== 'xyz' && frame !== 'link' ? sourceLevel : null,
    rank: frame === 'xyz' ? sourceLevel : null,
    linkRating: frame === 'link' ? asNumber(raw.linkval) : null,
    linkArrows,
    spellTrapIcon: kind === 'monster' ? null : spellTrapIcons[sourceRace] ?? null,
    pendulumScaleLeft: sourceScale,
    pendulumScaleRight: sourceScale,
    pendulumText,
    atk: kind === 'monster' ? asNumber(raw.atk) : null,
    def: kind === 'monster' && frame !== 'link' ? asNumber(raw.def) : null,
    ruleText: description,
    archetype: asString(raw.archetype),
    artworks,
    accent: frameAccents[frame],
    sourceUrl: safeSourceUrl(raw.ygoprodeck_url, remoteId),
    releaseDate,
    ocgReleaseDate,
    tcgReleaseDate
  }
}

const parseResponse = (text: string): YgoprodeckResponse => {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object') throw new Error()
    return parsed as YgoprodeckResponse
  } catch {
    throw new Error('YGOPRODeck 回傳了無法解析的資料。')
  }
}

export class YgoprodeckSource {
  private lastRequestAt = 0

  private async throttle(signal?: AbortSignal): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt
    const remaining = REQUEST_INTERVAL_MS - elapsed
    await waitForUpdate(remaining, signal)
    this.lastRequestAt = Date.now()
  }

  async fetchDatabaseVersion(signal?: AbortSignal): Promise<SourceDatabaseVersion> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      await this.throttle(signal)
      const response = await fetch(VERSION_ENDPOINT, {
        headers: { accept: 'application/json', 'user-agent': 'ArcanaArchive/0.1 catalog-integrity-audit' },
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`YGOPRODeck 版本端點回應 HTTP ${response.status}。`)
      const parsed = JSON.parse(text) as unknown
      const row = Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object'
        ? parsed[0] as Record<string, unknown>
        : null
      const version = asString(row?.database_version)
      if (!version) throw new Error('YGOPRODeck 版本端點缺少資料庫版本。')
      return { version, lastUpdate: asString(row?.last_update), requestsUsed: 1 }
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof Error && error.message.startsWith('YGOPRODeck')) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new Error('YGOPRODeck 版本檢查逾時。')
      throw new Error('無法檢查 YGOPRODeck 資料庫版本。')
    } finally {
      clearTimeout(timeout)
    }
  }

  async fetchInventory(
    value: unknown,
    requestBudget: number = YGOPRODECK_POLICY.maxRequestsPerRun,
    signal?: AbortSignal
  ): Promise<{ request: CatalogUpdateRequest; result: SourceInventoryResult }> {
    const request = validateCatalogUpdateRequest(value)
    const records = new Map<number, CatalogImportRecord>()
    let skipped = 0
    let offset = 0
    let requestsUsed = 0
    let totalRows = 0
    let complete = true

    while (offset < Math.max(1, totalRows)) {
      signal?.throwIfAborted()
      if (requestsUsed >= requestBudget) { complete = false; break }
      const url = new URL(CARD_ENDPOINT)
      url.searchParams.set('misc', 'yes')
      url.searchParams.set('sort', 'id')
      url.searchParams.set('num', String(INVENTORY_PAGE_SIZE))
      url.searchParams.set('offset', String(offset))
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      let response: Response
      let text: string
      try {
        await this.throttle(signal)
        requestsUsed += 1
        response = await fetch(url, {
          headers: { accept: 'application/json', 'user-agent': 'ArcanaArchive/0.1 catalog-integrity-audit' },
          signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
        })
        text = await response.text()
      } catch (error) {
        signal?.throwIfAborted()
        if (error instanceof Error && error.name === 'AbortError') throw new Error('YGOPRODeck 全庫清冊下載逾時。')
        throw new Error('無法下載 YGOPRODeck 全庫清冊。')
      } finally {
        clearTimeout(timeout)
      }
      if (text.length > RESPONSE_SIZE_LIMIT) throw new Error('YGOPRODeck 全庫清冊單頁超過安全上限。')
      const parsed = parseResponse(text)
      if (!response.ok || !Array.isArray(parsed.data)) {
        throw new Error(asString(parsed.error) ?? `YGOPRODeck 全庫清冊回應 HTTP ${response.status}。`)
      }
      totalRows = asNumber(parsed.meta?.total_rows) ?? parsed.data.length
      if (totalRows > MAX_INVENTORY_CARDS) throw new Error(`YGOPRODeck 清冊 ${totalRows} 張，超過安全上限。`)
      for (const raw of parsed.data) {
        const mapped = raw && typeof raw === 'object' ? mapCard(raw as YgoprodeckCard, request) : null
        if (mapped) records.set(mapped.remoteId, mapped)
        else skipped += 1
      }
      if (parsed.data.length === 0) break
      offset += parsed.data.length
      if (offset >= totalRows || asNumber(parsed.meta?.rows_remaining) === 0) break
    }

    return {
      request,
      result: {
        records: [...records.values()].sort((left, right) => left.remoteId - right.remoteId),
        skipped,
        complete,
        requestsUsed,
        totalRows
      }
    }
  }

  async fetchByPasscodes(
    value: unknown,
    passcodes: string[],
    requestBudget: number,
    signal?: AbortSignal
  ): Promise<{ request: CatalogUpdateRequest; result: SourceLookupResult }> {
    const request = validateCatalogUpdateRequest(value)
    const uniquePasscodes = [...new Set(passcodes.filter((passcode) => /^\d{8}$/.test(passcode)))]
    const validPasscodes = uniquePasscodes.slice(0, 500)
    const records = new Map<number, CatalogImportRecord>()
    let skipped = 0
    let requestsUsed = 0
    let complete = uniquePasscodes.length <= validPasscodes.length
    for (let offset = 0; offset < validPasscodes.length; offset += 50) {
      signal?.throwIfAborted()
      if (requestsUsed >= requestBudget) { complete = false; break }
      const url = new URL(CARD_ENDPOINT)
      url.searchParams.set('id', validPasscodes.slice(offset, offset + 50).join(','))
      url.searchParams.set('misc', 'yes')
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      let response: Response
      let text: string
      try {
        await this.throttle(signal)
        requestsUsed += 1
        response = await fetch(url, {
          headers: { accept: 'application/json', 'user-agent': 'ArcanaArchive/0.1 catalog-targeted-integrity-check' },
          signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
        })
        text = await response.text()
      } catch (error) {
        signal?.throwIfAborted()
        if (error instanceof Error && error.name === 'AbortError') throw new Error('YGOPRODeck 定向卡片補查逾時。')
        throw new Error('無法執行 YGOPRODeck 定向卡片補查。')
      } finally {
        clearTimeout(timeout)
      }
      if (text.length > RESPONSE_SIZE_LIMIT) throw new Error('YGOPRODeck 定向補查回應超過安全上限。')
      const parsed = parseResponse(text)
      if (!response.ok || !Array.isArray(parsed.data)) {
        throw new Error(asString(parsed.error) ?? `YGOPRODeck 定向補查回應 HTTP ${response.status}。`)
      }
      for (const raw of parsed.data) {
        const mapped = raw && typeof raw === 'object' ? mapCard(raw as YgoprodeckCard, request) : null
        if (mapped) records.set(mapped.remoteId, mapped)
        else skipped += 1
      }
    }
    return {
      request,
      result: { records: [...records.values()], skipped, complete, requestsUsed }
    }
  }

  async fetchReleaseMonth(
    value: unknown,
    requestBudget: number = YGOPRODECK_POLICY.maxRequestsPerRun,
    signal?: AbortSignal
  ): Promise<{ request: CatalogUpdateRequest; result: SourceMonthResult }> {
    const request = validateCatalogUpdateRequest(value)
    const range = getDateRange(request.year, request.month)
    const records = new Map<number, CatalogImportRecord>()
    let skipped = 0
    let offset = 0
    let page = 0
    let requestsUsed = 0
    let complete = true

    while (true) {
      signal?.throwIfAborted()
      if (requestsUsed >= requestBudget) {
        complete = false
        break
      }
      const url = new URL(CARD_ENDPOINT)
      url.searchParams.set('startdate', range.start)
      url.searchParams.set('enddate', range.end)
      url.searchParams.set('dateregion', request.region)
      url.searchParams.set('misc', 'yes')
      url.searchParams.set('sort', 'id')
      url.searchParams.set('num', String(PAGE_SIZE))
      url.searchParams.set('offset', String(offset))

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      let response: Response
      let text: string
      try {
        await this.throttle(signal)
        requestsUsed += 1
        response = await fetch(url, {
          headers: {
            accept: 'application/json',
            'user-agent': 'ArcanaArchive/0.1 personal-local-catalog (month-scoped; single-worker)'
          },
          signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
        })
        const contentLength = Number(response.headers.get('content-length') ?? 0)
        if (contentLength > RESPONSE_SIZE_LIMIT) {
          controller.abort()
          throw new RangeError('來源回應超過單頁安全上限，已停止更新。')
        }
        text = await response.text()
      } catch (error) {
        signal?.throwIfAborted()
        if (error instanceof RangeError) throw error
        if (error instanceof Error && error.name === 'AbortError') throw new Error('YGOPRODeck 連線逾時，未變更本機資料。')
        throw new Error('無法連線至 YGOPRODeck，請檢查網路後再試。')
      } finally {
        clearTimeout(timeout)
      }
      signal?.throwIfAborted()

      if (text.length > RESPONSE_SIZE_LIMIT) throw new Error('來源回應超過單頁安全上限，已停止更新。')
      const parsed = parseResponse(text)
      if (!response.ok) {
        const sourceError = asString(parsed.error)
        if (response.status === 400 && sourceError?.toLowerCase().includes('no card matching')) {
          break
        }
        if (response.status === 429) throw new Error('來源目前要求降低請求頻率，請稍後再試；本機資料未變更。')
        throw new Error(sourceError ? `YGOPRODeck：${sourceError}` : `YGOPRODeck 回應 HTTP ${response.status}。`)
      }
      if (!Array.isArray(parsed.data)) throw new Error('YGOPRODeck 回應缺少卡片清單，未變更本機資料。')

      const totalRows = asNumber(parsed.meta?.total_rows)
      if (totalRows != null && totalRows > MAX_CARDS_PER_MONTH) {
        throw new Error(`此月份來源回傳 ${totalRows} 張，超過單次 ${MAX_CARDS_PER_MONTH} 張安全上限。`)
      }
      for (const raw of parsed.data) {
        const mapped = raw && typeof raw === 'object' ? mapCard(raw as YgoprodeckCard, request) : null
        if (mapped) records.set(mapped.remoteId, mapped)
        else skipped += 1
      }
      if (records.size > MAX_CARDS_PER_MONTH) throw new Error(`單次更新已超過 ${MAX_CARDS_PER_MONTH} 張安全上限。`)

      const rowsRemaining = asNumber(parsed.meta?.rows_remaining)
      if (parsed.data.length < PAGE_SIZE || rowsRemaining === 0) break
      if (requestsUsed >= requestBudget) {
        complete = false
        break
      }
      offset += parsed.data.length
      page += 1
      if (page * PAGE_SIZE >= MAX_CARDS_PER_MONTH) throw new Error(`單次更新已達 ${MAX_CARDS_PER_MONTH} 張安全上限。`)
    }

    const chronologicalRecords = [...records.values()].sort((left, right) => {
      const byDate = (left.releaseDate ?? range.end).localeCompare(right.releaseDate ?? range.end)
      return byDate === 0 ? left.remoteId - right.remoteId : byDate
    })
    return { request, result: { records: chronologicalRecords, skipped, complete, requestsUsed } }
  }
}
