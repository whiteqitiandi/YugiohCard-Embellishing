import type { CatalogCard } from './catalog'

export type FilterGroupKey = 'kind' | 'cardType' | 'attribute' | 'race' | 'effectTag'

export type FilterMatchMode = 'all' | 'any'
export type PopularityFilterMode = 'all' | 'hide' | 'only'

export interface FilterGroupSelection {
  include: string[]
  exclude: string[]
  includeMode: FilterMatchMode
}

export interface CardFilterCriteria {
  popularity: PopularityFilterMode
  groups: Record<FilterGroupKey, FilterGroupSelection>
}

export interface SavedCardFilter {
  id: string
  name: string
  criteria: CardFilterCriteria
  updatedAt: string
}

export interface FilterOption {
  value: string
  label: string
}

export interface FilterGroupDefinition {
  key: FilterGroupKey
  label: string
  note: string
  options: FilterOption[]
  effectLogic?: boolean
}

export const filterGroupKeys: FilterGroupKey[] = ['kind', 'cardType', 'attribute', 'race', 'effectTag']
const structuralGroupKeys: FilterGroupKey[] = ['kind', 'cardType', 'attribute', 'race']

const emptyGroup = (): FilterGroupSelection => ({
  include: [],
  exclude: [],
  includeMode: 'any'
})

export const createEmptyFilterCriteria = (): CardFilterCriteria => ({
  popularity: 'all',
  groups: {
    kind: emptyGroup(),
    cardType: emptyGroup(),
    attribute: emptyGroup(),
    race: emptyGroup(),
    effectTag: emptyGroup()
  }
})

const sanitizeStrings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.length <= 100)))
}

const legacyCardTypes = (rawGroups: Record<string, unknown>): string[] => {
  const readIncludes = (key: string): string[] => {
    const value = rawGroups[key]
    if (!value || typeof value !== 'object') return []
    return sanitizeStrings((value as Partial<FilterGroupSelection>).include)
  }
  return [
    ...readIncludes('monsterType').map((value) => `monster:${value}`),
    ...readIncludes('spellType').map((value) => `spell:${value}`),
    ...readIncludes('trapType').map((value) => `trap:${value}`)
  ]
}

export const sanitizeFilterCriteria = (value: unknown): CardFilterCriteria => {
  const fallback = createEmptyFilterCriteria()
  if (!value || typeof value !== 'object') return fallback
  const candidate = value as Partial<CardFilterCriteria>
  const rawGroups = candidate.groups && typeof candidate.groups === 'object'
    ? candidate.groups as unknown as Record<string, unknown>
    : {}

  for (const key of filterGroupKeys) {
    const rawGroup = rawGroups[key]
    const source = rawGroup && typeof rawGroup === 'object'
      ? rawGroup as Partial<FilterGroupSelection>
      : {}
    const include = sanitizeStrings(source.include)
    if (key === 'cardType') include.push(...legacyCardTypes(rawGroups))
    const uniqueInclude = Array.from(new Set(include))
    const exclude = key === 'effectTag'
      ? sanitizeStrings(source.exclude).filter((item) => !uniqueInclude.includes(item))
      : []
    fallback.groups[key] = {
      include: uniqueInclude,
      exclude,
      includeMode: key === 'effectTag' && source.includeMode === 'all' ? 'all' : 'any'
    }
  }

  fallback.popularity = candidate.popularity === 'hide' || candidate.popularity === 'only'
    ? candidate.popularity
    : 'all'
  return fallback
}

export const countFilterConditions = (criteria: CardFilterCriteria): number =>
  filterGroupKeys.reduce(
    (total, key) => total + criteria.groups[key].include.length + criteria.groups[key].exclude.length,
    criteria.popularity === 'all' ? 0 : 1
  )

const cardValuesForGroup = (card: CatalogCard, key: FilterGroupKey): string[] => {
  switch (key) {
    case 'kind':
      return [card.kind]
    case 'cardType': {
      if (card.kind === 'spell') return [`spell:${card.spellTrapIcon ?? 'normal'}`]
      if (card.kind === 'trap') return [`trap:${card.spellTrapIcon ?? 'normal'}`]
      const values = new Set<string>([`monster:${card.frame}`])
      if (card.pendulumScaleLeft != null || card.pendulumScaleRight != null) values.add('monster:pendulum')
      if (card.typeLine.includes('協調')) values.add('monster:tuner')
      if (card.typeLine.includes('效果')) values.add('monster:effect')
      return Array.from(values)
    }
    case 'attribute':
      return card.kind === 'monster' ? [card.attribute] : []
    case 'race':
      return card.kind === 'monster' ? [card.race] : []
    case 'effectTag':
      return card.effectTags
  }
}

export const matchesCardFilter = (card: CatalogCard, criteria: CardFilterCriteria): boolean => {
  if (criteria.popularity === 'hide' && card.isUnpopular) return false
  if (criteria.popularity === 'only' && !card.isUnpopular) return false

  for (const key of structuralGroupKeys) {
    const selected = criteria.groups[key].include
    if (selected.length === 0) continue
    const cardValues = cardValuesForGroup(card, key)
    if (!selected.some((value) => cardValues.includes(value))) return false
  }

  const effects = criteria.groups.effectTag
  const cardEffects = cardValuesForGroup(card, 'effectTag')
  if (effects.exclude.some((value) => cardEffects.includes(value))) return false
  if (effects.include.length === 0) return true
  return effects.includeMode === 'all'
    ? effects.include.every((value) => cardEffects.includes(value))
    : effects.include.some((value) => cardEffects.includes(value))
}

const uniqueOptions = (values: string[]): FilterOption[] =>
  Array.from(new Set(values))
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    .map((value) => ({ value, label: value }))

export const buildFilterGroupDefinitions = (cards: CatalogCard[]): FilterGroupDefinition[] => [
  {
    key: 'kind',
    label: '卡片大類',
    note: '多選固定視為聯集，例如怪獸卡或魔法卡。',
    options: [
      { value: 'monster', label: '怪獸卡' },
      { value: 'spell', label: '魔法卡' },
      { value: 'trap', label: '陷阱卡' }
    ]
  },
  {
    key: 'cardType',
    label: '卡片細分',
    note: '怪獸、魔法與陷阱細分共用一組，多選固定視為聯集。',
    options: [
      { value: 'monster:normal', label: '怪獸・通常' },
      { value: 'monster:effect', label: '怪獸・效果' },
      { value: 'monster:ritual', label: '怪獸・儀式' },
      { value: 'monster:fusion', label: '怪獸・融合' },
      { value: 'monster:synchro', label: '怪獸・同步' },
      { value: 'monster:xyz', label: '怪獸・超量' },
      { value: 'monster:link', label: '怪獸・連結' },
      { value: 'monster:pendulum', label: '怪獸・鐘擺' },
      { value: 'monster:tuner', label: '怪獸・協調' },
      { value: 'spell:normal', label: '魔法・通常' },
      { value: 'spell:continuous', label: '魔法・永續' },
      { value: 'spell:equip', label: '魔法・裝備' },
      { value: 'spell:field', label: '魔法・場地' },
      { value: 'spell:quick-play', label: '魔法・速攻' },
      { value: 'spell:ritual', label: '魔法・儀式' },
      { value: 'trap:normal', label: '陷阱・通常' },
      { value: 'trap:continuous', label: '陷阱・永續' },
      { value: 'trap:counter', label: '陷阱・反擊' }
    ]
  },
  {
    key: 'attribute',
    label: '屬性',
    note: '多選固定視為聯集；只套用於怪獸卡。',
    options: uniqueOptions(cards.filter((card) => card.kind === 'monster').map((card) => card.attribute))
  },
  {
    key: 'race',
    label: '種族',
    note: '多選固定視為聯集；只套用於怪獸卡。',
    options: uniqueOptions(cards.filter((card) => card.kind === 'monster').map((card) => card.race))
  },
  {
    key: 'effectTag',
    label: '效果特性',
    note: '唯一支援納入／排除，以及納入條件聯集／交集的群組。',
    options: uniqueOptions(cards.flatMap((card) => card.effectTags)),
    effectLogic: true
  }
]

const escapeRegExp = (value: string): string => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')

const wildcardPattern = (value: string): RegExp => {
  const source = value
    .split('')
    .map((character) => character === '*' ? '.*' : character === '?' ? '.' : escapeRegExp(character))
    .join('')
  return new RegExp(`^${source}$`)
}

export const matchesCardTextQuery = (card: CatalogCard, query: string): boolean => {
  const normalized = query.trim().toLocaleLowerCase('zh-Hant')
  if (!normalized) return true

  const explicitPasscode = normalized.match(/^密碼\s*[:：]\s*(.+)$/)
  const passcodeQuery = explicitPasscode?.[1] ?? (/^[\d*?]+$/.test(normalized) && /[*?]/.test(normalized) ? normalized : null)
  if (passcodeQuery != null) {
    return /[*?]/.test(passcodeQuery)
      ? wildcardPattern(passcodeQuery).test(card.passcode)
      : card.passcode.includes(passcodeQuery)
  }

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

  return haystack.includes(normalized)
}
