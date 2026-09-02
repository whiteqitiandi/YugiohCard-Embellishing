import OpenCC from 'opencc-js'
import type { CatalogSourcePolicy } from '../shared/catalog'
import type { CatalogImportRecord } from './ygoprodeck-source'

export const YGOCDB_SOURCE_NAME = '百鴿（YGOCDB）API v0'
export const YGOCDB_GUIDE_URL = 'https://ygocdb.com/api'

const CARDSET_ENDPOINT = 'https://ygocdb.com/api/v0/cardset'
const RESPONSE_SIZE_LIMIT = 12 * 1024 * 1024
const REQUEST_INTERVAL_MS = 2_000
const BATCH_SIZE = 100
const MAX_REQUESTS_PER_RUN = 5

export const YGOCDB_POLICY: CatalogSourcePolicy = {
  id: 'ygocdb',
  name: YGOCDB_SOURCE_NAME,
  role: '中文卡名、效果文、日文名稱與英文名稱',
  language: '簡體中文與日／英文名稱；中文以 OpenCC 轉台灣正體',
  guideUrl: YGOCDB_GUIDE_URL,
  requestIntervalMs: REQUEST_INTERVAL_MS,
  batchSize: BATCH_SIZE,
  maxRequestsPerRun: MAX_REQUESTS_PER_RUN,
  maxCardsPerRun: BATCH_SIZE * MAX_REQUESTS_PER_RUN
}

interface YgocdbText {
  name?: unknown
  sc_name?: unknown
  md_name?: unknown
  jp_name?: unknown
  en_name?: unknown
  desc?: unknown
  pdesc?: unknown
}

interface YgocdbCard {
  id?: unknown
  cid?: unknown
  text?: unknown
}

export interface ChineseLocalization {
  passcode: string
  konamiId: number | null
  nameZh: string | null
  nameJa: string | null
  nameEn: string | null
  ruleTextZh: string | null
  pendulumTextZh: string | null
  sourceUrl: string
}

export interface ChineseLocalizationResult {
  localizations: Map<string, ChineseLocalization>
  missingPasscodes: string[]
  requestsUsed: number
}

const toTaiwanTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' })

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const asInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null

const parseResponse = (text: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed as Record<string, unknown>
  } catch {
    throw new Error('百鴿中文來源回傳了無法解析的資料。')
  }
}

const mapLocalization = (value: unknown): ChineseLocalization | null => {
  if (!value || typeof value !== 'object') return null
  const card = value as YgocdbCard
  const remoteId = asInteger(card.id)
  const text = card.text && typeof card.text === 'object' ? card.text as YgocdbText : null
  const name = asString(text?.sc_name) ?? asString(text?.name) ?? asString(text?.md_name)
  const description = asString(text?.desc)
  const pendulumDescription = asString(text?.pdesc)
  if (remoteId == null || remoteId <= 0 || !text) return null
  const konamiId = asInteger(card.cid)
  return {
    passcode: String(remoteId).padStart(8, '0'),
    konamiId,
    nameZh: name == null ? null : toTaiwanTraditional(name),
    nameJa: asString(text?.jp_name),
    nameEn: asString(text?.en_name),
    ruleTextZh: description == null ? null : toTaiwanTraditional(description),
    pendulumTextZh: pendulumDescription == null ? null : toTaiwanTraditional(pendulumDescription),
    sourceUrl: konamiId == null
      ? `https://ygocdb.com/card/${remoteId}`
      : `https://ygocdb.com/card/cid/${konamiId}`
  }
}

export class YgocdbSource {
  private lastRequestAt = 0

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt
    const remaining = REQUEST_INTERVAL_MS - elapsed
    if (remaining > 0) await wait(remaining)
    this.lastRequestAt = Date.now()
  }

  async localize(records: CatalogImportRecord[]): Promise<ChineseLocalizationResult> {
    if (records.length > YGOCDB_POLICY.maxCardsPerRun) {
      throw new Error(`百鴿中文來源單次最多處理 ${YGOCDB_POLICY.maxCardsPerRun} 張。`)
    }
    const localizations = new Map<string, ChineseLocalization>()
    let requestsUsed = 0

    for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
      const batch = records.slice(offset, offset + BATCH_SIZE)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      let response: Response
      let text: string
      try {
        await this.throttle()
        requestsUsed += 1
        response = await fetch(CARDSET_ENDPOINT, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'user-agent': 'ArcanaArchive/0.1 personal-local-catalog (zh-TW localization; single-worker)'
          },
          body: JSON.stringify({ ids: batch.map((card) => card.remoteId) }),
          signal: controller.signal
        })
        const contentLength = Number(response.headers.get('content-length') ?? 0)
        if (contentLength > RESPONSE_SIZE_LIMIT) {
          controller.abort()
          throw new RangeError('百鴿中文來源回應超過單頁安全上限，已停止更新。')
        }
        text = await response.text()
      } catch (error) {
        if (error instanceof RangeError) throw error
        if (error instanceof Error && error.name === 'AbortError') throw new Error('百鴿中文來源連線逾時，本批資料未寫入。')
        throw new Error('無法連線至百鴿中文來源，請檢查網路後再試。')
      } finally {
        clearTimeout(timeout)
      }
      if (text.length > RESPONSE_SIZE_LIMIT) throw new Error('百鴿中文來源回應超過單頁安全上限，已停止更新。')
      const parsed = parseResponse(text)
      if (!response.ok) {
        if (response.status === 429) throw new Error('百鴿中文來源要求降低頻率，請稍後再試。')
        throw new Error(`百鴿中文來源回應 HTTP ${response.status}。`)
      }
      Object.values(parsed).forEach((item) => {
        const localization = mapLocalization(item)
        if (localization) localizations.set(localization.passcode, localization)
      })
    }

    return {
      localizations,
      missingPasscodes: records.map((card) => card.passcode).filter((passcode) => {
        const localization = localizations.get(passcode)
        return localization?.nameZh == null || localization.ruleTextZh == null
      }),
      requestsUsed
    }
  }
}
