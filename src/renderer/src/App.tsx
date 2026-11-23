import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppView,
  CatalogCard,
  CatalogCoverage,
  CatalogSourcePolicy,
  CatalogUpdateMode,
  CatalogStats,
  CatalogUpdateRequest,
  CatalogUpdateResult,
  CatalogUpdateState,
  CatalogUpdateControl,
  CatalogPendingPage,
  CatalogMissingField,
  ReleaseRegion
} from '../../shared/catalog'
import {
  calculateVirtualGridRange,
  clampDirectoryPage,
  directoryPageRowOptions,
  directoryPageSize,
  isIndexOnDirectoryPage,
  sanitizeDirectoryPageRows,
  type DirectoryPageRows
} from '../../shared/directory'
import {
  countFilterConditions,
  createEmptyFilterCriteria,
  matchesCardFilter,
  matchesCardTextQuery,
  type CardFilterCriteria
} from '../../shared/filters'
import { seedCards } from '../../main/seed'
import {
  cardsInsideVirtualGrid,
  setSelectedUnpopular,
  type SelectionRect,
  type UnpopularBatchResult
} from './directorySelection'
import { useDirectorySelection } from './useDirectorySelection'
import {
  CardPreview,
  type CardTextMode,
  type FinishConfig,
  type NameEffect,
  type RimEffect,
  type SurfaceEffect,
  type SurfaceScope
} from './CardPreview'
import {
  catalogSortLabel,
  catalogSortOptions,
  sortCatalogCards,
  type CatalogSortDirection,
  type CatalogSortKey
} from './catalogSorting'

const defaultFinish: FinishConfig = {
  surface: 'aurora',
  scope: 'whole',
  rim: 'gold',
  name: 'gold',
  stamp: false
}

const viewTitles: Record<AppView, string> = {
  catalog: '卡片圖鑑',
  updates: '資料更新中心',
  studio: 'Chronicle 藝術加工室',
  creator: '卡片創作',
  deck: '牌組工房'
}

const surfaceOptions: { id: SurfaceEffect; label: string; note: string }[] = [
  { id: 'none', label: '原始', note: '無表面加工' },
  { id: 'crystal', label: '晶體', note: '細碎切面反光' },
  { id: 'aurora', label: '極光', note: '大面積虹彩流動' },
  { id: 'starlight', label: '星光', note: '稀疏亮點與光束' },
  { id: 'full-starlight', label: '滿版星光', note: '高密度全卡閃紋' }
]

function Glyph({ children }: { children: string }): React.JSX.Element {
  return <span className="glyph" aria-hidden="true">{children}</span>
}

export function App(): React.JSX.Element {
  const [view, setView] = useState<AppView>('catalog')
  const [cards, setCards] = useState<CatalogCard[]>([])
  const [stats, setStats] = useState<CatalogStats | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('')
  const [advancedFilter, setAdvancedFilter] = useState<CardFilterCriteria>(createEmptyFilterCriteria)
  const [artworkId, setArtworkId] = useState('')
  const [ruleset, setRuleset] = useState('ocg-master')
  const [finish, setFinish] = useState<FinishConfig>(defaultFinish)
  const [textMode, setTextMode] = useState<CardTextMode>('fit')
  const [directoryPageRows, setDirectoryPageRowsState] = useState<DirectoryPageRows>(() =>
    sanitizeDirectoryPageRows(window.localStorage.getItem('arcana-directory-page-rows'))
  )
  const [directoryShowArtworkVariants, setDirectoryShowArtworkVariantsState] = useState(() =>
    window.localStorage.getItem('arcana-directory-show-artwork-variants') === 'true'
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [updateCommandBusy, setUpdateCommandBusy] = useState(false)
  const [updateState, setUpdateState] = useState<CatalogUpdateState | null>(null)
  const [updateReady, setUpdateReady] = useState(!window.arcana?.catalog)
  const [updateNotice, setUpdateNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [sourcePolicies, setSourcePolicies] = useState<CatalogSourcePolicy[]>([])
  const [popularityBusyId, setPopularityBusyId] = useState<string | null>(null)
  const [popularityBatchBusy, setPopularityBatchBusy] = useState(false)
  const popularityOperationRef = useRef(false)
  const [popularityNotice, setPopularityNotice] = useState<{ cardId: string; tone: 'success' | 'error'; text: string } | null>(null)
  const updateBusy = updateCommandBusy || !updateReady ||
    (updateState != null && !['idle', 'completed', 'cancelled'].includes(updateState.status))

  const acceptUpdateState = (next: CatalogUpdateState): void => {
    setUpdateState((current) => !current || next.revision > current.revision ? next : current)
  }

  useEffect(() => {
    const api = window.arcana?.catalog
    if (!api) return
    let mounted = true
    const unsubscribe = api.onUpdateState((state) => { if (mounted) acceptUpdateState(state) })
    void api.updateState().then((state) => {
      if (mounted) { acceptUpdateState(state); setUpdateReady(true) }
    }).catch(() => {
      if (mounted) setUpdateNotice({ tone: 'error', text: '無法取得更新作業狀態，請重新載入應用程式。' })
    })
    return () => { mounted = false; unsubscribe() }
  }, [])

  useEffect(() => {
    const api = window.arcana?.settings
    if (!api) return
    let mounted = true
    const acceptRows = (rows: DirectoryPageRows): void => {
      if (!mounted) return
      setDirectoryPageRowsState(rows)
      window.localStorage.setItem('arcana-directory-page-rows', String(rows))
    }
    const acceptArtworkVariants = (show: boolean): void => {
      if (!mounted) return
      setDirectoryShowArtworkVariantsState(show)
      window.localStorage.setItem('arcana-directory-show-artwork-variants', String(show))
    }
    const unsubscribeRows = api.onDirectoryPageRowsChanged(acceptRows)
    const unsubscribeArtworkVariants = api.onDirectoryShowArtworkVariantsChanged(acceptArtworkVariants)
    void api.get().then((snapshot) => {
      acceptRows(snapshot.directoryPageRows)
      acceptArtworkVariants(snapshot.directoryShowArtworkVariants)
    }).catch(() => undefined)
    return () => {
      mounted = false
      unsubscribeRows()
      unsubscribeArtworkVariants()
    }
  }, [])

  useEffect(() => {
    const api = window.arcana?.catalog
    if (!api || !updateState || updateState.status === 'idle') return
    let mounted = true
    void Promise.all([api.listCards(), api.stats()]).then(([loadedCards, loadedStats]) => {
      if (!mounted) return
      setCards(loadedCards)
      setStats(loadedStats)
      setSelectedId((current) => loadedCards.some((card) => card.id === current) ? current : loadedCards[0]?.id ?? '')
    }).catch(() => {
      if (mounted) setUpdateNotice({ tone: 'error', text: '更新狀態已保留，但圖鑑畫面重新讀取失敗；請重新載入畫面。' })
    })
    return () => { mounted = false }
  }, [updateState?.status, updateState?.batchNumber])

  useEffect(() => {
    const catalogApi = window.arcana?.catalog
    const cardPromise = catalogApi ? catalogApi.listCards() : Promise.resolve(seedCards)
    const statsPromise = catalogApi
      ? catalogApi.stats()
      : Promise.resolve({
          cards: seedCards.length,
          artworks: seedCards.reduce((sum, card) => sum + card.artworks.length, 0),
          ruleVariants: seedCards.reduce((sum, card) => sum + card.ruleTexts.length, 0),
          lastSeededAt: 'browser-preview',
          importedCards: 0,
          lastUpdatedAt: null,
          lastUpdateLabel: null,
          coverage: [emptyCoverage('ocg'), emptyCoverage('tcg')]
        })
    Promise.all([cardPromise, statsPromise])
      .then(([loadedCards, loadedStats]) => {
        setCards(loadedCards)
        setStats(loadedStats)
        if (loadedCards[0]) setSelectedId(loadedCards[0].id)
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : '無法載入本機圖鑑資料庫。')
      })
    if (catalogApi) void catalogApi.updatePolicies().then(setSourcePolicies).catch(() => undefined)
  }, [])

  useEffect(() => {
    const cleanup: (() => void)[] = []
    const commands = window.arcana?.commands
    const filters = window.arcana?.filters
    if (commands) {
      cleanup.push(commands.onNavigate(setView))
      cleanup.push(commands.onFocusSearch(() => {
        setView('catalog')
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-card-search]')?.focus())
      }))
      cleanup.push(commands.onClearFilters(() => {
        setQuery('')
        setAdvancedFilter(createEmptyFilterCriteria())
      }))
    }
    if (filters) {
      cleanup.push(filters.onApplied(setAdvancedFilter))
      void filters.getDraft().then(setAdvancedFilter).catch(() => undefined)
    }

    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setView('catalog')
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-card-search]')?.focus())
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => {
      cleanup.forEach((dispose) => dispose())
      window.removeEventListener('keydown', handleShortcut)
    }
  }, [])

  const selectedCard = cards.find((card) => card.id === selectedId) ?? cards[0]

  useEffect(() => {
    if (!selectedCard) return
    setArtworkId((current) => selectedCard.artworks.some((artwork) => artwork.id === current)
      ? current
      : selectedCard.artworks[0]?.id ?? '')
    setRuleset(selectedCard.ruleTexts[0]?.ruleset ?? 'ocg-master')
  }, [selectedCard?.id])

  const filteredCards = useMemo(() => {
    return cards.filter((card) => matchesCardTextQuery(card, query) && matchesCardFilter(card, advancedFilter))
  }, [advancedFilter, cards, query])

  useEffect(() => {
    if (filteredCards.length > 0 && !filteredCards.some((card) => card.id === selectedId)) {
      setSelectedId(filteredCards[0].id)
    }
  }, [filteredCards, selectedId])

  const activeRuleText =
    selectedCard?.ruleTexts.find((variant) => variant.ruleset === ruleset) ?? selectedCard?.ruleTexts[0]

  const openStudio = (): void => {
    setView('studio')
  }

  const openAdvancedFilters = (): void => {
    void window.arcana?.filters.open(advancedFilter)
  }

  const clearFilters = (): void => {
    const empty = createEmptyFilterCriteria()
    setQuery('')
    setAdvancedFilter(empty)
    void window.arcana?.filters.apply(empty)
  }

  const setDirectoryPageRows = (rows: DirectoryPageRows): void => {
    setDirectoryPageRowsState(rows)
    window.localStorage.setItem('arcana-directory-page-rows', String(rows))
    void window.arcana?.settings?.setDirectoryPageRows(rows).catch(() => undefined)
  }

  const setDirectoryShowArtworkVariants = (show: boolean): void => {
    setDirectoryShowArtworkVariantsState(show)
    window.localStorage.setItem('arcana-directory-show-artwork-variants', String(show))
    void window.arcana?.settings?.setDirectoryShowArtworkVariants(show).catch(() => undefined)
  }

  const toggleUnpopular = async (card: CatalogCard): Promise<void> => {
    if (popularityOperationRef.current) return
    popularityOperationRef.current = true
    const nextValue = !card.isUnpopular
    const catalogApi = window.arcana?.catalog
    setPopularityBusyId(card.id)
    setPopularityNotice(null)
    try {
      if (catalogApi) {
        const changed = await catalogApi.setUnpopular(card.id, nextValue)
        if (!changed) throw new Error('找不到要標記的卡片。')
      }
      setCards((current) => current.map((item) => item.id === card.id ? { ...item, isUnpopular: nextValue } : item))
      setPopularityNotice({ cardId: card.id, tone: 'success', text: nextValue ? '已標記為冷門卡片。' : '已移除冷門卡片標記。' })
    } catch (error: unknown) {
      setPopularityNotice({
        cardId: card.id,
        tone: 'error',
        text: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : '無法儲存冷門卡片標記。'
      })
    } finally {
      setPopularityBusyId(null)
      popularityOperationRef.current = false
    }
  }

  const setUnpopularBatch = async (cardIds: string[], isUnpopular: boolean): Promise<UnpopularBatchResult> => {
    if (popularityOperationRef.current) {
      return { savedIds: [], failures: cardIds.map((id) => ({ id, message: '請等待目前的標記作業完成。' })) }
    }
    popularityOperationRef.current = true
    setPopularityBatchBusy(true)
    try {
      const catalogApi = window.arcana?.catalog
      const result = catalogApi?.setUnpopularBatch
        ? await catalogApi.setUnpopularBatch(cardIds, isUnpopular)
        : await setSelectedUnpopular(cardIds, isUnpopular, catalogApi?.setUnpopular ?? (async () => true))
      const saved = new Set(result.savedIds)
      setCards((current) => current.map((card) => saved.has(card.id) ? { ...card, isUnpopular } : card))
      return result
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '')
        : '無法儲存批次冷門卡片標記。'
      return { savedIds: [], failures: cardIds.map((id) => ({ id, message })) }
    } finally {
      popularityOperationRef.current = false
      setPopularityBatchBusy(false)
    }
  }

  const runCatalogUpdate = async (request: CatalogUpdateRequest): Promise<void> => {
    const catalogApi = window.arcana?.catalog
    if (!catalogApi) {
      setUpdateNotice({ tone: 'error', text: '瀏覽器預覽模式無法寫入本機資料庫，請由 Electron 應用程式執行更新。' })
      return
    }
    setUpdateCommandBusy(true)
    setUpdateNotice(null)
    try {
      acceptUpdateState(await catalogApi.startUpdate(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : '更新失敗，本機資料未變更。'
      setUpdateNotice({ tone: 'error', text: message })
      void catalogApi.stats().then(setStats).catch(() => undefined)
    } finally {
      setUpdateCommandBusy(false)
    }
  }

  const controlCatalogUpdate = async (control: CatalogUpdateControl): Promise<void> => {
    const api = window.arcana?.catalog
    if (!api || updateCommandBusy) return
    setUpdateCommandBusy(true)
    setUpdateNotice(null)
    try {
      acceptUpdateState(await api.controlUpdate(control))
    } catch (error: unknown) {
      setUpdateNotice({ tone: 'error', text: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : '無法變更更新作業狀態。' })
    } finally {
      setUpdateCommandBusy(false)
    }
  }

  if (loadError) {
    return (
      <main className="fatal-state">
        <span className="fatal-rune">◇</span>
        <h1>圖鑑暫時無法開啟</h1>
        <p>{loadError}</p>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark"><span>AA</span></div>
          <div>
            <strong>秘藏決鬥圖鑑</strong>
            <small>ARCANA ARCHIVE</small>
          </div>
        </div>

        <div className="sidebar-collection">
          <p>典藏分類</p>
          <button type="button"><Glyph>✦</Glyph> 我的最愛 <span>12</span></button>
          <button type="button"><Glyph>◫</Glyph> 經典王牌 <span>08</span></button>
          <button type="button"><Glyph>⌁</Glyph> 待整理 <span>03</span></button>
        </div>

        <div className="data-status">
          <div><span className="status-dot" /> 本機資料層</div>
          <strong>{stats?.cards ?? '—'} 張卡片・{stats?.artworks ?? '—'} 幅插圖</strong>
          <small>{coverageSummary(stats?.coverage)}</small>
        </div>
        <button type="button" className={`update-center-nav ${view === 'updates' ? 'is-active' : ''}`} onClick={() => setView('updates')}>
          <Glyph>⇩</Glyph><span><strong>資料更新中心</strong><small>{updateState && !['idle', 'completed', 'cancelled'].includes(updateState.status) ? `更新${updateState.status === 'cooling' ? '冷卻中' : ['paused', 'blocked'].includes(updateState.status) ? '已暫停' : '進行中'}・${Math.floor(updateState.progress?.percent ?? 0)}%` : '中文來源・續傳進度'}</small></span>
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <span className="eyebrow">PERSONAL DUEL ARCHIVE</span>
            <h1>{viewTitles[view]}</h1>
          </div>
          <div className="topbar-actions">
            <span className="menu-hint">功能請使用上方選單</span>
            <span className="prototype-pill">PROTOTYPE 0.1</span>
          </div>
        </header>

        {view === 'catalog' ? (
          <CatalogView
            cards={filteredCards}
            selectedCard={selectedCard}
            query={query}
            filterCount={countFilterConditions(advancedFilter)}
            artworkId={artworkId}
            ruleset={ruleset}
            activeRuleText={activeRuleText?.textZh ?? ''}
            textMode={textMode}
            onQuery={setQuery}
            onOpenAdvancedFilters={openAdvancedFilters}
            onClearFilters={clearFilters}
            onSelect={setSelectedId}
            onArtwork={setArtworkId}
            onRuleset={setRuleset}
            onTextMode={setTextMode}
            onOpenStudio={openStudio}
            onToggleUnpopular={(card) => { void toggleUnpopular(card) }}
            onSetUnpopularBatch={setUnpopularBatch}
            popularityBusyId={popularityBusyId}
            popularityBatchBusy={popularityBatchBusy}
            popularityNotice={popularityNotice}
            directoryPageRows={directoryPageRows}
            onDirectoryPageRows={setDirectoryPageRows}
            directoryShowArtworkVariants={directoryShowArtworkVariants}
            onDirectoryShowArtworkVariants={setDirectoryShowArtworkVariants}
          />
        ) : view === 'updates' ? (
          <UpdateCenterView
            stats={stats}
            policies={sourcePolicies}
            busy={updateBusy}
            state={updateState}
            commandBusy={updateCommandBusy}
            onControl={controlCatalogUpdate}
            notice={updateNotice}
            onUpdate={runCatalogUpdate}
            onCatalog={() => setView('catalog')}
          />
        ) : view === 'studio' ? (
          selectedCard && (
            <StudioView
              card={selectedCard}
              artworkId={artworkId}
              ruleset={ruleset}
              ruleText={activeRuleText?.textZh ?? ''}
              finish={finish}
              textMode={textMode}
              onArtwork={setArtworkId}
              onRuleset={setRuleset}
              onFinish={setFinish}
              onBack={() => setView('catalog')}
            />
          )
        ) : (
          <ReservedView view={view} onCatalog={() => setView('catalog')} />
        )}
      </main>
    </div>
  )
}

interface CatalogViewProps {
  cards: CatalogCard[]
  selectedCard?: CatalogCard
  query: string
  filterCount: number
  artworkId: string
  ruleset: string
  activeRuleText: string
  textMode: CardTextMode
  onQuery: (value: string) => void
  onOpenAdvancedFilters: () => void
  onClearFilters: () => void
  onSelect: (value: string) => void
  onArtwork: (value: string) => void
  onRuleset: (value: string) => void
  onTextMode: (value: CardTextMode) => void
  onOpenStudio: () => void
  onToggleUnpopular: (card: CatalogCard) => void
  onSetUnpopularBatch: (cardIds: string[], isUnpopular: boolean) => Promise<UnpopularBatchResult>
  popularityBusyId: string | null
  popularityBatchBusy: boolean
  popularityNotice: { cardId: string; tone: 'success' | 'error'; text: string } | null
  directoryPageRows: DirectoryPageRows
  onDirectoryPageRows: (rows: DirectoryPageRows) => void
  directoryShowArtworkVariants: boolean
  onDirectoryShowArtworkVariants: (show: boolean) => void
}

type CatalogLayout = 'focus' | 'directory'

interface DirectoryCardItem {
  id: string
  card: CatalogCard
  artworkId: string
  artworkLabel: string
  fullCardImage: boolean
}

const thumbnailMemory = new Map<string, string | null>()

const cardProgressionLabel = (card: CatalogCard): string => {
  if (card.rank != null) return `RANK ${card.rank}`
  if (card.linkRating != null) return `LINK ${card.linkRating}`
  if (card.level != null) return `LV ${card.level}`
  return card.typeLine
}

const DirectoryCardArtwork = memo(function DirectoryCardArtwork({ card, artworkId, fullCardImage }: {
  card: CatalogCard
  artworkId: string
  fullCardImage: boolean
}): React.JSX.Element {
  const artwork = card.artworks.find((candidate) => candidate.id === artworkId) ?? card.artworks[0]
  const cacheKey = artwork ? `${artwork.id}::${artwork.sourceUrl ?? ''}` : artworkId
  const remembered = thumbnailMemory.get(cacheKey)
  const [artUrl, setArtUrl] = useState<string | null>(remembered ?? null)
  const [visible, setVisible] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || visible) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      setVisible(true)
      observer.disconnect()
    }, { rootMargin: '260px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible || !artwork) return
    const cached = thumbnailMemory.get(cacheKey)
    if (cached !== undefined) {
      setArtUrl(cached)
      return
    }
    setArtUrl(null)
    let active = true
    const resolver = window.arcana?.catalog.resolveArtwork ?? (() => Promise.resolve(artwork.sourceUrl))
    void resolver(artwork.id).then((resolved) => {
      thumbnailMemory.set(cacheKey, resolved)
      if (active) setArtUrl(resolved)
    }).catch(() => {
      thumbnailMemory.set(cacheKey, null)
      if (active) setArtUrl(null)
    })
    return () => {
      active = false
    }
  }, [artwork, cacheKey, visible])

  return (
    <div ref={hostRef} className={`directory-card-artwork ${fullCardImage ? 'is-full-card-source' : ''}`}>
      {artUrl ? (
        <img
          src={artUrl}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => {
            thumbnailMemory.set(cacheKey, null)
            setArtUrl(null)
          }}
        />
      ) : <span aria-hidden="true">{card.kind === 'monster' ? '✧' : card.kind === 'spell' ? '◇' : '△'}</span>}
    </div>
  )
})

function CatalogView(props: CatalogViewProps): React.JSX.Element {
  const { selectedCard } = props
  const [layout, setLayoutState] = useState<CatalogLayout>(() =>
    window.localStorage.getItem('arcana-catalog-layout') === 'directory' ? 'directory' : 'focus'
  )
  const [sortKey, setSortKey] = useState<CatalogSortKey>('catalog')
  const [sortDirection, setSortDirection] = useState<CatalogSortDirection>('asc')
  const [directoryPage, setDirectoryPage] = useState(0)
  const [directoryColumns, setDirectoryColumns] = useState(8)
  const [virtualViewport, setVirtualViewport] = useState({ scrollTop: 0, height: 0 })
  const [virtualRowMetrics, setVirtualRowMetrics] = useState({ pitch: 112, gap: 7 })
  const [batchNotice, setBatchNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const directoryGridRef = useRef<HTMLDivElement>(null)
  const directoryCardRefs = useRef(new Map<string, HTMLButtonElement>())
  const focusCardRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingDirectoryFocus = useRef<string | null>(null)
  const virtualScrollFrame = useRef(0)
  const paginationContextRef = useRef('')
  const sortedCards = useMemo(
    () => sortCatalogCards(props.cards, sortKey, sortDirection),
    [props.cards, sortDirection, sortKey]
  )
  const directoryItems = useMemo<DirectoryCardItem[]>(() => sortedCards.flatMap((card) => {
    const artworks = props.directoryShowArtworkVariants && card.artworks.length > 0
      ? card.artworks
      : [card.artworks[0]]
    return artworks.map((artwork, index) => ({
      id: props.directoryShowArtworkVariants && artwork ? `${card.id}::${artwork.id}` : card.id,
      card,
      artworkId: artwork?.id ?? '',
      artworkLabel: artwork?.variantLabel ?? `卡圖版本 ${index + 1}`,
      fullCardImage: artwork?.shardKey === 'ygoresources'
    }))
  }), [props.directoryShowArtworkVariants, sortedCards])
  const allCardsOnOnePage = props.directoryPageRows === 'all'
  const effectivePageSize = directoryPageSize(props.directoryPageRows, directoryColumns, directoryItems.length)
  const pageCount = Math.max(1, Math.ceil(directoryItems.length / effectivePageSize))
  const pageStart = directoryPage * effectivePageSize
  const directoryCards = useMemo(
    () => directoryItems.slice(pageStart, pageStart + effectivePageSize),
    [directoryItems, effectivePageSize, pageStart]
  )
  const directoryCardIds = useMemo(() => directoryCards.map((item) => item.id), [directoryCards])
  const virtualRange = calculateVirtualGridRange(
    directoryCards.length,
    directoryColumns,
    virtualRowMetrics.pitch,
    virtualViewport.scrollTop,
    virtualViewport.height
  )
  const renderedDirectoryCards = allCardsOnOnePage
    ? directoryCards.slice(virtualRange.startIndex, virtualRange.endIndex)
    : directoryCards
  const virtualTopSpace = allCardsOnOnePage && virtualRange.startRow > 0
    ? Math.max(0, virtualRange.startRow * virtualRowMetrics.pitch - virtualRowMetrics.gap)
    : 0
  const virtualRemainingRows = virtualRange.totalRows - virtualRange.endRow
  const virtualBottomSpace = allCardsOnOnePage && virtualRemainingRows > 0
    ? Math.max(0, virtualRemainingRows * virtualRowMetrics.pitch - virtualRowMetrics.gap)
    : 0
  const directoryPageJump = allCardsOnOnePage
    ? Math.max(directoryColumns, Math.floor(Math.max(virtualRowMetrics.pitch, virtualViewport.height) / virtualRowMetrics.pitch) * directoryColumns)
    : effectivePageSize
  const selectedDirectoryIndex = selectedCard ? directoryItems.findIndex((item) =>
    item.card.id === selectedCard.id && (!props.directoryShowArtworkVariants || item.artworkId === props.artworkId)
  ) : -1
  const selectedDirectoryItemId = selectedDirectoryIndex >= 0 ? directoryItems[selectedDirectoryIndex]?.id : undefined
  const markingBusy = props.popularityBatchBusy || props.popularityBusyId != null
  const paginationContext = JSON.stringify([
    layout, sortKey, sortDirection, props.directoryPageRows, directoryColumns, props.directoryShowArtworkVariants
  ])
  const directoryScope = useMemo(
    () => JSON.stringify([layout, directoryPage, sortKey, sortDirection, props.query, props.directoryPageRows, directoryCardIds]),
    [directoryCardIds, directoryPage, layout, props.directoryPageRows, props.query, sortDirection, sortKey]
  )
  const directoryScopeRef = useRef(directoryScope)
  directoryScopeRef.current = directoryScope
  const virtualHitTest: ((rect: SelectionRect) => string[]) | undefined = allCardsOnOnePage
    ? (rect) => {
        const grid = directoryGridRef.current
        const tile = directoryCardRefs.current.values().next().value
        if (!grid || !tile) return []
        const style = window.getComputedStyle(grid)
        const columnWidths = style.gridTemplateColumns.split(' ')
          .map((value) => Number.parseFloat(value))
          .filter(Number.isFinite)
        const tileBounds = tile.getBoundingClientRect()
        return cardsInsideVirtualGrid(rect, directoryCardIds, {
          columns: columnWidths.length,
          columnWidths,
          columnGap: Number.parseFloat(style.columnGap) || 0,
          paddingLeft: Number.parseFloat(style.paddingLeft) || 0,
          paddingTop: Number.parseFloat(style.paddingTop) || 0,
          rowPitch: virtualRowMetrics.pitch,
          tileWidth: tileBounds.width,
          tileHeight: tileBounds.height
        })
      }
    : undefined
  const directorySelection = useDirectorySelection({
    gridRef: directoryGridRef, cardRefs: directoryCardRefs,
    ids: directoryCardIds, scope: directoryScope,
    focusedId: selectedDirectoryItemId, disabled: markingBusy,
    onFocus: (itemId) => {
      const item = directoryItems.find((candidate) => candidate.id === itemId)
      if (item) {
        props.onSelect(item.card.id)
        props.onArtwork(item.artworkId)
      }
    },
    hitTest: virtualHitTest
  })
  const selectedBatchIds = [...new Set(directoryCards
    .filter((item) => directorySelection.selectedIds.has(item.id))
    .map((item) => item.card.id))]

  const applyDirectoryUnpopular = async (isUnpopular: boolean): Promise<void> => {
    if (markingBusy || selectedBatchIds.length === 0) return
    setBatchNotice(null)
    const result = await props.onSetUnpopularBatch(selectedBatchIds, isUnpopular)
    if (directoryScopeRef.current === directoryScope) {
      const failedCards = new Set(result.failures.map((failure) => failure.id))
      directorySelection.replaceSelection(directoryCards.filter((item) => failedCards.has(item.card.id)).map((item) => item.id))
    }
    const savedMessage = `已將 ${result.savedIds.length} 張卡片設為${isUnpopular ? '冷門' : '非冷門'}。`
    setBatchNotice({
      tone: result.failures.length > 0 ? 'error' : 'success',
      text: `${savedMessage}${result.failures.length > 0 ? ` ${result.failures.length} 張未成功：${result.failures[0].message}` : ''}${window.arcana?.catalog ? '' : '（預覽模式，不會寫入本機資料庫）'}`
    })
  }

  const setLayout = (nextLayout: CatalogLayout): void => {
    setLayoutState(nextLayout)
    window.localStorage.setItem('arcana-catalog-layout', nextLayout)
    if (nextLayout === 'directory') {
      pendingDirectoryFocus.current = selectedDirectoryItemId ?? null
    }
  }

  const updateSortKey = (nextKey: CatalogSortKey): void => {
    setSortKey(nextKey)
    setSortDirection(nextKey === 'name' || nextKey === 'type' || nextKey === 'catalog' ? 'asc' : 'desc')
  }

  const goToDirectoryPage = (nextPage: number): void => {
    const safePage = Math.max(0, Math.min(pageCount - 1, nextPage))
    setDirectoryPage(safePage)
    const firstCard = directoryItems[safePage * effectivePageSize]
    if (firstCard) {
      pendingDirectoryFocus.current = firstCard.id
      props.onSelect(firstCard.card.id)
      props.onArtwork(firstCard.artworkId)
    }
  }

  const focusDirectoryCard = (targetIndex: number): void => {
    if (directoryItems.length === 0) return
    const safeIndex = Math.max(0, Math.min(directoryItems.length - 1, targetIndex))
    const target = directoryItems[safeIndex]
    if (!target) return
    pendingDirectoryFocus.current = target.id
    setDirectoryPage(Math.floor(safeIndex / effectivePageSize))
    if (allCardsOnOnePage) {
      const grid = directoryGridRef.current
      if (grid) {
        const targetTop = Math.floor(safeIndex / Math.max(1, directoryColumns)) * virtualRowMetrics.pitch
        const targetBottom = targetTop + virtualRowMetrics.pitch - virtualRowMetrics.gap
        let nextScrollTop = grid.scrollTop
        if (targetTop < grid.scrollTop) nextScrollTop = targetTop
        else if (targetBottom > grid.scrollTop + grid.clientHeight) nextScrollTop = targetBottom - grid.clientHeight
        if (nextScrollTop !== grid.scrollTop) {
          grid.scrollTop = nextScrollTop
          setVirtualViewport({ scrollTop: nextScrollTop, height: grid.clientHeight })
        }
      }
    }
    props.onSelect(target.card.id)
    props.onArtwork(target.artworkId)
  }

  const handleDirectoryKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (directorySelection.onKeyDown(event)) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const currentIndex = selectedDirectoryIndex >= 0 ? selectedDirectoryIndex : pageStart
    let targetIndex: number | null = null
    if (event.key === 'ArrowLeft') targetIndex = currentIndex - 1
    if (event.key === 'ArrowRight') targetIndex = currentIndex + 1
    if (event.key === 'ArrowUp') targetIndex = currentIndex - directoryColumns
    if (event.key === 'ArrowDown') targetIndex = currentIndex + directoryColumns
    if (event.key === 'Home') targetIndex = event.shiftKey ? 0 : pageStart
    if (event.key === 'End') targetIndex = event.shiftKey ? directoryItems.length - 1 : Math.min(directoryItems.length - 1, pageStart + effectivePageSize - 1)
    if (event.key === 'PageUp') targetIndex = currentIndex - directoryPageJump
    if (event.key === 'PageDown') targetIndex = currentIndex + directoryPageJump
    if (event.key === 'Enter' && selectedCard) {
      event.preventDefault()
      setLayout('focus')
      return
    }
    if (targetIndex == null) return
    event.preventDefault()
    focusDirectoryCard(targetIndex)
  }

  useEffect(() => {
    const contextChanged = paginationContextRef.current !== paginationContext
    paginationContextRef.current = paginationContext
    if (layout !== 'directory') return
    if (contextChanged && selectedDirectoryIndex >= 0) {
      setDirectoryPage(Math.floor(selectedDirectoryIndex / effectivePageSize))
      pendingDirectoryFocus.current = selectedDirectoryItemId ?? null
      if (allCardsOnOnePage) {
        const grid = directoryGridRef.current
        if (grid) {
          const nextScrollTop = Math.floor(selectedDirectoryIndex / Math.max(1, directoryColumns)) * virtualRowMetrics.pitch
          grid.scrollTop = nextScrollTop
          setVirtualViewport({ scrollTop: nextScrollTop, height: grid.clientHeight })
        }
      }
      return
    }
    const safePage = clampDirectoryPage(directoryPage, directoryItems.length, effectivePageSize)
    if (safePage !== directoryPage) {
      setDirectoryPage(safePage)
      return
    }
    if (directoryItems.length === 0) return
    const selectedOutsideCurrentPage = !isIndexOnDirectoryPage(selectedDirectoryIndex, safePage, effectivePageSize)
    const selectedOutsideRenderedWindow = allCardsOnOnePage && (
      selectedDirectoryIndex < virtualRange.startIndex || selectedDirectoryIndex >= virtualRange.endIndex
    )
    if (!selectedOutsideCurrentPage && !selectedOutsideRenderedWindow) return
    const replacementIndex = allCardsOnOnePage
      ? Math.min(directoryItems.length - 1, Math.floor(virtualViewport.scrollTop / virtualRowMetrics.pitch) * directoryColumns)
      : Math.min(directoryItems.length - 1, safePage * effectivePageSize)
    const replacement = directoryItems[replacementIndex]
    if (replacement) {
      pendingDirectoryFocus.current = replacement.id
      props.onSelect(replacement.card.id)
      props.onArtwork(replacement.artworkId)
    }
  }, [directoryItems, directoryPage, effectivePageSize, layout, paginationContext])

  useEffect(() => {
    if (layout !== 'directory') return
    const grid = directoryGridRef.current
    if (!grid) return
    const measure = (): void => {
      const style = window.getComputedStyle(grid)
      const columns = style.gridTemplateColumns.split(' ').filter(Boolean).length
      setDirectoryColumns(Math.max(1, columns))
      const firstCard = directoryCardRefs.current.values().next().value
      if (firstCard) {
        const gap = Number.parseFloat(style.rowGap) || 0
        const pitch = firstCard.getBoundingClientRect().height + gap
        setVirtualRowMetrics((current) =>
          Math.abs(current.pitch - pitch) < 0.25 && current.gap === gap ? current : { pitch, gap }
        )
      }
      setVirtualViewport((current) =>
        current.scrollTop === grid.scrollTop && current.height === grid.clientHeight
          ? current
          : { scrollTop: grid.scrollTop, height: grid.clientHeight }
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [allCardsOnOnePage, directoryCards.length, layout])

  useEffect(() => () => cancelAnimationFrame(virtualScrollFrame.current), [])

  useEffect(() => {
    if (layout !== 'directory') return
    const grid = directoryGridRef.current
    if (!grid) return
    const nextScrollTop = allCardsOnOnePage && selectedDirectoryIndex >= 0
      ? Math.floor(selectedDirectoryIndex / Math.max(1, directoryColumns)) * virtualRowMetrics.pitch
      : 0
    grid.scrollTop = nextScrollTop
    setVirtualViewport({ scrollTop: nextScrollTop, height: grid.clientHeight })
    if (selectedDirectoryItemId) pendingDirectoryFocus.current = selectedDirectoryItemId
  }, [directoryPage, layout, props.directoryPageRows, props.directoryShowArtworkVariants])

  useEffect(() => {
    const cardId = pendingDirectoryFocus.current
    if (!cardId || layout !== 'directory') return
    const frame = requestAnimationFrame(() => {
      const target = directoryCardRefs.current.get(cardId)
      if (!target && allCardsOnOnePage) {
        const cardIndex = directoryCards.findIndex((item) => item.id === cardId)
        const grid = directoryGridRef.current
        if (cardIndex >= 0 && grid) {
          const nextScrollTop = Math.floor(cardIndex / Math.max(1, directoryColumns)) * virtualRowMetrics.pitch
          grid.scrollTop = nextScrollTop
          setVirtualViewport({ scrollTop: nextScrollTop, height: grid.clientHeight })
        }
        return
      }
      if (!target) return
      target.focus()
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      pendingDirectoryFocus.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [directoryPage, layout, selectedDirectoryItemId, virtualRange.endIndex, virtualRange.startIndex])

  useEffect(() => {
    if (layout !== 'focus' || !selectedCard) return
    const frame = requestAnimationFrame(() => {
      focusCardRefs.current.get(selectedCard.id)?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [layout, selectedCard?.id])

  const handleDirectoryScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    if (!allCardsOnOnePage) return
    const grid = event.currentTarget
    cancelAnimationFrame(virtualScrollFrame.current)
    virtualScrollFrame.current = requestAnimationFrame(() => {
      const nextRange = calculateVirtualGridRange(
        directoryCards.length,
        directoryColumns,
        virtualRowMetrics.pitch,
        grid.scrollTop,
        grid.clientHeight
      )
      const focusedElement = document.activeElement
      if (focusedElement instanceof HTMLButtonElement && grid.contains(focusedElement)) {
        const focusedIndex = directoryCardIds.indexOf(focusedElement.id.replace(/^directory-card-/, ''))
        if (focusedIndex < nextRange.startIndex || focusedIndex >= nextRange.endIndex) {
          grid.focus({ preventScroll: true })
        }
      }
      setVirtualViewport((current) => {
        const next = { scrollTop: grid.scrollTop, height: grid.clientHeight }
        return current.scrollTop === next.scrollTop && current.height === next.height ? current : next
      })
    })
  }

  return (
    <div className={`catalog-view catalog-mode-${layout}`}>
      <section className="search-panel">
        <div className="search-primary-row">
          <div className="search-field">
            <Glyph>⌕</Glyph>
            <input
              data-card-search
              value={props.query}
              onChange={(event) => props.onQuery(event.target.value)}
              placeholder="搜尋卡名、效果、系列、種族或密碼；密碼可用 * 與 ?…"
              aria-label="搜尋卡片"
            />
            <kbd>Ctrl K</kbd>
          </div>
          <div className="catalog-layout-switch" role="group" aria-label="卡片圖鑑檢視模式">
            <button
              type="button"
              className={layout === 'focus' ? 'is-active' : ''}
              aria-pressed={layout === 'focus'}
              onClick={() => setLayout('focus')}
            ><Glyph>▤</Glyph><span><strong>詳細檢視</strong><small>單張卡片與資訊</small></span></button>
            <button
              type="button"
              className={layout === 'directory' ? 'is-active' : ''}
              aria-pressed={layout === 'directory'}
              onClick={() => setLayout('directory')}
            ><Glyph>▦</Glyph><span><strong>網格目錄</strong><small>大量瀏覽與選取</small></span></button>
          </div>
        </div>
        <div className="filter-row">
          <button type="button" className="advanced-filter-button" onClick={props.onOpenAdvancedFilters}>
            <Glyph>⌘</Glyph>
            進階篩選條件…
            {props.filterCount > 0 && <span>{props.filterCount}</span>}
          </button>
          <span className="password-hint">密碼萬用字元：<code>*3</code> 尾號為 3，<code>12?4*</code> 的 ? 代表單一數字</span>
          <button type="button" className="filter-reset" onClick={props.onClearFilters}>清除篩選</button>
          <label className="catalog-sort-control">
            <span>排列</span>
            <select
              value={sortKey}
              onChange={(event) => updateSortKey(event.target.value as CatalogSortKey)}
              aria-label="卡片排序方式"
            >
              {catalogSortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="sort-direction-button"
            onClick={() => setSortDirection((current) => current === 'asc' ? 'desc' : 'asc')}
            aria-label={sortDirection === 'asc' ? '目前升冪，切換為降冪' : '目前降冪，切換為升冪'}
            title={sortDirection === 'asc' ? '升冪排列' : '降冪排列'}
          >{sortDirection === 'asc' ? '↑' : '↓'} <span>{sortDirection === 'asc' ? '升冪' : '降冪'}</span></button>
          <span className="result-count">找到 <strong>{sortedCards.length}</strong> 張</span>
        </div>
      </section>

      {layout === 'directory' ? (
        <section className="directory-shell" aria-label="卡片網格目錄">
          <div className="directory-browser">
            <header className="directory-heading">
              <div>
                <span className="eyebrow">CARD DIRECTORY</span>
                <h2>全卡目錄</h2>
                <p>{catalogSortLabel(sortKey)}・{sortDirection === 'asc' ? '升冪' : '降冪'}・{allCardsOnOnePage ? '全部卡片單頁（虛擬化）' : `每頁最多 ${props.directoryPageRows} 列`}{props.directoryShowArtworkVariants ? `・${directoryItems.length} 個卡圖版本` : ''}</p>
              </div>
              <div className="directory-view-settings" aria-label="網格顯示設定">
                <label className="directory-row-setting">
                  <span>每頁列數</span>
                  <select
                    aria-label="網格目錄每頁列數"
                    value={props.directoryPageRows}
                    onChange={(event) => props.onDirectoryPageRows(sanitizeDirectoryPageRows(event.target.value))}
                  >
                    {directoryPageRowOptions.map((rows) => (
                      <option key={rows} value={rows}>{rows === 'all' ? '全部擠在同一頁' : `${rows} 列`}</option>
                    ))}
                  </select>
                </label>
                <label className="directory-variant-setting">
                  <input
                    type="checkbox"
                    checked={props.directoryShowArtworkVariants}
                    onChange={(event) => props.onDirectoryShowArtworkVariants(event.target.checked)}
                  />
                  <span>顯示不同卡圖版本</span>
                </label>
              </div>
              <div className="directory-key-help" aria-label="鍵盤操作提示">
                <span><kbd>←↑↓→</kbd> 選擇鄰近卡牌</span>
                <span><kbd>Enter</kbd> 開啟詳細檢視</span>
                <span><kbd>PgUp</kbd><kbd>PgDn</kbd> {allCardsOnOnePage ? '捲動一屏' : '跨頁'}</span>
              </div>
              <div className="directory-batch-toolbar" role="group" aria-label="批次設定冷門標記">
                <span className="directory-selection-count" role="status">{props.popularityBatchBusy ? '正在設定…' : <>已選 <strong>{selectedBatchIds.length}</strong> 張</>}</span>
                <button type="button" disabled={markingBusy || directoryCards.length === 0} onClick={() => directorySelection.replaceSelection(directoryCards.map((item) => item.id))}>本頁全選</button>
                <button type="button" disabled={markingBusy || selectedBatchIds.length === 0} onClick={() => directorySelection.replaceSelection([])}>清除選取</button>
                <button type="button" className="directory-mark-unpopular" disabled={markingBusy || selectedBatchIds.length === 0} onClick={() => { void applyDirectoryUnpopular(true) }}>
                  設為冷門卡片
                </button>
                <button type="button" disabled={markingBusy || selectedBatchIds.length === 0} onClick={() => { void applyDirectoryUnpopular(false) }}>
                  設為非冷門卡片
                </button>
                <p id="directory-selection-help">拖曳框選本頁卡片；Ctrl／⌘ 點選加減、Shift 連選、Esc 清除。</p>
              </div>
              {batchNotice && <p className={`directory-batch-notice tone-${batchNotice.tone}`} role="status">{batchNotice.text}</p>}
            </header>

            {directoryCards.length > 0 ? (
              <div
                ref={directoryGridRef}
                className={`directory-card-grid ${allCardsOnOnePage ? 'is-virtualized' : ''} ${directorySelection.marquee ? 'is-box-selecting' : ''}`}
                role="grid"
                tabIndex={-1}
                aria-multiselectable="true"
                aria-describedby="directory-selection-help"
                aria-busy={props.popularityBatchBusy}
                aria-label={`${allCardsOnOnePage ? '全部' : `第 ${directoryPage + 1} 頁`}卡片，${catalogSortLabel(sortKey)}`}
                onKeyDown={handleDirectoryKeyDown}
                onScroll={handleDirectoryScroll}
                onPointerDown={directorySelection.onPointerDown}
                onClickCapture={directorySelection.onClickCapture}
                onClick={directorySelection.onBackgroundClick}
                onDragStart={(event) => event.preventDefault()}
              >
                {virtualTopSpace > 0 && <div className="directory-virtual-spacer" style={{ height: virtualTopSpace }} aria-hidden="true" />}
                {renderedDirectoryCards.map((item, renderedIndex) => {
                  const card = item.card
                  const pageIndex = allCardsOnOnePage ? virtualRange.startIndex + renderedIndex : renderedIndex
                  const isSelected = selectedDirectoryItemId === item.id
                  const isBatchSelected = directorySelection.selectedIds.has(item.id)
                  return (
                    <button
                      ref={(node) => {
                        if (node) directoryCardRefs.current.set(item.id, node)
                        else directoryCardRefs.current.delete(item.id)
                      }}
                      type="button"
                      role="gridcell"
                      key={item.id}
                      id={`directory-card-${item.id}`}
                      className={`directory-card-tile ${isSelected ? 'is-selected' : ''} ${isBatchSelected ? 'is-batch-selected' : ''} ${card.isUnpopular ? 'is-unpopular' : ''}`}
                      style={{ '--card-accent': card.accent } as React.CSSProperties}
                      tabIndex={isSelected || (selectedDirectoryIndex < 0 && pageIndex === 0) ? 0 : -1}
                      aria-selected={isBatchSelected}
                      aria-label={`${card.nameZh}，${item.artworkLabel}，${cardProgressionLabel(card)}，${card.kind === 'monster' ? `攻擊力 ${card.atk ?? '未知'}，守備力 ${card.def ?? '未知'}` : card.typeLine}`}
                      title={props.directoryShowArtworkVariants ? `${card.nameZh}・${item.artworkLabel}` : card.nameZh}
                      onClick={(event) => directorySelection.onCardClick(event, item.id)}
                      onDoubleClick={(event) => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) setLayout('focus') }}
                    >
                      <span className={`directory-card-face frame-${card.frame} ${card.pendulumScaleLeft != null ? 'is-pendulum' : ''}`}>
                        <DirectoryCardArtwork card={card} artworkId={item.artworkId} fullCardImage={item.fullCardImage} />
                        <span className="directory-card-title">{card.nameZh}</span>
                      </span>
                      {props.directoryShowArtworkVariants && <span className="directory-artwork-version">{item.artworkLabel}</span>}
                      {isBatchSelected && <span className="directory-multiselect-check" aria-hidden="true">✓</span>}
                      {card.isUnpopular && <span className="directory-unpopular-badge">冷門</span>}
                    </button>
                  )
                })}
                {virtualBottomSpace > 0 && <div className="directory-virtual-spacer" style={{ height: virtualBottomSpace }} aria-hidden="true" />}
                {directorySelection.marquee && <div className="directory-selection-marquee" style={directorySelection.marquee} aria-hidden="true" />}
              </div>
            ) : (
              <div className="empty-state directory-empty-state"><span>⌕</span><strong>沒有符合條件的卡片</strong><p>試著移除效果標籤或使用較短的關鍵字。</p></div>
            )}

            <footer className="directory-footer">
              {allCardsOnOnePage ? (
                <div className="directory-single-page">全部卡片・單頁模式</div>
              ) : (
                <div className="directory-pagination" aria-label="目錄分頁">
                  <button type="button" onClick={() => goToDirectoryPage(0)} disabled={directoryPage === 0}>«</button>
                  <button type="button" onClick={() => goToDirectoryPage(directoryPage - 1)} disabled={directoryPage === 0}>‹ 上一頁</button>
                  <span>第 <strong>{directoryPage + 1}</strong> / {pageCount} 頁</span>
                  <button type="button" onClick={() => goToDirectoryPage(directoryPage + 1)} disabled={directoryPage >= pageCount - 1}>下一頁 ›</button>
                  <button type="button" onClick={() => goToDirectoryPage(pageCount - 1)} disabled={directoryPage >= pageCount - 1}>»</button>
                </div>
              )}
              <span className="directory-range">
                {directoryItems.length > 0 ? `${pageStart + 1}–${Math.min(pageStart + effectivePageSize, directoryItems.length)} / ${directoryItems.length}` : '0 / 0'}
              </span>
            </footer>
          </div>

          <aside className="directory-preview" aria-label="所選卡片大圖與效果文字">
            {selectedCard && selectedDirectoryIndex >= 0 ? (
              <>
                <div className="directory-preview-card">
                  <CardPreview
                    key={selectedCard.id}
                    card={selectedCard}
                    artworkId={selectedCard.artworks.find((art) => art.id === props.artworkId)?.id ?? selectedCard.artworks[0]?.id ?? ''}
                    ruleText={props.activeRuleText}
                    finish={{ surface: 'none', scope: 'whole', rim: 'none', name: 'ink', stamp: false }}
                    featured
                    interactive={false}
                    embellishments={false}
                    textMode="fit"
                  />
                </div>
                <details className="directory-effects">
                  <summary><span>效果文字</span><span className="directory-effects-hint" aria-hidden="true" /></summary>
                  <div className="directory-effect-copy">
                    {selectedCard.pendulumText && (
                      <section>
                        <h3>鐘擺效果</h3>
                        <p>{selectedCard.pendulumText}</p>
                      </section>
                    )}
                    <section>
                      {selectedCard.pendulumText && <h3>怪獸效果</h3>}
                      <p>{props.activeRuleText || '尚無效果文字。'}</p>
                    </section>
                  </div>
                </details>
              </>
            ) : <div className="directory-preview-empty">選擇卡片以檢視大圖</div>}
          </aside>
        </section>
      ) : <div className="catalog-content">
        <section className="catalog-grid-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">LOCAL COLLECTION</span>
              <h2>精選卡片</h2>
            </div>
            <span>{catalogSortLabel(sortKey)}・{sortDirection === 'asc' ? '升冪' : '降冪'}</span>
          </div>
          {sortedCards.length > 0 ? (
            <div className="card-grid">
              {sortedCards.map((card) => (
                <button
                  ref={(node) => {
                    if (node) focusCardRefs.current.set(card.id, node)
                    else focusCardRefs.current.delete(card.id)
                  }}
                  type="button"
                  key={card.id}
                  className={`catalog-card ${selectedCard?.id === card.id ? 'is-selected' : ''} ${card.isUnpopular ? 'is-unpopular' : ''}`}
                  onClick={() => props.onSelect(card.id)}
                  style={{ '--card-accent': card.accent } as React.CSSProperties}
                >
                  <div className={`catalog-card-visual frame-${card.frame} ${card.pendulumScaleLeft != null ? 'is-pendulum' : ''}`}>
                    <span className="catalog-card-sigil">{card.kind === 'monster' ? '✧' : card.kind === 'spell' ? '◇' : '△'}</span>
                    <span className="catalog-card-level">
                      {card.rank
                        ? `RANK ${card.rank}`
                        : card.level
                          ? `LV ${card.level}`
                          : card.linkRating
                            ? `LINK ${card.linkRating}`
                            : card.spellTrapIcon
                              ? card.typeLine
                              : card.attribute}
                    </span>
                  </div>
                  <div className="catalog-card-copy">
                    <strong>{card.nameZh}{card.isUnpopular && <span className="unpopular-card-badge">冷門</span>}</strong>
                    <small>{card.nameJa || '—（未於 OCG 發行）'}</small>
                    <div className="mini-tags">
                      {card.effectTags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state"><span>⌕</span><strong>沒有符合條件的卡片</strong><p>試著移除效果標籤或使用較短的關鍵字。</p></div>
          )}
        </section>

        {selectedCard && (
          <section className="catalog-stage" aria-label="無加工卡片主預覽">
            <div className="catalog-stage-heading">
              <span className="eyebrow">CARD FOCUS</span>
              <strong>實卡版面預覽</strong>
              <small>此區固定顯示原始卡框，不套用加工特效</small>
              <div className="card-text-mode-toggle" role="group" aria-label="效果文字顯示方式">
                <button
                  type="button"
                  className={props.textMode === 'fit' ? 'is-active' : ''}
                  onClick={() => props.onTextMode('fit')}
                  aria-pressed={props.textMode === 'fit'}
                >自動適應</button>
                <button
                  type="button"
                  className={props.textMode === 'scroll' ? 'is-active' : ''}
                  onClick={() => props.onTextMode('scroll')}
                  aria-pressed={props.textMode === 'scroll'}
                >固定字級／捲動</button>
              </div>
            </div>
            <div className="catalog-stage-card">
              <CardPreview
                card={selectedCard}
                artworkId={props.artworkId}
                ruleText={props.activeRuleText}
                finish={{ surface: 'none', scope: 'whole', rim: 'none', name: 'ink', stamp: false }}
                featured
                interactive={false}
                embellishments={false}
                textMode={props.textMode}
              />
            </div>
            <div className="catalog-stage-foot">
              <span>{selectedCard.pendulumScaleLeft != null ? `PENDULUM / ${selectedCard.frame.toUpperCase()}` : selectedCard.frame.toUpperCase()}</span>
              <small>{selectedCard.artworks.find((art) => art.id === props.artworkId)?.variantLabel}</small>
            </div>
          </section>
        )}

        {selectedCard && (
          <aside className="card-inspector">
            <div className="inspector-title">
              <span>{selectedCard.nameJa || '—（未於 OCG 發行）'}</span>
              <h2>{selectedCard.nameZh}</h2>
              <p>{selectedCard.nameEn || '—（未於 TCG 發行）'}</p>
            </div>
            {selectedCard.sourceName && (
              <div className="card-source-note">
                <span>結構／發行</span>
                <a href={selectedCard.sourceUrl ?? 'https://ygoprodeck.com/api-guide/'} target="_blank" rel="noreferrer">
                  {selectedCard.sourceName} ↗
                </a>
                <span>語系資料</span>
                {selectedCard.localizationSourceUrl ? (
                  <a href={selectedCard.localizationSourceUrl} target="_blank" rel="noreferrer">
                    {selectedCard.localizationSourceName ?? '中文來源'} ↗
                  </a>
                ) : <strong>{selectedCard.localizationSourceName ?? '尚無中文來源'}</strong>}
                <small>
                  {selectedCard.ocgReleaseDate ? `OCG ${selectedCard.ocgReleaseDate}` : ''}
                  {selectedCard.ocgReleaseDate && selectedCard.tcgReleaseDate ? '・' : ''}
                  {selectedCard.tcgReleaseDate ? `TCG ${selectedCard.tcgReleaseDate}` : ''}
                  {!selectedCard.ocgReleaseDate && !selectedCard.tcgReleaseDate ? (selectedCard.releaseRegion?.toUpperCase() ?? 'OCG/TCG') : ''}
                  {`・語系 ${(selectedCard.supportedLanguages ?? ['zh', 'en', 'ja']).map((language) => language === 'zh' ? '中' : language === 'en' ? '英' : '日').join('／')}`}
                  {`（必要 ${(selectedCard.requiredLanguages ?? ['zh', 'en', 'ja']).map((language) => language === 'zh' ? '中' : language === 'en' ? '英' : '日').join('／')}）`}
                  {selectedCard.localizationStatus === 'zh-tw-converted' ? '・中文來源經 OpenCC 轉為台灣正體' : '・保留人工整理文字'}
                </small>
              </div>
            )}
            <div className="stat-strip">
              <span><small>屬性</small><strong>{selectedCard.attribute}</strong></span>
              <span><small>種族</small><strong>{selectedCard.race}</strong></span>
              <span><small>{selectedCard.rank ? '階級' : selectedCard.linkRating ? '連結值' : '等級'}</small><strong>{selectedCard.rank ?? selectedCard.linkRating ?? selectedCard.level ?? '—'}</strong></span>
              <span><small>數值</small><strong>{selectedCard.kind === 'monster' ? `${selectedCard.atk}/${selectedCard.def ?? '—'}` : '—'}</strong></span>
            </div>

            <div className="inspector-group">
              <div className="group-label"><span>卡圖版本</span><small>{selectedCard.artworks.length} 幅</small></div>
              <div className="artwork-switcher">
                {selectedCard.artworks.map((art, index) => (
                  <button
                    type="button"
                    key={art.id}
                    className={props.artworkId === art.id ? 'is-active' : ''}
                    onClick={() => props.onArtwork(art.id)}
                    title={art.variantLabel}
                  >{String(index + 1).padStart(2, '0')}</button>
                ))}
              </div>
            </div>

            <div className="inspector-group">
              <div className="group-label"><span>效果版本</span><small>{selectedCard.ruleTexts.length} 種</small></div>
              <select className="full-select" value={props.ruleset} onChange={(event) => props.onRuleset(event.target.value)}>
                {selectedCard.ruleTexts.map((variant) => <option key={variant.ruleset} value={variant.ruleset}>{variant.label}</option>)}
              </select>
              <h3 className="effect-heading">卡片描述</h3>
              <p className="effect-copy">{props.activeRuleText}</p>
            </div>

            <div className="tag-cluster">
              {selectedCard.effectTags.map((tag) => <span key={tag}>{tag}</span>)}
              {selectedCard.relations.map((tag) => <span className="relation-tag" key={tag}>#{tag}</span>)}
            </div>

            <button
              type="button"
              className={`popularity-toggle ${selectedCard.isUnpopular ? 'is-active' : ''}`}
              disabled={props.popularityBusyId != null || props.popularityBatchBusy}
              onClick={() => props.onToggleUnpopular(selectedCard)}
            >
              <Glyph>{selectedCard.isUnpopular ? '◉' : '○'}</Glyph>
              <span>
                <strong>{selectedCard.isUnpopular ? '已標記為冷門卡片' : '標記為冷門卡片'}</strong>
                <small>{selectedCard.isUnpopular ? '可在進階篩選取消隱藏，或按此移除標記' : '只影響本機顯示與篩選，不修改來源資料'}</small>
              </span>
            </button>
            {props.popularityNotice?.cardId === selectedCard.id && (
              <p className={`popularity-notice tone-${props.popularityNotice.tone}`} role="status">{props.popularityNotice.text}</p>
            )}

            <button type="button" className="primary-action" onClick={props.onOpenStudio}>
              <span>進入藝術加工室</span><Glyph>↗</Glyph>
            </button>
          </aside>
        )}
      </div>}
    </div>
  )
}

const describeUpdateResult = (result: CatalogUpdateResult): string => {
  const scope = `${result.region.toUpperCase()} ${result.year} 年 ${result.month} 月`
  const counts = `讀取 ${result.fetched} 張、語系完整 ${result.localized} 張，新增 ${result.inserted} 張、更新 ${result.updated} 張`
  const languageGaps = [
    result.languageGaps.zh > 0 ? `中文 ${result.languageGaps.zh}` : '',
    result.languageGaps.en > 0 ? `英文 ${result.languageGaps.en}` : '',
    result.languageGaps.ja > 0 ? `日文 ${result.languageGaps.ja}` : ''
  ].filter(Boolean).join('、')
  if (result.mode === 'month') {
    const suffix = result.missingRequiredLanguages > 0
      ? `；${result.missingRequiredLanguages} 張已另存缺漏清單（${languageGaps}），不影響其他卡片更新`
      : ''
    return `${scope} 單月更新完成：${counts}${suffix}。`
  }
  const coverage = result.releaseCompleteThrough
    ? `資料已完整涵蓋至發行日 ${result.releaseCompleteThrough}`
    : '尚未完成第一個發行月份'
  if (result.limitReached) {
    const stopReason = result.stoppedBy === 'metadata-request-limit'
      ? '已達 YGOPRODeck 本次請求上限'
      : result.stoppedBy === 'chinese-card-limit'
        ? '已達百鴿中文來源本次流量上限'
        : '已依來源規則停止'
    return `${counts}；${stopReason}。${coverage}${result.resumeMonth ? `，下次由 ${result.resumeMonth} 接續` : ''}。`
  }
  return `${counts}；${coverage}。`
}

const emptyCoverage = (region: ReleaseRegion): CatalogCoverage => ({
  region,
  completeThrough: null,
  scannedThrough: null,
  pendingCards: 0,
  resumeMonth: null,
  resumeOffset: 0,
  targetMonth: null,
  status: 'not-started',
  note: null
})

const coverageSummary = (coverage?: CatalogCoverage[]): string => {
  const ocg = coverage?.find((item) => item.region === 'ocg')
  const tcg = coverage?.find((item) => item.region === 'tcg')
  if (!ocg?.scannedThrough && !tcg?.scannedThrough) return '尚未建立發行月份掃描進度'
  return `已掃描 OCG ${ocg?.scannedThrough ?? '未開始'}・TCG ${tcg?.scannedThrough ?? '未開始'}；待補 ${(ocg?.pendingCards ?? 0) + (tcg?.pendingCards ?? 0)} 張`
}

const coverageStatusText = (coverage: CatalogCoverage): string => {
  if (coverage.status === 'complete') return '已達指定目標'
  if (coverage.status === 'complete-with-gaps') return '掃描完成・仍有待補資料'
  if (coverage.status === 'source-limit') return '已到本次流量上限'
  if (coverage.status === 'waiting-language') return '舊進度待接續，缺漏將另存清單'
  return '尚未開始'
}

function UpdateCenterView({
  stats,
  policies,
  busy,
  state,
  commandBusy,
  onControl,
  notice,
  onUpdate,
  onCatalog
}: {
  stats: CatalogStats | null
  policies: CatalogSourcePolicy[]
  busy: boolean
  state: CatalogUpdateState | null
  commandBusy: boolean
  onControl: (control: CatalogUpdateControl) => Promise<void>
  notice: { tone: 'success' | 'error' | 'info'; text: string } | null
  onUpdate: (request: CatalogUpdateRequest) => Promise<void>
  onCatalog: () => void
}): React.JSX.Element {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [region, setRegion] = useState<ReleaseRegion>('ocg')
  const [mode, setMode] = useState<Exclude<CatalogUpdateMode, 'repair'>>('month')
  useEffect(() => {
    if (!state?.request) return
    setYear(state.request.year)
    setMonth(state.request.month)
    setRegion(state.request.region)
    setMode(state.request.mode === 'repair' ? 'through' : state.request.mode)
  }, [state?.request?.year, state?.request?.month, state?.request?.region, state?.request?.mode])
  const years = Array.from({ length: today.getFullYear() + 2 - 1999 }, (_, index) => today.getFullYear() + 1 - index)
  const coverage = (stats?.coverage ?? [emptyCoverage('ocg'), emptyCoverage('tcg')]).map((item) =>
    state?.progress?.coverage.region === item.region && ['running', 'cooling', 'pausing', 'cancelling'].includes(state.status) ? state.progress.coverage : item)
  const activeCoverage = coverage.find((item) => item.region === region) ?? emptyCoverage(region)

  return (
    <div className="update-center-view">
      <section className="update-center-hero">
        <div>
          <button type="button" className="back-button" onClick={onCatalog}>← 返回卡片圖鑑</button>
          <span className="eyebrow">RELEASE DATA COVERAGE</span>
          <h2>可續傳的多語卡片資料更新</h2>
          <p>儘可能匯入可用卡片；必要語系缺漏會保存到下方清單，繼續處理後面的卡片，不會因此暫停。OCG 要求中文卡名與效果文；TCG 另要求英文，跨區卡另需日文。已掃描進度與完整涵蓋範圍分開顯示。</p>
        </div>
        <div className="coverage-grid">
          {coverage.map((item) => (
            <article key={item.region} className={item.region === region ? 'is-active' : ''}>
              <span>{item.region.toUpperCase()}</span>
              <strong>{item.scannedThrough ?? '尚未開始'}</strong>
              <small>已掃描至此發行日（可能有待補資料）</small>
              <p>完整涵蓋：{item.completeThrough ?? '尚未建立'}・待補 {item.pendingCards} 張</p>
              <em>{coverageStatusText(item)}</em>
              {item.resumeMonth && <p>續傳：{item.resumeMonth}{item.resumeOffset ? `，月內第 ${item.resumeOffset + 1} 張` : ''}</p>}
              {item.note && <p className="coverage-note">{item.note}</p>}
            </article>
          ))}
        </div>
      </section>

      <div className="update-center-layout">
        <section className="update-config-card">
          <span className="eyebrow">UPDATE SCOPE</span>
          <h3>選擇更新範圍</h3>
          <div className="update-mode-switch" role="group" aria-label="更新方式">
            <button type="button" disabled={busy} className={mode === 'month' ? 'is-active' : ''} onClick={() => setMode('month')}>指定單一月份</button>
            <button type="button" disabled={busy} className={mode === 'through' ? 'is-active' : ''} onClick={() => setMode('through')}>截至指定年月的全部卡片</button>
          </div>
          <p className="update-mode-note">
            {mode === 'month'
              ? '只更新所選月份，不推進連續掃描游標；若補齊既有缺漏，完整涵蓋範圍會同步更新。'
              : `從 ${activeCoverage.resumeMonth ?? (activeCoverage.scannedThrough ? '下一個未掃描月份' : region === 'ocg' ? '1999-01' : '2002-01')} 接續；缺漏另存清單，每批達上限後冷卻 30 秒並自動繼續。`}
          </p>
          <form
            className="update-center-form"
            onSubmit={(event) => {
              event.preventDefault()
              void onUpdate({ mode, year, month, region })
            }}
          >
            <label>
              <span>發行地區</span>
              <select value={region} disabled={busy} onChange={(event) => setRegion(event.target.value as ReleaseRegion)}>
                <option value="ocg">OCG（日本發行日）</option>
                <option value="tcg">TCG（英語圈發行日）</option>
              </select>
            </label>
            <label>
              <span>{mode === 'through' ? '截止年份' : '發行年份'}</span>
              <select value={year} disabled={busy} onChange={(event) => setYear(Number(event.target.value))}>
                {years.map((value) => <option key={value} value={value}>{value} 年</option>)}
              </select>
            </label>
            <label>
              <span>{mode === 'through' ? '截止月份（含）' : '發行月份'}</span>
              <select value={month} disabled={busy} onChange={(event) => setMonth(Number(event.target.value))}>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>{value} 月</option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy}>
              {busy ? state && ['paused', 'blocked'].includes(state.status) ? '作業已暫停，請繼續或取消' : '更新作業已啟動…' : mode === 'through' ? `自動更新至 ${year} 年 ${month} 月` : `更新 ${year} 年 ${month} 月`}
            </button>
          </form>
          {state?.request && <UpdateProgressPanel state={state} commandBusy={commandBusy} onControl={onControl} />}
          {notice && <div className={`update-notice tone-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
          <PendingCardsPanel region={region} year={year} month={month} busy={busy}
            refreshKey={`${state?.status}-${state?.batchNumber}-${activeCoverage.pendingCards}-${state?.deferred}`} onUpdate={onUpdate} />
        </section>

        <aside className="source-policy-panel">
          <span className="eyebrow">SOURCE-SPECIFIC LIMITS</span>
          <h3>來源與獨立流量政策</h3>
          <div className="source-policy-list">
            {policies.map((policy) => (
              <article key={policy.id}>
                <header><strong>{policy.name}</strong><span>{policy.language}</span></header>
                <p>{policy.role}</p>
                <dl>
                  <div><dt>批次</dt><dd>{policy.batchSize} 張</dd></div>
                  <div><dt>間隔</dt><dd>{policy.requestIntervalMs / 1000} 秒</dd></div>
                  <div><dt>單次請求</dt><dd>{policy.maxRequestsPerRun} 次</dd></div>
                  <div><dt>單次卡片</dt><dd>{policy.maxCardsPerRun} 張</dd></div>
                </dl>
                <a href={policy.guideUrl} target="_blank" rel="noreferrer">查看來源規格 ↗</a>
              </article>
            ))}
          </div>
          <p className="source-policy-foot">以上為本程式採用的保守流量上限。每輪達上限後至少冷卻 30 秒；單一背景作業會保留各來源的請求間隔。卡圖仍只在查看時下載並快取。</p>
        </aside>
      </div>
    </div>
  )
}

const missingFieldLabels: Record<CatalogMissingField, string> = {
  nameZh: '中文卡名', ruleTextZh: '中文效果文', nameEn: '英文卡名', nameJa: '日文卡名'
}

function PendingCardsPanel({ region, year, month, busy, refreshKey, onUpdate }: {
  region: ReleaseRegion; year: number; month: number; busy: boolean; refreshKey: string
  onUpdate: (request: CatalogUpdateRequest) => Promise<void>
}): React.JSX.Element {
  const [page, setPage] = useState(0)
  const [pending, setPending] = useState<CatalogPendingPage>({ total: 0, items: [] })
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setPage(0) }, [region])
  useEffect(() => {
    const api = window.arcana?.catalog
    if (!api) return
    let mounted = true
    void api.pendingCards(region, page).then((result) => {
      if (!mounted) return
      setPending(result)
      setError(null)
      if (page > 0 && page * 50 >= result.total) setPage(Math.max(0, Math.ceil(result.total / 50) - 1))
    }).catch(() => { if (mounted) setError('無法讀取缺漏清單，請重新開啟更新中心。') })
    return () => { mounted = false }
  }, [region, page, refreshKey])
  return <section className="pending-cards-panel" aria-label="待補資料清單">
    <header><div><h3>待補資料清單</h3><p>{region.toUpperCase()} 共 {pending.total} 張・已保存於本機，關閉程式仍保留</p></div></header>
    <p>正常更新不會重試已掃描的缺口。需要補齊時，可只重試所選地區截至 {year} 年 {month} 月的缺漏卡片；每張本輪只試一次，仍缺資料的會留待日後。</p>
    <button type="button" disabled={busy || pending.total === 0 || error != null}
      onClick={() => { void onUpdate({ mode: 'repair', region, year, month }) }}>只重試缺漏卡片</button>
    {error ? <p role="alert">{error}</p> : pending.total === 0 ? <p>目前沒有待補的語系缺漏。</p> : <>
      <div className="pending-cards-table"><table><thead><tr><th>卡片／發行月份</th><th>缺漏內容</th><th>檢查記錄</th></tr></thead><tbody>
        {pending.items.map((card) => <tr key={card.passcode}>
          <td><a href={card.sourceUrl} target="_blank" rel="noreferrer">{card.name}</a><small>{card.passcode}・{card.releaseMonth}</small></td>
          <td>{card.missingFields.map((field) => missingFieldLabels[field]).join('、')}<small>{card.reason}</small></td>
          <td>{card.attempts} 次<small>最近：{new Date(card.lastCheckedAt).toLocaleString('zh-TW')}</small><small>首次：{new Date(card.firstSeenAt).toLocaleDateString('zh-TW')}</small></td>
        </tr>)}
      </tbody></table></div>
      <div className="pending-pagination"><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>上一頁</button>
        <span>第 {page + 1}／{Math.max(1, Math.ceil(pending.total / 50))} 頁</span>
        <button type="button" disabled={(page + 1) * 50 >= pending.total} onClick={() => setPage(page + 1)}>下一頁</button></div>
    </>}
  </section>
}

function UpdateProgressPanel({ state, commandBusy, onControl }: {
  state: CatalogUpdateState
  commandBusy: boolean
  onControl: (control: CatalogUpdateControl) => Promise<void>
}): React.JSX.Element {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (state.status !== 'cooling') return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [state.status, state.nextBatchAt])
  const progress = state.progress
  const percent = progress?.percent ?? 0
  const waiting = state.status === 'cooling'
  const paused = state.status === 'paused' || state.status === 'blocked'
  const stopping = state.status === 'pausing' || state.status === 'cancelling'
  const active = state.status === 'running' || waiting
  const seconds = Math.max(0, Math.ceil(((state.nextBatchAt ?? now) - now) / 1000))
  const labels: Record<CatalogUpdateState['status'], string> = {
    idle: '尚未開始', running: '更新中', cooling: '安全冷卻中', pausing: '正在暫停',
    paused: '已暫停', cancelling: '正在取消', cancelled: '已取消', completed: '作業結束', blocked: '需要處理・已暫停'
  }
  return (
    <section className={`update-progress-panel status-${state.status}`} aria-label="更新作業進度">
      <header>
        <div><strong>{labels[state.status]}{state.request?.mode === 'repair' ? '・缺漏補查' : ''}</strong><span>{state.request?.region.toUpperCase()}・{state.request?.year}-{String(state.request?.month).padStart(2, '0')}・第 {state.batchNumber} 批</span></div>
        <b>{percent >= 100 ? '100' : (Math.floor(percent * 10) / 10).toFixed(1)}%</b>
      </header>
      <progress max={100} value={percent} aria-label={state.request?.mode === 'repair' ? '本輪缺漏補查進度' : '發行月份掃描進度'} />
      {progress && <p className="update-progress-detail">
        {state.request?.mode === 'through' && `已掃描 ${progress.completedMonths}／${progress.totalMonths} 個發行月份（含先前進度）；`}
        {state.request?.mode === 'repair' ? '本輪補查' : progress.currentMonth}：{progress.monthTotal == null ? '讀取月份清單' : `${state.request?.mode === 'repair' ? '' : '月內 '}${progress.monthProcessed}／${progress.monthTotal} 張`}
      </p>}
      <div className="update-progress-counts"><span>本作業已檢查 <strong>{state.fetched}</strong> 張</span><span>新增 <strong>{state.inserted}</strong> 張</span><span>更新 <strong>{state.updated}</strong> 張</span><span>另存待補 <strong>{state.deferred}</strong> 張</span></div>
      <p role="status">{state.message}</p>
      {waiting && <p className="update-countdown">{seconds > 0 ? `${seconds} 秒後自動接續` : '即將自動接續…'}・不需再次按更新</p>}
      {state.lastResult?.mode === 'month' && state.status === 'completed' && <p>{describeUpdateResult(state.lastResult)}</p>}
      <div className="update-progress-actions">
        {active && <button type="button" disabled={commandBusy} onClick={() => { void onControl('pause') }}>暫停更新</button>}
        {paused && <button type="button" disabled={commandBusy} onClick={() => { void onControl('resume') }}>繼續更新</button>}
        {(active || paused || stopping) && <button type="button" className="cancel-update" disabled={commandBusy || state.status === 'cancelling'} onClick={() => { void onControl('cancel') }}>取消作業</button>}
      </div>
      <small>{state.request?.mode === 'repair' ? '補查進度以本輪開始時的缺漏清單計算，每張只試一次。' : '進度條代表已掃描的月份及月內位置，100% 不代表沒有缺漏；缺漏另存清單。'}切換頁面不會中斷作業；關閉程式會停止，已保存進度與缺漏清單會保留。</small>
    </section>
  )
}

interface StudioViewProps {
  card: CatalogCard
  artworkId: string
  ruleset: string
  ruleText: string
  finish: FinishConfig
  textMode: CardTextMode
  onArtwork: (value: string) => void
  onRuleset: (value: string) => void
  onFinish: (value: FinishConfig) => void
  onBack: () => void
}

function StudioView(props: StudioViewProps): React.JSX.Element {
  const patchFinish = (next: Partial<FinishConfig>): void => props.onFinish({ ...props.finish, ...next })

  return (
    <div className="studio-view">
      <div className="studio-toolbar">
        <button type="button" className="back-button" onClick={props.onBack}>← 返回圖鑑</button>
        <div className="selected-card-crumb">
          <span style={{ background: props.card.accent }} />
          <div><small>目前加工卡片</small><strong>{props.card.nameZh}</strong></div>
        </div>
        <button type="button" className="ghost-button" onClick={() => props.onFinish(defaultFinish)}>還原示範設定</button>
      </div>

      <div className="studio-layout">
        <aside className="finish-controls">
          <div className="control-heading"><span className="control-index">01</span><div><strong>表面加工</strong><small>Surface processing</small></div></div>
          <div className="surface-grid">
            {surfaceOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                className={`surface-swatch swatch-${option.id} ${props.finish.surface === option.id ? 'is-active' : ''}`}
                onClick={() => patchFinish({ surface: option.id })}
              >
                <span className="swatch-preview" />
                <strong>{option.label}</strong>
                <small>{option.note}</small>
              </button>
            ))}
          </div>

          <div className="control-heading"><span className="control-index">02</span><div><strong>套用範圍</strong><small>Layer mask</small></div></div>
          <SegmentedControl<SurfaceScope>
            value={props.finish.scope}
            options={[['whole', '整張卡片'], ['art', '圖片區'], ['frame', '外框']]}
            onChange={(scope) => patchFinish({ scope })}
          />

          <div className="control-heading"><span className="control-index">03</span><div><strong>邊框與卡名</strong><small>Independent layers</small></div></div>
          <label className="studio-label">
            <span>邊框加工</span>
            <select value={props.finish.rim} onChange={(event) => patchFinish({ rim: event.target.value as RimEffect })}>
              <option value="none">原始邊框</option>
              <option value="black-metal">黑金屬</option>
              <option value="silver">銀</option>
              <option value="gold">金</option>
            </select>
          </label>
          <label className="studio-label">
            <span>卡名加工</span>
            <select value={props.finish.name} onChange={(event) => patchFinish({ name: event.target.value as NameEffect })}>
              <option value="ink">原始墨色</option>
              <option value="silver">銀</option>
              <option value="gold">金</option>
            </select>
          </label>
          <label className="toggle-row">
            <span><strong>典藏印章</strong><small>獨立於表面加工</small></span>
            <input type="checkbox" checked={props.finish.stamp} onChange={(event) => patchFinish({ stamp: event.target.checked })} />
          </label>
        </aside>

        <section className="preview-bay">
          <div className="preview-bay-header">
            <div><span className="live-dot" /> 即時預覽</div>
            <small>移動游標以改變入射光方向</small>
          </div>
          <div className="preview-plinth">
            <CardPreview
              card={props.card}
              artworkId={props.artworkId}
              ruleText={props.ruleText}
              finish={props.finish}
              textMode={props.textMode}
            />
            <div className="plinth-shadow" />
          </div>
          <div className="preview-caption">
            <span>{surfaceOptions.find((option) => option.id === props.finish.surface)?.label ?? '原始'}</span>
            <strong>{props.card.nameZh}</strong>
            <small>{props.finish.scope === 'whole' ? '整卡遮罩' : props.finish.scope === 'art' ? '圖片區遮罩' : '外框遮罩'}・{props.card.artworks.find((art) => art.id === props.artworkId)?.variantLabel}</small>
          </div>
        </section>

        <aside className="studio-meta">
          <section>
            <span className="eyebrow">ARTWORK</span>
            <h3>卡圖版本</h3>
            <div className="studio-art-list">
              {props.card.artworks.map((art, index) => (
                <button type="button" key={art.id} className={props.artworkId === art.id ? 'is-active' : ''} onClick={() => props.onArtwork(art.id)}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>{art.variantLabel}</strong><small>{art.sourceName}・{art.shardKey}</small></div>
                </button>
              ))}
            </div>
          </section>
          <section>
            <span className="eyebrow">RULE TEXT</span>
            <h3>效果版本</h3>
            <select className="full-select" value={props.ruleset} onChange={(event) => props.onRuleset(event.target.value)}>
              {props.card.ruleTexts.map((variant) => <option value={variant.ruleset} key={variant.ruleset}>{variant.label}</option>)}
            </select>
            <p className="meta-note">卡圖、版面文字與加工參數互相獨立；切換規則版本不會破壞加工設定。</p>
          </section>
          <section className="layer-stack">
            <span className="eyebrow">RENDER STACK</span>
            <h3>渲染層</h3>
            <ol>
              <li><span>04</span><div><strong>反光與光源</strong><small>pointer-driven glare</small></div></li>
              <li><span>03</span><div><strong>表面加工</strong><small>{props.finish.surface}</small></div></li>
              <li><span>02</span><div><strong>卡名／邊框／印章</strong><small>independent masks</small></div></li>
              <li><span>01</span><div><strong>繁中版面與卡圖</strong><small>metadata + artwork</small></div></li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}

function ReservedView({ view, onCatalog }: { view: 'creator' | 'deck'; onCatalog: () => void }): React.JSX.Element {
  const isCreator = view === 'creator'
  return (
    <section className="reserved-view">
      <span className="reserved-letter">{isCreator ? 'C' : 'D'}</span>
      <span className="eyebrow">FUNCTION AREA</span>
      <h2>{isCreator ? '卡片創作' : '牌組工房'}</h2>
      <p>{isCreator ? '此功能區已可由「功能」選單切換；編輯器將在後續階段接入。' : '此功能區已可由「功能」選單切換；牌組編組與測試流程將在後續階段接入。'}</p>
      <button type="button" className="back-button" onClick={onCatalog}>返回卡片圖鑑</button>
    </section>
  )
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: [T, string][]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="segmented-control">
      {options.map(([id, label]) => (
        <button type="button" key={id} className={value === id ? 'is-active' : ''} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  )
}
