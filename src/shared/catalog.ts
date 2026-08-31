export type CardKind = 'monster' | 'spell' | 'trap'
export type CardFrame = 'normal' | 'effect' | 'ritual' | 'fusion' | 'synchro' | 'xyz' | 'link' | 'spell' | 'trap'
export type SpellTrapIcon = 'continuous' | 'counter' | 'equip' | 'field' | 'quick-play' | 'ritual'

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
}

export interface CatalogStats {
  cards: number
  artworks: number
  ruleVariants: number
  lastSeededAt: string
}

export interface CatalogApi {
  listCards: () => Promise<CatalogCard[]>
  stats: () => Promise<CatalogStats>
  resolveArtwork: (artworkId: string) => Promise<string | null>
}

declare global {
  interface Window {
    arcana: {
      catalog: CatalogApi
      platform: string
    }
  }
}
