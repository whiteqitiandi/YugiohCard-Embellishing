import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppView,
  CatalogCard,
  CatalogCoverage,
  CatalogSourcePolicy,
  CatalogUpdateMode,
  CatalogStats,
  CatalogUpdateRequest,
  CatalogUpdateResult,
  ReleaseRegion
} from '../../shared/catalog'
import {
  countFilterConditions,
  createEmptyFilterCriteria,
  matchesCardFilter,
  matchesCardTextQuery,
  type CardFilterCriteria
} from '../../shared/filters'
import { seedCards } from '../../main/seed'
import {
  CardPreview,
  type CardTextMode,
  type FinishConfig,
  type NameEffect,
  type RimEffect,
  type SurfaceEffect,
  type SurfaceScope
} from './CardPreview'

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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateNotice, setUpdateNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [sourcePolicies, setSourcePolicies] = useState<CatalogSourcePolicy[]>([])
  const [popularityBusyId, setPopularityBusyId] = useState<string | null>(null)
  const [popularityNotice, setPopularityNotice] = useState<{ cardId: string; tone: 'success' | 'error'; text: string } | null>(null)

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
    setArtworkId(selectedCard.artworks[0]?.id ?? '')
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

  const toggleUnpopular = async (card: CatalogCard): Promise<void> => {
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
    }
  }

  const runCatalogUpdate = async (request: CatalogUpdateRequest): Promise<void> => {
    const catalogApi = window.arcana?.catalog
    if (!catalogApi) {
      setUpdateNotice({ tone: 'error', text: '瀏覽器預覽模式無法寫入本機資料庫，請由 Electron 應用程式執行更新。' })
      return
    }
    setUpdateBusy(true)
    setUpdateNotice({
      tone: 'info',
      text: `正在讀取 ${request.region.toUpperCase()} ${request.year} 年 ${request.month} 月的發行資料…`
    })
    try {
      const result = await catalogApi.runUpdate(request)
      const [loadedCards, loadedStats] = await Promise.all([catalogApi.listCards(), catalogApi.stats()])
      setCards(loadedCards)
      setStats(loadedStats)
      setSelectedId((current) => loadedCards.some((card) => card.id === current) ? current : loadedCards[0]?.id ?? '')
      setUpdateNotice({ tone: 'success', text: describeUpdateResult(result) })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : '更新失敗，本機資料未變更。'
      setUpdateNotice({ tone: 'error', text: message })
      void catalogApi.stats().then(setStats).catch(() => undefined)
    } finally {
      setUpdateBusy(false)
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
          <Glyph>⇩</Glyph><span><strong>資料更新中心</strong><small>中文來源・續傳進度</small></span>
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
            popularityBusyId={popularityBusyId}
            popularityNotice={popularityNotice}
          />
        ) : view === 'updates' ? (
          <UpdateCenterView
            stats={stats}
            policies={sourcePolicies}
            busy={updateBusy}
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
  popularityBusyId: string | null
  popularityNotice: { cardId: string; tone: 'success' | 'error'; text: string } | null
}

type CatalogLayout = 'focus' | 'directory'
type CatalogSortKey = 'catalog' | 'name' | 'atk' | 'def' | 'level' | 'release' | 'type'
type CatalogSortDirection = 'asc' | 'desc'

const directoryPageSize = 72
const thumbnailMemory = new Map<string, string | null>()

const catalogSortOptions: Array<{ value: CatalogSortKey; label: string }> = [
  { value: 'catalog', label: '圖鑑順序' },
  { value: 'name', label: '卡片名稱' },
  { value: 'atk', label: '攻擊力 ATK' },
  { value: 'def', label: '守備力 DEF' },
  { value: 'level', label: '等級／階級／LINK' },
  { value: 'release', label: '首次發行日期' },
  { value: 'type', label: '卡片種類' }
]

const catalogSortLabel = (sortKey: CatalogSortKey): string =>
  catalogSortOptions.find((option) => option.value === sortKey)?.label ?? '圖鑑順序'

const cardProgression = (card: CatalogCard): number | null => card.level ?? card.rank ?? card.linkRating

const cardReleaseDate = (card: CatalogCard): string | null => {
  const dates = [card.releaseDate, card.ocgReleaseDate, card.tcgReleaseDate].filter((date): date is string => Boolean(date))
  return dates.sort()[0] ?? null
}

const cardTypeSortValue = (card: CatalogCard): string =>
  `${card.kind === 'monster' ? '0' : card.kind === 'spell' ? '1' : '2'}-${card.frame}-${card.typeLine}`

const compareCatalogValues = (
  first: string | number | null,
  second: string | number | null,
  direction: CatalogSortDirection
): number => {
  if (first == null && second == null) return 0
  if (first == null) return 1
  if (second == null) return -1
  const comparison = typeof first === 'number' && typeof second === 'number'
    ? first - second
    : String(first).localeCompare(String(second), 'zh-Hant', { numeric: true, sensitivity: 'base' })
  return direction === 'asc' ? comparison : -comparison
}

const sortCatalogCards = (
  cards: CatalogCard[],
  sortKey: CatalogSortKey,
  direction: CatalogSortDirection
): CatalogCard[] => {
  if (sortKey === 'catalog') return direction === 'asc' ? [...cards] : [...cards].reverse()
  const valueFor = (card: CatalogCard): string | number | null => {
    if (sortKey === 'name') return card.nameZh || card.nameJa || card.nameEn
    if (sortKey === 'atk') return card.atk
    if (sortKey === 'def') return card.def
    if (sortKey === 'level') return cardProgression(card)
    if (sortKey === 'release') return cardReleaseDate(card)
    return cardTypeSortValue(card)
  }
  return cards
    .map((card, index) => ({ card, index }))
    .sort((first, second) => {
      const comparison = compareCatalogValues(valueFor(first.card), valueFor(second.card), direction)
      if (comparison !== 0) return comparison
      return first.index - second.index
    })
    .map(({ card }) => card)
}

const cardProgressionLabel = (card: CatalogCard): string => {
  if (card.rank != null) return `RANK ${card.rank}`
  if (card.linkRating != null) return `LINK ${card.linkRating}`
  if (card.level != null) return `LV ${card.level}`
  return card.typeLine
}

function DirectoryCardArtwork({ card }: { card: CatalogCard }): React.JSX.Element {
  const artwork = card.artworks[0]
  const remembered = artwork ? thumbnailMemory.get(artwork.id) : null
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
    const cached = thumbnailMemory.get(artwork.id)
    if (cached !== undefined) {
      setArtUrl(cached)
      return
    }
    let active = true
    const resolver = window.arcana?.catalog.resolveArtwork ?? (() => Promise.resolve(artwork.sourceUrl))
    void resolver(artwork.id).then((resolved) => {
      thumbnailMemory.set(artwork.id, resolved)
      if (active) setArtUrl(resolved)
    }).catch(() => {
      thumbnailMemory.set(artwork.id, null)
      if (active) setArtUrl(null)
    })
    return () => {
      active = false
    }
  }, [artwork, visible])

  return (
    <div ref={hostRef} className="directory-card-artwork">
      {artUrl ? (
        <img
          src={artUrl}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => {
            if (artwork) thumbnailMemory.set(artwork.id, null)
            setArtUrl(null)
          }}
        />
      ) : <span aria-hidden="true">{card.kind === 'monster' ? '✧' : card.kind === 'spell' ? '◇' : '△'}</span>}
    </div>
  )
}

function CatalogView(props: CatalogViewProps): React.JSX.Element {
  const { selectedCard } = props
  const [layout, setLayoutState] = useState<CatalogLayout>(() =>
    window.localStorage.getItem('arcana-catalog-layout') === 'directory' ? 'directory' : 'focus'
  )
  const [sortKey, setSortKey] = useState<CatalogSortKey>('catalog')
  const [sortDirection, setSortDirection] = useState<CatalogSortDirection>('asc')
  const [directoryPage, setDirectoryPage] = useState(0)
  const [directoryColumns, setDirectoryColumns] = useState(8)
  const directoryGridRef = useRef<HTMLDivElement>(null)
  const directoryCardRefs = useRef(new Map<string, HTMLButtonElement>())
  const focusCardRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingDirectoryFocus = useRef<string | null>(null)
  const sortedCards = useMemo(
    () => sortCatalogCards(props.cards, sortKey, sortDirection),
    [props.cards, sortDirection, sortKey]
  )
  const pageCount = Math.max(1, Math.ceil(sortedCards.length / directoryPageSize))
  const pageStart = directoryPage * directoryPageSize
  const directoryCards = sortedCards.slice(pageStart, pageStart + directoryPageSize)
  const selectedDirectoryIndex = selectedCard ? sortedCards.findIndex((card) => card.id === selectedCard.id) : -1

  const setLayout = (nextLayout: CatalogLayout): void => {
    setLayoutState(nextLayout)
    window.localStorage.setItem('arcana-catalog-layout', nextLayout)
    if (nextLayout === 'directory') {
      pendingDirectoryFocus.current = selectedCard?.id ?? null
    }
  }

  const updateSortKey = (nextKey: CatalogSortKey): void => {
    setSortKey(nextKey)
    setSortDirection(nextKey === 'name' || nextKey === 'type' || nextKey === 'catalog' ? 'asc' : 'desc')
  }

  const goToDirectoryPage = (nextPage: number): void => {
    const safePage = Math.max(0, Math.min(pageCount - 1, nextPage))
    setDirectoryPage(safePage)
    const firstCard = sortedCards[safePage * directoryPageSize]
    if (firstCard) {
      pendingDirectoryFocus.current = firstCard.id
      props.onSelect(firstCard.id)
    }
  }

  const focusDirectoryCard = (targetIndex: number): void => {
    if (sortedCards.length === 0) return
    const safeIndex = Math.max(0, Math.min(sortedCards.length - 1, targetIndex))
    const target = sortedCards[safeIndex]
    if (!target) return
    pendingDirectoryFocus.current = target.id
    setDirectoryPage(Math.floor(safeIndex / directoryPageSize))
    props.onSelect(target.id)
  }

  const handleDirectoryKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const currentIndex = selectedDirectoryIndex >= 0 ? selectedDirectoryIndex : pageStart
    let targetIndex: number | null = null
    if (event.key === 'ArrowLeft') targetIndex = currentIndex - 1
    if (event.key === 'ArrowRight') targetIndex = currentIndex + 1
    if (event.key === 'ArrowUp') targetIndex = currentIndex - directoryColumns
    if (event.key === 'ArrowDown') targetIndex = currentIndex + directoryColumns
    if (event.key === 'Home') targetIndex = event.shiftKey ? 0 : pageStart
    if (event.key === 'End') targetIndex = event.shiftKey ? sortedCards.length - 1 : Math.min(sortedCards.length - 1, pageStart + directoryPageSize - 1)
    if (event.key === 'PageUp') targetIndex = currentIndex - directoryPageSize
    if (event.key === 'PageDown') targetIndex = currentIndex + directoryPageSize
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
    if (directoryPage < pageCount) return
    setDirectoryPage(Math.max(0, pageCount - 1))
  }, [directoryPage, pageCount])

  useEffect(() => {
    if (selectedDirectoryIndex < 0 || layout !== 'directory') return
    setDirectoryPage(Math.floor(selectedDirectoryIndex / directoryPageSize))
  }, [layout, selectedDirectoryIndex, sortDirection, sortKey])

  useEffect(() => {
    if (layout !== 'directory') return
    const grid = directoryGridRef.current
    if (!grid) return
    const measure = (): void => {
      const columns = window.getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
      setDirectoryColumns(Math.max(1, columns))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [layout])

  useEffect(() => {
    const cardId = pendingDirectoryFocus.current
    if (!cardId || layout !== 'directory') return
    const frame = requestAnimationFrame(() => {
      const target = directoryCardRefs.current.get(cardId)
      if (!target) return
      target.focus()
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      pendingDirectoryFocus.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [directoryPage, layout, selectedCard?.id])

  useEffect(() => {
    if (layout !== 'focus' || !selectedCard) return
    const frame = requestAnimationFrame(() => {
      focusCardRefs.current.get(selectedCard.id)?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [layout, selectedCard?.id])

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
          <header className="directory-heading">
            <div>
              <span className="eyebrow">CARD DIRECTORY</span>
              <h2>全卡目錄</h2>
              <p>{catalogSortLabel(sortKey)}・{sortDirection === 'asc' ? '升冪' : '降冪'}・每頁最多 {directoryPageSize} 張</p>
            </div>
            <div className="directory-key-help" aria-label="鍵盤操作提示">
              <span><kbd>←↑↓→</kbd> 選擇鄰近卡牌</span>
              <span><kbd>Enter</kbd> 開啟詳細檢視</span>
              <span><kbd>PgUp</kbd><kbd>PgDn</kbd> 跨頁</span>
            </div>
          </header>

          {directoryCards.length > 0 ? (
            <div
              ref={directoryGridRef}
              className="directory-card-grid"
              role="grid"
              aria-label={`第 ${directoryPage + 1} 頁卡片，${catalogSortLabel(sortKey)}`}
              onKeyDown={handleDirectoryKeyDown}
            >
              {directoryCards.map((card, pageIndex) => {
                const absoluteIndex = pageStart + pageIndex
                const isSelected = selectedCard?.id === card.id
                return (
                  <button
                    ref={(node) => {
                      if (node) directoryCardRefs.current.set(card.id, node)
                      else directoryCardRefs.current.delete(card.id)
                    }}
                    type="button"
                    role="gridcell"
                    key={card.id}
                    id={`directory-card-${card.id}`}
                    className={`directory-card-tile ${isSelected ? 'is-selected' : ''} ${card.isUnpopular ? 'is-unpopular' : ''}`}
                    style={{ '--card-accent': card.accent } as React.CSSProperties}
                    tabIndex={isSelected || (selectedDirectoryIndex < 0 && pageIndex === 0) ? 0 : -1}
                    aria-selected={isSelected}
                    aria-label={`${card.nameZh}，${cardProgressionLabel(card)}，${card.kind === 'monster' ? `攻擊力 ${card.atk ?? '未知'}，守備力 ${card.def ?? '未知'}` : card.typeLine}`}
                    onClick={() => props.onSelect(card.id)}
                    onDoubleClick={() => setLayout('focus')}
                  >
                    <span className="directory-index">{String(absoluteIndex + 1).padStart(4, '0')}</span>
                    <span className={`directory-card-face frame-${card.frame} ${card.pendulumScaleLeft != null ? 'is-pendulum' : ''}`}>
                      <DirectoryCardArtwork card={card} />
                      <span className="directory-card-title">{card.nameZh}</span>
                      <span className="directory-card-level">{cardProgressionLabel(card)}</span>
                    </span>
                    <span className="directory-card-caption">
                      <strong>{card.nameZh}</strong>
                      <small>{card.kind === 'monster' ? `ATK ${card.atk ?? '—'} / DEF ${card.def ?? '—'}` : card.typeLine}</small>
                    </span>
                    {card.isUnpopular && <span className="directory-unpopular-badge">冷門</span>}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="empty-state directory-empty-state"><span>⌕</span><strong>沒有符合條件的卡片</strong><p>試著移除效果標籤或使用較短的關鍵字。</p></div>
          )}

          <footer className="directory-footer">
            <div className="directory-pagination" aria-label="目錄分頁">
              <button type="button" onClick={() => goToDirectoryPage(0)} disabled={directoryPage === 0}>«</button>
              <button type="button" onClick={() => goToDirectoryPage(directoryPage - 1)} disabled={directoryPage === 0}>‹ 上一頁</button>
              <span>第 <strong>{directoryPage + 1}</strong> / {pageCount} 頁</span>
              <button type="button" onClick={() => goToDirectoryPage(directoryPage + 1)} disabled={directoryPage >= pageCount - 1}>下一頁 ›</button>
              <button type="button" onClick={() => goToDirectoryPage(pageCount - 1)} disabled={directoryPage >= pageCount - 1}>»</button>
            </div>
            <span className="directory-range">
              {sortedCards.length > 0 ? `${pageStart + 1}–${Math.min(pageStart + directoryPageSize, sortedCards.length)} / ${sortedCards.length}` : '0 / 0'}
            </span>
          </footer>

          {selectedCard && selectedDirectoryIndex >= 0 && (
            <aside className="directory-selection-dock" aria-live="polite">
              <div className="directory-selection-identity">
                <span className={`selection-kind-mark frame-${selectedCard.frame}`} aria-hidden="true">
                  {selectedCard.kind === 'monster' ? '✧' : selectedCard.kind === 'spell' ? '◇' : '△'}
                </span>
                <div>
                  <small>SELECTED CARD</small>
                  <strong>{selectedCard.nameZh}</strong>
                  <span>{selectedCard.nameJa || selectedCard.nameEn || selectedCard.typeLine}</span>
                </div>
              </div>
              <div className="directory-selection-stats">
                <span><small>類型</small><strong>{selectedCard.typeLine}</strong></span>
                <span><small>等級資訊</small><strong>{cardProgressionLabel(selectedCard)}</strong></span>
                <span><small>ATK / DEF</small><strong>{selectedCard.kind === 'monster' ? `${selectedCard.atk ?? '—'} / ${selectedCard.def ?? '—'}` : '—'}</strong></span>
                <span><small>首次發行</small><strong>{cardReleaseDate(selectedCard) ?? '資料未提供'}</strong></span>
              </div>
              <div className="directory-selection-actions">
                <button type="button" className="directory-detail-button" onClick={() => setLayout('focus')}>查看卡片 <Glyph>↗</Glyph></button>
                <button type="button" className="directory-studio-button" onClick={props.onOpenStudio}>藝術加工室</button>
              </div>
            </aside>
          )}
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
              disabled={props.popularityBusyId === selectedCard.id}
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
      ? `；${result.missingRequiredLanguages} 張因必要語系不完整而未匯入（${languageGaps}）`
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
        : result.stoppedBy === 'waiting-language'
          ? `遇到必要語系不完整的卡片${result.missingRequiredLanguages > 0 ? `（${languageGaps}）` : ''}`
          : '已依來源規則停止'
    return `${counts}；${stopReason}。${coverage}${result.resumeMonth ? `，下次由 ${result.resumeMonth} 接續` : ''}。`
  }
  return `${counts}；${coverage}。`
}

const emptyCoverage = (region: ReleaseRegion): CatalogCoverage => ({
  region,
  completeThrough: null,
  resumeMonth: null,
  resumeOffset: 0,
  targetMonth: null,
  status: 'not-started',
  note: null
})

const coverageSummary = (coverage?: CatalogCoverage[]): string => {
  const ocg = coverage?.find((item) => item.region === 'ocg')
  const tcg = coverage?.find((item) => item.region === 'tcg')
  if (!ocg?.completeThrough && !tcg?.completeThrough) return '尚未建立連續發行時間涵蓋範圍'
  return `OCG ${ocg?.completeThrough ?? '未開始'}・TCG ${tcg?.completeThrough ?? '未開始'}`
}

const coverageStatusText = (coverage: CatalogCoverage): string => {
  if (coverage.status === 'complete') return '已達指定目標'
  if (coverage.status === 'source-limit') return '已到本次流量上限'
  if (coverage.status === 'waiting-language') return '等待必要語系'
  return '尚未開始'
}

function UpdateCenterView({
  stats,
  policies,
  busy,
  notice,
  onUpdate,
  onCatalog
}: {
  stats: CatalogStats | null
  policies: CatalogSourcePolicy[]
  busy: boolean
  notice: { tone: 'success' | 'error' | 'info'; text: string } | null
  onUpdate: (request: CatalogUpdateRequest) => Promise<void>
  onCatalog: () => void
}): React.JSX.Element {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [region, setRegion] = useState<ReleaseRegion>('ocg')
  const [mode, setMode] = useState<CatalogUpdateMode>('month')
  const years = Array.from({ length: today.getFullYear() + 2 - 1999 }, (_, index) => today.getFullYear() + 1 - index)
  const coverage = stats?.coverage ?? [emptyCoverage('ocg'), emptyCoverage('tcg')]
  const activeCoverage = coverage.find((item) => item.region === region) ?? emptyCoverage(region)

  return (
    <div className="update-center-view">
      <section className="update-center-hero">
        <div>
          <button type="button" className="back-button" onClick={onCatalog}>← 返回卡片圖鑑</button>
          <span className="eyebrow">RELEASE DATA COVERAGE</span>
          <h2>可續傳的多語卡片資料更新</h2>
          <p>中文、英文、日文名稱會依 OCG／TCG 發行區域檢查完整性：跨區發行必須三語齊全，區域限定卡只要求中文及該區語系；程式不會把執行更新的時間誤當成卡片發行涵蓋時間。</p>
        </div>
        <div className="coverage-grid">
          {coverage.map((item) => (
            <article key={item.region} className={item.region === region ? 'is-active' : ''}>
              <span>{item.region.toUpperCase()}</span>
              <strong>{item.completeThrough ?? '尚未開始'}</strong>
              <small>完整涵蓋至此發行日</small>
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
            <button type="button" className={mode === 'month' ? 'is-active' : ''} onClick={() => setMode('month')}>指定單一月份</button>
            <button type="button" className={mode === 'through' ? 'is-active' : ''} onClick={() => setMode('through')}>截至指定年月的全部卡片</button>
          </div>
          <p className="update-mode-note">
            {mode === 'month'
              ? '只更新所選發行月份，不改變「已完整涵蓋至」的連續進度。'
              : `從 ${activeCoverage.resumeMonth ?? (activeCoverage.completeThrough ? '下一個未完成月份' : region === 'ocg' ? '1999-01' : '2002-01')} 接續，直到目標月份或本次來源上限。`}
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
              {busy ? '正在依來源規則更新…' : mode === 'through' ? `更新至 ${year} 年 ${month} 月` : `更新 ${year} 年 ${month} 月`}
            </button>
          </form>
          {notice && <div className={`update-notice tone-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
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
          <p className="source-policy-foot">卡圖不在更新期間批次下載；仍只在查看時抓取一次並存入本機媒體分片。</p>
        </aside>
      </div>
    </div>
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
