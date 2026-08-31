import { useEffect, useMemo, useState } from 'react'
import type { CatalogCard, CatalogStats } from '../../shared/catalog'
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

type AppView = 'catalog' | 'studio' | 'creator' | 'deck'

const defaultFinish: FinishConfig = {
  surface: 'aurora',
  scope: 'whole',
  rim: 'gold',
  name: 'gold',
  stamp: false
}

const navItems: { id: AppView; letter: string; title: string; subtitle: string }[] = [
  { id: 'catalog', letter: 'A', title: '卡片圖鑑', subtitle: '查詢・版本・關聯' },
  { id: 'studio', letter: 'B', title: '藝術加工', subtitle: 'Chronicle 實驗室' },
  { id: 'creator', letter: 'C', title: '卡片創作', subtitle: '版面與文字' },
  { id: 'deck', letter: 'D', title: '牌組工房', subtitle: '編組與測試' }
]

const viewTitles: Record<AppView, string> = {
  catalog: '卡片圖鑑',
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
  const [kind, setKind] = useState('all')
  const [effectTag, setEffectTag] = useState('全部')
  const [artworkId, setArtworkId] = useState('')
  const [ruleset, setRuleset] = useState('ocg-master')
  const [finish, setFinish] = useState<FinishConfig>(defaultFinish)
  const [textMode, setTextMode] = useState<CardTextMode>('fit')
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const catalogApi = window.arcana?.catalog
    const cardPromise = catalogApi ? catalogApi.listCards() : Promise.resolve(seedCards)
    const statsPromise = catalogApi
      ? catalogApi.stats()
      : Promise.resolve({
          cards: seedCards.length,
          artworks: seedCards.reduce((sum, card) => sum + card.artworks.length, 0),
          ruleVariants: seedCards.reduce((sum, card) => sum + card.ruleTexts.length, 0),
          lastSeededAt: 'browser-preview'
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
  }, [])

  const selectedCard = cards.find((card) => card.id === selectedId) ?? cards[0]

  useEffect(() => {
    if (!selectedCard) return
    setArtworkId(selectedCard.artworks[0]?.id ?? '')
    setRuleset(selectedCard.ruleTexts[0]?.ruleset ?? 'ocg-master')
  }, [selectedCard?.id])

  const allEffectTags = useMemo(
    () => Array.from(new Set(cards.flatMap((card) => card.effectTags))).sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    [cards]
  )

  const filteredCards = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('zh-Hant')
    return cards.filter((card) => {
      const matchesKind = kind === 'all' || card.kind === kind
      const matchesTag = effectTag === '全部' || card.effectTags.includes(effectTag)
      const haystack = [
        card.nameZh,
        card.nameJa,
        card.nameEn,
        card.passcode,
        card.attribute,
        card.race,
        card.typeLine,
        ...card.effectTags,
        ...card.relations,
        ...card.compatibility.map((trait) => trait.label),
        ...card.ruleTexts.map((variant) => variant.textZh)
      ]
        .join(' ')
        .toLocaleLowerCase('zh-Hant')
      return matchesKind && matchesTag && (!normalized || haystack.includes(normalized))
    })
  }, [cards, effectTag, kind, query])

  const activeRuleText =
    selectedCard?.ruleTexts.find((variant) => variant.ruleset === ruleset) ?? selectedCard?.ruleTexts[0]

  const openStudio = (): void => {
    setView('studio')
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
          <strong>{stats?.cards ?? '—'} 張示範卡・{stats?.artworks ?? '—'} 幅卡圖</strong>
          <small>文字庫與媒體分片已啟用</small>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <span className="eyebrow">PERSONAL DUEL ARCHIVE</span>
            <h1>{viewTitles[view]}</h1>
          </div>
          <nav className="feature-toolbar" aria-label="A B C D 功能區切換">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={view === item.id ? 'is-active' : ''}
                onClick={() => setView(item.id)}
                aria-current={view === item.id ? 'page' : undefined}
                title={item.subtitle}
              >
                <span>{item.letter}</span>
                <strong>{item.title}</strong>
              </button>
            ))}
          </nav>
          <div className="topbar-actions">
            <span className="prototype-pill">PROTOTYPE 0.1</span>
            <button type="button" className="icon-button" aria-label="設定">⋮</button>
          </div>
        </header>

        {view === 'catalog' ? (
          <CatalogView
            cards={filteredCards}
            selectedCard={selectedCard}
            query={query}
            kind={kind}
            effectTag={effectTag}
            allEffectTags={allEffectTags}
            artworkId={artworkId}
            ruleset={ruleset}
            activeRuleText={activeRuleText?.textZh ?? ''}
            textMode={textMode}
            onQuery={setQuery}
            onKind={setKind}
            onEffectTag={setEffectTag}
            onSelect={setSelectedId}
            onArtwork={setArtworkId}
            onRuleset={setRuleset}
            onTextMode={setTextMode}
            onOpenStudio={openStudio}
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
  kind: string
  effectTag: string
  allEffectTags: string[]
  artworkId: string
  ruleset: string
  activeRuleText: string
  textMode: CardTextMode
  onQuery: (value: string) => void
  onKind: (value: string) => void
  onEffectTag: (value: string) => void
  onSelect: (value: string) => void
  onArtwork: (value: string) => void
  onRuleset: (value: string) => void
  onTextMode: (value: CardTextMode) => void
  onOpenStudio: () => void
}

function CatalogView(props: CatalogViewProps): React.JSX.Element {
  const { selectedCard } = props
  return (
    <div className="catalog-view">
      <section className="search-panel">
        <div className="search-field">
          <Glyph>⌕</Glyph>
          <input
            value={props.query}
            onChange={(event) => props.onQuery(event.target.value)}
            placeholder="搜尋卡名、效果、系列、種族或密碼…"
            aria-label="搜尋卡片"
          />
          <kbd>Ctrl K</kbd>
        </div>
        <div className="filter-row">
          <label>
            <span>卡片種類</span>
            <select value={props.kind} onChange={(event) => props.onKind(event.target.value)}>
              <option value="all">全部卡片</option>
              <option value="monster">怪獸卡</option>
              <option value="spell">魔法卡</option>
              <option value="trap">陷阱卡</option>
            </select>
          </label>
          <label>
            <span>效果標籤</span>
            <select value={props.effectTag} onChange={(event) => props.onEffectTag(event.target.value)}>
              <option value="全部">全部效果</option>
              {props.allEffectTags.map((tag) => <option key={tag}>{tag}</option>)}
            </select>
          </label>
          <button type="button" className="filter-reset" onClick={() => {
            props.onQuery('')
            props.onKind('all')
            props.onEffectTag('全部')
          }}>清除篩選</button>
          <span className="result-count">找到 <strong>{props.cards.length}</strong> 張</span>
        </div>
      </section>

      <div className="catalog-content">
        <section className="catalog-grid-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">LOCAL COLLECTION</span>
              <h2>精選卡片</h2>
            </div>
            <span>依圖鑑順序</span>
          </div>
          {props.cards.length > 0 ? (
            <div className="card-grid">
              {props.cards.map((card) => (
                <button
                  type="button"
                  key={card.id}
                  className={`catalog-card ${selectedCard?.id === card.id ? 'is-selected' : ''}`}
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
                    <strong>{card.nameZh}</strong>
                    <small>{card.nameJa}</small>
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
              <span>{selectedCard.nameJa}</span>
              <h2>{selectedCard.nameZh}</h2>
              <p>{selectedCard.nameEn}</p>
            </div>
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

            <button type="button" className="primary-action" onClick={props.onOpenStudio}>
              <span>進入藝術加工室</span><Glyph>↗</Glyph>
            </button>
          </aside>
        )}
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
      <p>{isCreator ? '此功能區已可由工具列切換；編輯器將在後續階段接入。' : '此功能區已可由工具列切換；牌組編組與測試流程將在後續階段接入。'}</p>
      <button type="button" className="back-button" onClick={onCatalog}>返回 A・卡片圖鑑</button>
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
