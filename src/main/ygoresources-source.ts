import type { CatalogSourcePolicy } from '../shared/catalog'
import type { CatalogImportArtwork, CatalogImportRecord } from './ygoprodeck-source'

export const YGORESOURCES_SOURCE_NAME = 'YGOResources 卡圖索引'
export const YGORESOURCES_GUIDE_URL = 'https://github.com/yugioh-artworks/artworks-index'

const MANIFEST_URL = 'https://artworks.ygoresources.com/manifest.json'
const RESPONSE_SIZE_LIMIT = 32 * 1024 * 1024

export const YGORESOURCES_POLICY: CatalogSourcePolicy = {
  id: 'ygoresources',
  name: YGORESOURCES_SOURCE_NAME,
  role: '依 Konami 資料庫 ID 補齊並驗證不同卡圖版本',
  language: '同一插圖優先中文，其次日文，最後英文',
  guideUrl: YGORESOURCES_GUIDE_URL,
  requestIntervalMs: 0,
  batchSize: 20_000,
  maxRequestsPerRun: 2,
  maxCardsPerRun: 20_000
}

interface ArtworkManifestEntry {
  bestArt?: unknown
  idx?: unknown
}

interface ArtworkManifestAsset {
  path?: unknown
  source?: unknown
}

interface ArtworkManifest {
  cards?: unknown
  neuron_version?: unknown
}

export interface ArtworkInventoryResult {
  records: CatalogImportRecord[]
  version: string
  requestsUsed: number
  cardsWithArtwork: number
  artworkCount: number
}

export interface ArtworkVersionResult {
  version: string
  requestsUsed: number
}

const safeArtworkUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value, MANIFEST_URL)
    if (url.protocol !== 'https:' || (url.hostname !== 'ygoresources.com' && !url.hostname.endsWith('.ygoresources.com'))) return null
    return url.toString()
  } catch {
    return null
  }
}

// The manifest groups localized card scans under one artwork variant. Keep one
// catalog entry per illustration and choose the representative language here.
// Traditional-Chinese aliases are listed first for forward compatibility; the
// current manifest exposes Chinese scans as `cn`.
const representativeLanguagePriority = ['zh-tw', 'zh-hant', 'tw', 'tc', 'cn', 'ja', 'en'] as const

const representativeArtworkUrl = (value: ArtworkManifestEntry): string | null => {
  const index = value.idx
  if (index && typeof index === 'object' && !Array.isArray(index)) {
    const localized = index as Record<string, unknown>
    for (const language of representativeLanguagePriority) {
      const rawAssets = localized[language]
      if (!Array.isArray(rawAssets)) continue
      const assets = [...rawAssets].sort((left, right) => {
        const leftSource = left && typeof left === 'object' ? (left as ArtworkManifestAsset).source : null
        const rightSource = right && typeof right === 'object' ? (right as ArtworkManifestAsset).source : null
        return (rightSource === 'neuron_high' ? 1 : 0) - (leftSource === 'neuron_high' ? 1 : 0)
      })
      for (const asset of assets) {
        if (!asset || typeof asset !== 'object') continue
        const sourceUrl = safeArtworkUrl((asset as ArtworkManifestAsset).path)
        if (sourceUrl) return sourceUrl
      }
    }
  }
  return safeArtworkUrl(value.bestArt)
}

const manifestVersion = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown'
  const parts = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string | number] => (
      typeof entry[1] === 'string' || typeof entry[1] === 'number'
    ))
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([key, version]) => `${key}=${version}`)
  return parts.length > 0 ? parts.join(';') : 'unknown'
}

export class YgoresourcesSource {
  private cachedManifest: { cards: Record<string, unknown>; version: string } | null = null

  async fetchVersion(signal?: AbortSignal): Promise<ArtworkVersionResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(MANIFEST_URL, {
        method: 'HEAD',
        headers: { accept: 'application/json', 'user-agent': 'ArcanaArchive/0.1 artwork-version-check' },
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
      })
      if (!response.ok) throw new Error(`YGOResources 卡圖版本回應 HTTP ${response.status}。`)
      const etag = response.headers.get('etag')
      const lastModified = response.headers.get('last-modified')
      const contentLength = response.headers.get('content-length')
      const version = [etag, lastModified, contentLength].filter(Boolean).join('|')
      if (!version) throw new Error('YGOResources 卡圖版本回應缺少 ETag 與修改資訊。')
      return { version, requestsUsed: 1 }
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof Error && error.message.startsWith('YGOResources')) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new Error('YGOResources 卡圖版本檢查逾時。')
      throw new Error('無法檢查 YGOResources 卡圖版本。')
    } finally {
      clearTimeout(timeout)
    }
  }

  async enrich(records: CatalogImportRecord[], signal?: AbortSignal): Promise<ArtworkInventoryResult> {
    let manifestCards = this.cachedManifest?.cards
    let version = this.cachedManifest?.version ?? 'unknown'
    let requestsUsed = 0
    try {
      if (!manifestCards) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 45_000)
        try {
          const response = await fetch(MANIFEST_URL, {
            headers: { accept: 'application/json', 'user-agent': 'ArcanaArchive/0.1 artwork-integrity-audit' },
            signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
          })
          const text = await response.text()
          if (!response.ok) throw new Error(`YGOResources 卡圖索引回應 HTTP ${response.status}。`)
          if (text.length > RESPONSE_SIZE_LIMIT) throw new Error('YGOResources 卡圖索引超過安全上限。')
          const manifest = JSON.parse(text) as ArtworkManifest
          if (!manifest.cards || typeof manifest.cards !== 'object' || Array.isArray(manifest.cards)) {
            throw new Error('YGOResources 卡圖索引缺少 cards 清冊。')
          }
          manifestCards = manifest.cards as Record<string, unknown>
          version = manifestVersion(manifest.neuron_version)
          this.cachedManifest = { cards: manifestCards, version }
          requestsUsed = 1
        } finally {
          clearTimeout(timeout)
        }
      }
      if (!manifestCards) throw new Error('YGOResources 卡圖索引未完成載入。')
      const cards = manifestCards
      let cardsWithArtwork = 0
      let artworkCount = 0
      const enriched = records.map((record) => {
        if (record.konamiId == null) return record
        const rawVariants = cards[String(record.konamiId)]
        if (!rawVariants || typeof rawVariants !== 'object' || Array.isArray(rawVariants)) return record
        const artworks = Object.entries(rawVariants as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right, 'en', { numeric: true }))
          .flatMap(([variantId, value], index): CatalogImportArtwork[] => {
            if (!value || typeof value !== 'object') return []
            const sourceUrl = representativeArtworkUrl(value as ArtworkManifestEntry)
            if (!sourceUrl) return []
            return [{
              // Konami IDs in the community manifest are not guaranteed to map one-to-one
              // to a passcode. Include the catalog card identity so artwork primary keys stay
              // globally unique even when two card records share the same manifest entry.
              id: `ygoresources-art-${record.passcode}-${record.konamiId}-${variantId}`,
              variantLabel: `卡圖版本 ${index + 1}`,
              sourceUrl,
              sourceName: YGORESOURCES_SOURCE_NAME,
              shardKey: 'ygoresources'
            }]
          })
        if (artworks.length === 0) return record
        cardsWithArtwork += 1
        artworkCount += artworks.length
        return { ...record, artworks }
      })
      const result = {
        records: enriched,
        version,
        requestsUsed,
        cardsWithArtwork,
        artworkCount
      }
      return result
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof Error && (error.message.startsWith('YGOResources'))) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new Error('YGOResources 卡圖索引下載逾時。')
      throw new Error('無法讀取 YGOResources 卡圖索引。')
    }
  }
}
