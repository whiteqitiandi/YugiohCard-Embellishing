export type CardKind = 'monster' | 'spell' | 'trap'
export type CardFrame = 'normal' | 'effect' | 'ritual' | 'fusion' | 'synchro' | 'xyz' | 'link' | 'spell' | 'trap'
export type SpellTrapIcon = 'continuous' | 'counter' | 'equip' | 'field' | 'quick-play' | 'ritual'
export type ReleaseRegion = 'ocg' | 'tcg'
export type CardLanguage = 'zh' | 'en' | 'ja'
export type CatalogUpdateMode = 'month' | 'through' | 'repair'
export type CoverageStatus = 'not-started' | 'complete' | 'complete-with-gaps' | 'source-limit' | 'waiting-language'
export type CatalogMissingField = 'nameZh' | 'ruleTextZh' | 'nameEn' | 'nameJa'

export interface CatalogPendingCard {
  region: ReleaseRegion
  passcode: string
  name: string
  releaseMonth: string
  releaseDate: string | null
  missingFields: CatalogMissingField[]
  reason: string
  sourceUrl: string
  attempts: number
  firstSeenAt: string
  lastCheckedAt: string
}

export interface CatalogPendingPage {
  total: number
  items: CatalogPendingCard[]
}

export interface CardArtwork {
  id: string
  variantLabel: string
  sourceUrl: string | null
  sourceName: string
  shardKey: string
}

export interface RuleTextVariant {
  ruleset: 'ocg-master' | 'duel-links-speed'
  label: string
  textZh: string
  note: string | null
}

export interface CompatibilityTrait {
  key: string
  label: string
  weight: number
}

export interface CatalogCard {
  id: string
  passcode: string
  konamiId: number | null
  nameZh: string
  nameJa: string
  nameEn: string
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
  effectTags: string[]
  relations: string[]
  compatibility: CompatibilityTrait[]
  artworks: CardArtwork[]
  ruleTexts: RuleTextVariant[]
  accent: string
  sourceName?: string | null
  sourceUrl?: string | null
  localizationSourceName?: string | null
  localizationSourceUrl?: string | null
  localizationStatus?: 'curated' | 'zh-tw-converted' | 'english-fallback' | null
  releaseRegion?: ReleaseRegion | null
  releaseDate?: string | null
  ocgReleaseDate?: string | null
  tcgReleaseDate?: string | null
  requiredLanguages?: CardLanguage[]
  supportedLanguages?: CardLanguage[]
  isUnpopular: boolean
}

export interface CatalogCoverage {
  region: ReleaseRegion
  completeThrough: string | null
  scannedThrough: string | null
  pendingCards: number
  resumeMonth: string | null
  resumeOffset: number
  targetMonth: string | null
  status: CoverageStatus
  note: string | null
}

export interface CatalogStats {
  cards: number
  artworks: number
  ruleVariants: number
  lastSeededAt: string
  importedCards: number
  lastUpdatedAt: string | null
  lastUpdateLabel: string | null
  coverage: CatalogCoverage[]
}

export interface CatalogPopularityBatchResult {
  savedIds: string[]
  failures: Array<{ id: string; message: string }>
}

export interface CatalogUpdateRequest {
  mode: CatalogUpdateMode
  year: number
  month: number
  region: ReleaseRegion
}

export interface CatalogSourcePolicy {
  id: 'ygoprodeck' | 'ygocdb' | 'ygoresources'
  name: string
  role: string
  language: string
  guideUrl: string
  requestIntervalMs: number
  batchSize: number
  maxRequestsPerRun: number
  maxCardsPerRun: number
}

export interface CatalogUpdateResult {
  sourceName: string
  sourceUrl: string
  region: ReleaseRegion
  mode: CatalogUpdateMode
  year: number
  month: number
  fetched: number
  localized: number
  missingChinese: number
  missingRequiredLanguages: number
  languageGaps: Record<CardLanguage, number>
  inserted: number
  updated: number
  skipped: number
  limitReached: boolean
  stoppedBy: 'complete' | 'metadata-request-limit' | 'chinese-card-limit'
  pendingCards: number
  releaseCompleteThrough: string | null
  resumeMonth: string | null
  sourceRequests: Array<{ sourceId: CatalogSourcePolicy['id']; requests: number }>
  runCompletedAt: string
}

export interface CatalogUpdateProgress {
  currentMonth: string
  monthProcessed: number
  monthTotal: number | null
  completedMonths: number
  totalMonths: number
  percent: number
  coverage: CatalogCoverage
  fetched: number
  inserted: number
  updated: number
  deferred: number
}

export type CatalogUpdateStatus = 'idle' | 'running' | 'cooling' | 'pausing' | 'paused'
  | 'cancelling' | 'cancelled' | 'completed' | 'blocked'
export type CatalogUpdateControl = 'pause' | 'resume' | 'cancel'

export interface CatalogUpdateState {
  revision: number
  status: CatalogUpdateStatus
  request: CatalogUpdateRequest | null
  batchNumber: number
  nextBatchAt: number | null
  cooldownMs: number
  progress: CatalogUpdateProgress | null
  fetched: number
  inserted: number
  updated: number
  deferred: number
  message: string
  lastResult: CatalogUpdateResult | null
}

export interface CatalogApi {
  listCards: () => Promise<CatalogCard[]>
  stats: () => Promise<CatalogStats>
  resolveArtwork: (artworkId: string) => Promise<string | null>
  startUpdate: (request: CatalogUpdateRequest) => Promise<CatalogUpdateState>
  updateState: () => Promise<CatalogUpdateState>
  controlUpdate: (control: CatalogUpdateControl) => Promise<CatalogUpdateState>
  onUpdateState: (callback: (state: CatalogUpdateState) => void) => () => void
  updatePolicies: () => Promise<CatalogSourcePolicy[]>
  pendingCards: (region: ReleaseRegion, page: number) => Promise<CatalogPendingPage>
  setUnpopular: (cardId: string, isUnpopular: boolean) => Promise<boolean>
  setUnpopularBatch: (cardIds: string[], isUnpopular: boolean) => Promise<CatalogPopularityBatchResult>
}

export type AppView = 'catalog' | 'updates' | 'studio' | 'creator' | 'deck'
export type InterfaceScale = 0.9 | 1 | 1.15 | 1.3

export interface AppSettingsSnapshot {
  directoryPageRows: import('./directory').DirectoryPageRows
  directoryShowArtworkVariants: boolean
}

export interface AppSettingsApi {
  get: () => Promise<AppSettingsSnapshot>
  setDirectoryPageRows: (rows: import('./directory').DirectoryPageRows) => Promise<AppSettingsSnapshot>
  onDirectoryPageRowsChanged: (callback: (rows: import('./directory').DirectoryPageRows) => void) => () => void
  setDirectoryShowArtworkVariants: (show: boolean) => Promise<AppSettingsSnapshot>
  onDirectoryShowArtworkVariantsChanged: (callback: (show: boolean) => void) => () => void
}

export interface AppCommandsApi {
  onNavigate: (callback: (view: AppView) => void) => () => void
  onFocusSearch: (callback: () => void) => () => void
  onClearFilters: (callback: () => void) => () => void
}

export interface CardFiltersApi {
  open: (criteria: import('./filters').CardFilterCriteria) => Promise<void>
  getDraft: () => Promise<import('./filters').CardFilterCriteria>
  apply: (criteria: import('./filters').CardFilterCriteria) => Promise<void>
  onApplied: (callback: (criteria: import('./filters').CardFilterCriteria) => void) => () => void
  listSaved: () => Promise<import('./filters').SavedCardFilter[]>
  save: (input: {
    id?: string
    name: string
    criteria: import('./filters').CardFilterCriteria
  }) => Promise<import('./filters').SavedCardFilter[]>
  delete: (id: string) => Promise<import('./filters').SavedCardFilter[]>
}

declare global {
  interface Window {
    arcana: {
      catalog: CatalogApi
      commands: AppCommandsApi
      filters: CardFiltersApi
      settings: AppSettingsApi
      platform: string
    }
  }
}
