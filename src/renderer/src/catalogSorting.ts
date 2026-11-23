import type { CatalogCard } from '../../shared/catalog'

export type CatalogSortKey = 'catalog' | 'name' | 'atk' | 'def' | 'level' | 'release' | 'type'
export type CatalogSortDirection = 'asc' | 'desc'

export const catalogSortOptions: Array<{ value: CatalogSortKey; label: string }> = [
  { value: 'catalog', label: '圖鑑順序' },
  { value: 'name', label: '卡片名稱' },
  { value: 'atk', label: '攻擊力 ATK' },
  { value: 'def', label: '守備力 DEF' },
  { value: 'level', label: '等級／階級／LINK' },
  { value: 'release', label: '首次發行日期' },
  { value: 'type', label: '卡片種類' }
]

export const catalogSortLabel = (sortKey: CatalogSortKey): string =>
  catalogSortOptions.find((option) => option.value === sortKey)?.label ?? '圖鑑順序'

const cardName = (card: CatalogCard): string => card.nameZh || card.nameJa || card.nameEn

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

export const sortCatalogCards = (
  cards: CatalogCard[],
  sortKey: CatalogSortKey,
  direction: CatalogSortDirection
): CatalogCard[] => {
  if (sortKey === 'catalog') return direction === 'asc' ? [...cards] : [...cards].reverse()
  const valueFor = (card: CatalogCard): string | number | null => {
    if (sortKey === 'name') return cardName(card)
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
      if (sortKey === 'atk' || sortKey === 'def') {
        const nameComparison = compareCatalogValues(cardName(first.card), cardName(second.card), 'asc')
        if (nameComparison !== 0) return nameComparison
      }
      return first.index - second.index
    })
    .map(({ card }) => card)
}
