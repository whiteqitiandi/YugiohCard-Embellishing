import { useEffect, useMemo, useState } from 'react'
import type { CatalogCard } from '../../shared/catalog'
import {
  buildFilterGroupDefinitions,
  countFilterConditions,
  createEmptyFilterCriteria,
  matchesCardFilter,
  sanitizeFilterCriteria,
  type CardFilterCriteria,
  type FilterGroupKey,
  type FilterGroupSelection,
  type SavedCardFilter
} from '../../shared/filters'
import { seedCards } from '../../main/seed'

type SelectionSide = 'include' | 'exclude'

export function FilterWindow(): React.JSX.Element {
  const [cards, setCards] = useState<CatalogCard[]>([])
  const [criteria, setCriteria] = useState<CardFilterCriteria>(createEmptyFilterCriteria)
  const [savedFilters, setSavedFilters] = useState<SavedCardFilter[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filterName, setFilterName] = useState('')
  const [status, setStatus] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const catalogApi = window.arcana?.catalog
    const filtersApi = window.arcana?.filters
    Promise.all([
      catalogApi ? catalogApi.listCards() : Promise.resolve(seedCards),
      filtersApi ? filtersApi.getDraft() : Promise.resolve(createEmptyFilterCriteria()),
      filtersApi ? filtersApi.listSaved() : Promise.resolve([])
    ])
      .then(([loadedCards, draft, saved]) => {
        setCards(loadedCards)
        setCriteria(sanitizeFilterCriteria(draft))
        setSavedFilters(saved)
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : '無法載入篩選設定。')
      })
  }, [])

  const groupDefinitions = useMemo(() => buildFilterGroupDefinitions(cards), [cards])
  const matchedCards = useMemo(
    () => cards.filter((card) => matchesCardFilter(card, criteria)),
    [cards, criteria]
  )

  const patchGroup = (key: FilterGroupKey, patch: Partial<FilterGroupSelection>): void => {
    setCriteria((current) => ({
      ...current,
      groups: {
        ...current.groups,
        [key]: { ...current.groups[key], ...patch }
      }
    }))
  }

  const toggleValue = (key: FilterGroupKey, side: SelectionSide, value: string, checked: boolean): void => {
    const group = criteria.groups[key]
    const otherSide: SelectionSide = side === 'include' ? 'exclude' : 'include'
    const selected = checked
      ? Array.from(new Set([...group[side], value]))
      : group[side].filter((item) => item !== value)
    patchGroup(key, {
      [side]: selected,
      [otherSide]: checked ? group[otherSide].filter((item) => item !== value) : group[otherSide]
    })
  }

  const clearCriteria = (): void => {
    setCriteria(createEmptyFilterCriteria())
    setEditingId(null)
    setStatus('已清除目前條件。')
  }

  const loadSavedFilter = (saved: SavedCardFilter): void => {
    setCriteria(sanitizeFilterCriteria(saved.criteria))
    setEditingId(saved.id)
    setFilterName(saved.name)
    setStatus(`已載入「${saved.name}」，修改後可直接儲存。`)
  }

  const saveFilter = async (): Promise<void> => {
    const name = filterName.trim()
    if (!name) {
      setStatus('請先輸入常用篩選名稱。')
      return
    }
    const filtersApi = window.arcana?.filters
    if (!filtersApi) {
      setStatus('瀏覽器預覽模式不會寫入本機設定。')
      return
    }
    setIsSaving(true)
    try {
      const next = await filtersApi.save({ id: editingId ?? undefined, name, criteria })
      setSavedFilters(next)
      setEditingId(next[0]?.id ?? null)
      setFilterName(next[0]?.name ?? name)
      setStatus(`已儲存「${name}」。`)
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : '儲存失敗。')
    } finally {
      setIsSaving(false)
    }
  }

  const deleteFilter = async (saved: SavedCardFilter): Promise<void> => {
    if (!window.confirm(`確定刪除常用篩選「${saved.name}」？`)) return
    const filtersApi = window.arcana?.filters
    if (!filtersApi) return
    try {
      const next = await filtersApi.delete(saved.id)
      setSavedFilters(next)
      if (editingId === saved.id) {
        setEditingId(null)
        setFilterName('')
      }
      setStatus(`已刪除「${saved.name}」。`)
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : '刪除失敗。')
    }
  }

  const applyFilter = async (): Promise<void> => {
    try {
      await window.arcana?.filters.apply(criteria)
      window.close()
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : '無法套用篩選條件。')
    }
  }

  return (
    <main className="filter-window-shell">
      <header className="filter-window-header">
        <div>
          <span className="eyebrow">CARD QUERY BUILDER</span>
          <h1>進階篩選條件</h1>
          <p>基本欄位同組多選固定採聯集、不同欄位彼此交集；只有效果支援聯集／交集與納入／排除。</p>
        </div>
        <div className="filter-result-summary">
          <span>即時結果</span>
          <strong>{matchedCards.length}</strong>
          <small>／{cards.length} 張卡片</small>
        </div>
      </header>

      <div className="filter-window-layout">
        <aside className="saved-filter-panel">
          <div className="saved-filter-heading">
            <div>
              <span className="eyebrow">PRESETS</span>
              <h2>常用篩選</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingId(null)
                setFilterName('')
                setStatus('可將目前條件另存為新的常用篩選。')
              }}
            >另存目前條件</button>
          </div>

          <div className="saved-filter-editor">
            <label htmlFor="saved-filter-name">名稱</label>
            <input
              id="saved-filter-name"
              value={filterName}
              maxLength={60}
              placeholder="例如：同步龍族＋效果無效"
              onChange={(event) => setFilterName(event.target.value)}
            />
            <button type="button" disabled={isSaving} onClick={() => { void saveFilter() }}>
              {editingId ? '儲存變更' : '新增常用篩選'}
            </button>
            {editingId && <small>正在編輯既有條件；按「另存目前條件」可建立副本。</small>}
          </div>

          <div className="saved-filter-list">
            {savedFilters.length > 0 ? savedFilters.map((saved) => (
              <article key={saved.id} className={editingId === saved.id ? 'is-active' : ''}>
                <button type="button" className="saved-filter-load" onClick={() => loadSavedFilter(saved)}>
                  <strong>{saved.name}</strong>
                  <small>{countFilterConditions(saved.criteria)} 個條件・{new Date(saved.updatedAt).toLocaleDateString('zh-TW')}</small>
                </button>
                <button type="button" className="saved-filter-delete" onClick={() => { void deleteFilter(saved) }} aria-label={`刪除 ${saved.name}`}>×</button>
              </article>
            )) : (
              <div className="saved-filter-empty">尚未儲存常用篩選。</div>
            )}
          </div>

          <div className="filter-preview-list">
            <span>目前前幾筆結果</span>
            {matchedCards.slice(0, 5).map((card) => <small key={card.id}>{card.nameZh}</small>)}
            {matchedCards.length === 0 && <small>沒有符合條件的卡片</small>}
          </div>
        </aside>

        <section className="filter-builder-panel">
          <div className="filter-logic-bar popularity-filter-bar">
            <div>
              <strong>冷門卡片</strong>
              <small>手動標記的冷門卡可在結果中隱藏或單獨檢視</small>
            </div>
            <label>
              <input
                type="radio"
                name="popularity-mode"
                checked={criteria.popularity === 'all'}
                onChange={() => setCriteria((current) => ({ ...current, popularity: 'all' }))}
              />
              顯示全部
            </label>
            <label>
              <input
                type="radio"
                name="popularity-mode"
                checked={criteria.popularity === 'hide'}
                onChange={() => setCriteria((current) => ({ ...current, popularity: 'hide' }))}
              />
              隱藏／略過冷門卡
            </label>
            <label>
              <input
                type="radio"
                name="popularity-mode"
                checked={criteria.popularity === 'only'}
                onChange={() => setCriteria((current) => ({ ...current, popularity: 'only' }))}
              />
              只顯示冷門卡
            </label>
          </div>

          <div className="filter-group-grid">
            {groupDefinitions.map((definition) => {
              const group = criteria.groups[definition.key]
              const conditionCount = group.include.length + group.exclude.length
              return (
                <section className={`filter-group-card filter-group-${definition.key}`} key={definition.key}>
                  <header>
                    <div>
                      <h2>{definition.label}</h2>
                      <p>{definition.note}</p>
                    </div>
                    {conditionCount > 0 && (
                      <button type="button" onClick={() => patchGroup(definition.key, { include: [], exclude: [] })}>清除此組</button>
                    )}
                  </header>
                  {definition.effectLogic ? (
                    <div className="filter-group-mode">
                      <span>納入多項時：</span>
                      <label>
                        <input
                          type="radio"
                          name={`${definition.key}-mode`}
                          checked={group.includeMode === 'any'}
                          onChange={() => patchGroup(definition.key, { includeMode: 'any' })}
                        />任一（聯集）
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`${definition.key}-mode`}
                          checked={group.includeMode === 'all'}
                          onChange={() => patchGroup(definition.key, { includeMode: 'all' })}
                        />全部（交集）
                      </label>
                    </div>
                  ) : <div className="structural-union-note">多選一律視為「任一符合」（聯集）</div>}
                  <div className={`filter-option-head ${definition.effectLogic ? '' : 'is-structural'}`}>
                    <span>條件</span><span>{definition.effectLogic ? '納入' : '選取'}</span>{definition.effectLogic && <span>排除</span>}
                  </div>
                  <div className="filter-option-list">
                    {definition.options.map((option) => (
                      <div className={`filter-option-row ${definition.effectLogic ? '' : 'is-structural'}`} key={option.value}>
                        <span>{option.label}</span>
                        <label title={`${definition.effectLogic ? '納入' : '選取'} ${option.label}`}>
                          <input
                            type="checkbox"
                            aria-label={`${definition.effectLogic ? '納入' : '選取'} ${option.label}`}
                            checked={group.include.includes(option.value)}
                            onChange={(event) => toggleValue(definition.key, 'include', option.value, event.target.checked)}
                          />
                        </label>
                        {definition.effectLogic && (
                          <label title={`排除 ${option.label}`}>
                            <input
                              type="checkbox"
                              aria-label={`排除 ${option.label}`}
                              checked={group.exclude.includes(option.value)}
                              onChange={(event) => toggleValue(definition.key, 'exclude', option.value, event.target.checked)}
                            />
                          </label>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </section>
      </div>

      <footer className="filter-window-footer">
        <div>
          <strong>{countFilterConditions(criteria)} 個條件</strong>
          <span>{status || '基本欄位固定採同組聯集、跨組交集；效果排除條件永遠優先。'}</span>
        </div>
        <button type="button" className="filter-secondary-button" onClick={clearCriteria}>全部清除</button>
        <button type="button" className="filter-secondary-button" onClick={() => window.close()}>取消</button>
        <button type="button" className="filter-apply-button" onClick={() => { void applyFilter() }}>套用篩選</button>
      </footer>
    </main>
  )
}
