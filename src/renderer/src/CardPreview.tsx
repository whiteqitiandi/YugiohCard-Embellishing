import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { CatalogCard } from '../../shared/catalog'

export type SurfaceEffect = 'none' | 'crystal' | 'aurora' | 'starlight' | 'full-starlight'
export type SurfaceScope = 'whole' | 'art' | 'frame'
export type RimEffect = 'none' | 'black-metal' | 'silver' | 'gold'
export type NameEffect = 'ink' | 'silver' | 'gold'
export type CardTextMode = 'fit' | 'scroll'

export interface FinishConfig {
  surface: SurfaceEffect
  scope: SurfaceScope
  rim: RimEffect
  name: NameEffect
  stamp: boolean
}

interface CardPreviewProps {
  card: CatalogCard
  artworkId: string
  ruleText: string
  finish: FinishConfig
  interactive?: boolean
  compact?: boolean
  featured?: boolean
  embellishments?: boolean
  textMode?: CardTextMode
}

const artworkMemory = new Map<string, string | null>()
const linkDirections = ['up', 'right-up', 'right', 'right-down', 'down', 'left-down', 'left', 'left-up']
const materialFrames = new Set<CatalogCard['frame']>(['ritual', 'fusion', 'synchro', 'xyz', 'link'])
const mainRuleMaximumRatio = 44 / 1175
const mainRulePreferredMinimumRatio = 26 / 1175
const pendulumRuleMaximumRatio = 44 / 950
const pendulumRulePreferredMinimumRatio = 26 / 950

const splitRuleText = (text: string, frame: CatalogCard['frame']): string[] => {
  if (!materialFrames.has(frame)) return [text]
  const explicitBreak = text.indexOf('\n')
  if (explicitBreak >= 0) {
    return [text.slice(0, explicitBreak), text.slice(explicitBreak + 1).trim()].filter(Boolean)
  }
  const sentenceEnd = text.indexOf('。')
  if (sentenceEnd < 0 || sentenceEnd === text.length - 1) return [text]
  return [text.slice(0, sentenceEnd + 1), text.slice(sentenceEnd + 1).trim()].filter(Boolean)
}

const fitLargestText = (
  box: HTMLElement,
  paragraph: HTMLParagraphElement,
  maximumRatio: number,
  minimumRatio: number
): void => {
  const referenceWidth = box.getBoundingClientRect().width
  const maximum = referenceWidth * maximumRatio
  const preferredMinimum = Math.max(3, referenceWidth * minimumRatio)
  paragraph.style.lineHeight = '1.2'

  const fits = (fontSize: number): boolean => {
    paragraph.style.fontSize = `${fontSize}px`
    const availableHeight = Math.max(0, box.clientHeight - paragraph.offsetTop)
    return paragraph.scrollHeight <= availableHeight + 0.5
  }

  if (fits(maximum)) return

  let lower = preferredMinimum
  let upper = maximum
  if (!fits(lower)) {
    while (lower > 3 && !fits(lower)) lower -= 0.25
    paragraph.style.fontSize = `${Math.max(3, lower)}px`
    return
  }

  for (let index = 0; index < 12; index += 1) {
    const candidate = (lower + upper) / 2
    if (fits(candidate)) lower = candidate
    else upper = candidate
  }
  paragraph.style.fontSize = `${Math.floor(lower * 4) / 4}px`
}

const attributeKeys: Record<string, string> = {
  暗: 'dark',
  闇: 'dark',
  光: 'light',
  地: 'earth',
  水: 'water',
  炎: 'fire',
  火: 'fire',
  風: 'wind',
  风: 'wind',
  神: 'divine',
  魔法: 'spell',
  陷阱: 'trap'
}

export function CardPreview({
  card,
  artworkId,
  ruleText,
  finish,
  interactive = true,
  compact = false,
  featured = false,
  embellishments = true,
  textMode = 'fit'
}: CardPreviewProps): React.JSX.Element {
  const artwork = card.artworks.find((item) => item.id === artworkId) ?? card.artworks[0]
  const artworkCacheKey = artwork ? `${artwork.id}::${artwork.sourceUrl ?? ''}` : artworkId
  const [artUrl, setArtUrl] = useState<string | null>(artworkMemory.get(artworkCacheKey) ?? null)
  const [loading, setLoading] = useState(!artworkMemory.has(artworkCacheKey))
  const stageRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const textBoxRef = useRef<HTMLElement>(null)
  const ruleRef = useRef<HTMLParagraphElement>(null)
  const pendulumBoxRef = useRef<HTMLElement>(null)
  const pendulumRuleRef = useRef<HTMLParagraphElement>(null)
  const isFullCardSource = artwork?.shardKey === 'ygoresources'
  const isPendulum = card.pendulumScaleLeft != null || card.pendulumScaleRight != null
  const ruleSegments = useMemo(() => splitRuleText(ruleText, card.frame), [card.frame, ruleText])

  useEffect(() => {
    let active = true
    if (!artwork) {
      setArtUrl(null)
      setLoading(false)
      return
    }
    const remembered = artworkMemory.get(artworkCacheKey)
    if (remembered !== undefined) {
      setArtUrl(remembered)
      setLoading(false)
      return
    }
    setArtUrl(null)
    setLoading(true)
    const resolver = window.arcana?.catalog.resolveArtwork ?? (() => Promise.resolve(artwork.sourceUrl))
    resolver(artwork.id)
      .then((resolved) => {
        artworkMemory.set(artworkCacheKey, resolved)
        if (active) setArtUrl(resolved)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [artwork, artworkCacheKey])

  const levelMarks = useMemo(() => {
    if (!card.level) return []
    const count = Math.min(card.level, 13)
    return Array.from({ length: count }, (_, index) => index)
  }, [card.level])
  const rankMarks = useMemo(() => {
    if (!card.rank) return []
    const count = Math.min(card.rank, 13)
    return Array.from({ length: count }, (_, index) => index)
  }, [card.rank])

  useLayoutEffect(() => {
    const title = titleRef.current
    if (!title) return
    const fitTitle = (): void => {
      const maximum = title.clientWidth * 0.1045
      const minimum = title.clientWidth * 0.065
      let size = maximum
      title.style.fontSize = `${size}px`
      while (size > minimum && title.scrollWidth > title.clientWidth) {
        size -= 0.25
        title.style.fontSize = `${size}px`
      }
    }
    const frame = requestAnimationFrame(fitTitle)
    const observer = new ResizeObserver(fitTitle)
    observer.observe(title)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [card.nameZh, isFullCardSource])

  useLayoutEffect(() => {
    const box = textBoxRef.current
    const paragraph = ruleRef.current
    if (!box || !paragraph) return

    const fitRuleText = (): void => {
      if (textMode === 'scroll') {
        paragraph.style.lineHeight = '1.2'
        paragraph.style.fontSize = `${box.getBoundingClientRect().width * mainRuleMaximumRatio}px`
        return
      }
      fitLargestText(box, paragraph, mainRuleMaximumRatio, mainRulePreferredMinimumRatio)
    }

    const frame = requestAnimationFrame(fitRuleText)
    const observer = new ResizeObserver(fitRuleText)
    observer.observe(box)
    let active = true
    void document.fonts.ready.then(() => {
      if (active) fitRuleText()
    })
    return () => {
      active = false
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [card.frame, card.kind, compact, featured, isFullCardSource, ruleText, textMode])

  useLayoutEffect(() => {
    const box = pendulumBoxRef.current
    const paragraph = pendulumRuleRef.current
    if (!box || !paragraph || !card.pendulumText) return

    const fitPendulumText = (): void => {
      if (textMode === 'scroll') {
        paragraph.style.lineHeight = '1.2'
        paragraph.style.fontSize = `${box.getBoundingClientRect().width * pendulumRuleMaximumRatio}px`
        return
      }
      fitLargestText(box, paragraph, pendulumRuleMaximumRatio, pendulumRulePreferredMinimumRatio)
    }

    const frame = requestAnimationFrame(fitPendulumText)
    const observer = new ResizeObserver(fitPendulumText)
    observer.observe(box)
    let active = true
    void document.fonts.ready.then(() => {
      if (active) fitPendulumText()
    })
    return () => {
      active = false
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [card.pendulumText, compact, featured, isFullCardSource, textMode])

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!interactive || !stageRef.current) return
    const bounds = stageRef.current.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / bounds.width
    const y = (event.clientY - bounds.top) / bounds.height
    stageRef.current.style.setProperty('--mx', `${x * 100}%`)
    stageRef.current.style.setProperty('--my', `${y * 100}%`)
    stageRef.current.style.setProperty('--rx', `${(0.5 - y) * 7}deg`)
    stageRef.current.style.setProperty('--ry', `${(x - 0.5) * 8}deg`)
    stageRef.current.style.setProperty('--foil-x', `${20 + x * 60}%`)
    stageRef.current.style.setProperty('--foil-y', `${20 + y * 60}%`)
  }

  const resetPointer = (): void => {
    if (!stageRef.current) return
    stageRef.current.style.setProperty('--mx', '50%')
    stageRef.current.style.setProperty('--my', '42%')
    stageRef.current.style.setProperty('--rx', '0deg')
    stageRef.current.style.setProperty('--ry', '0deg')
  }

  const style = { '--card-accent': card.accent } as CSSProperties

  return (
    <div
      ref={stageRef}
      className={`card-stage ${compact ? 'is-compact' : ''} ${featured ? 'is-featured' : ''} ${interactive ? 'is-interactive' : ''}`}
      onPointerMove={onPointerMove}
      onPointerLeave={resetPointer}
      style={style}
      aria-label={`${card.nameZh} 卡片預覽`}
    >
      <article
        className={`duel-card frame-${card.frame} ${isPendulum ? 'is-pendulum' : ''} text-mode-${textMode} surface-${finish.surface} scope-${finish.scope} rim-${finish.rim}`}
      >
        <div className="card-paper-grain" />
        <header className="rendered-card-title-row">
          <h3 ref={titleRef} className={`rendered-card-title name-${finish.name}`}>{card.nameZh}</h3>
          <span
            className={`attribute-orb kind-${card.kind} attribute-${attributeKeys[card.attribute] ?? 'dark'}`}
            aria-label={card.attribute}
          />
        </header>

        {levelMarks.length > 0 && <div className="level-row" aria-label={`等級 ${card.level}`}>
          {levelMarks.map((mark) => (
            <span className="star-mark level-mark" key={mark} />
          ))}
        </div>}
        {rankMarks.length > 0 && <div className="level-row is-rank" aria-label={`階級 ${card.rank}`}>
          {rankMarks.map((mark) => (
            <span className="star-mark rank-mark" key={mark} />
          ))}
        </div>}
        {(card.kind === 'spell' || card.kind === 'trap') && (
          <div className="spell-trap-row" aria-label={card.typeLine}>
            <span>【{card.kind === 'spell' ? '魔法卡' : '陷阱卡'}</span>
            {card.spellTrapIcon && <span className={`spell-trap-icon icon-${card.spellTrapIcon}`} />}
            <span>】</span>
          </div>
        )}

        <div className={`rendered-card-art ${loading ? 'is-loading' : ''} ${isFullCardSource ? 'is-full-card-source' : ''}`}>
          {artUrl ? (
            <img
              src={artUrl}
              alt={`${card.nameZh}－${artwork?.variantLabel ?? '卡圖'}`}
              draggable={false}
              onError={() => {
                artworkMemory.set(artworkCacheKey, null)
                setArtUrl(null)
              }}
            />
          ) : (
            <div className="art-fallback" aria-hidden="true">
              <span>{card.kind === 'monster' ? '✧' : card.kind === 'spell' ? '◇' : '△'}</span>
            </div>
          )}
          <div className="art-vignette" />
          {embellishments && finish.scope === 'art' && <div className={`foil-layer foil-${finish.surface}`} />}
        </div>
        <div className="card-art-mask" aria-hidden="true" />

        {card.frame === 'link' && (
          <div className="link-arrow-layer" aria-hidden="true">
            {linkDirections.map((direction, index) => (
              <span
                key={direction}
                className={`link-arrow arrow-${direction} ${card.linkArrows.includes(index + 1) ? 'is-on' : 'is-off'}`}
              />
            ))}
          </div>
        )}

        {isPendulum && (
          <>
            <span className="pendulum-scale scale-left">{card.pendulumScaleLeft ?? '—'}</span>
            <span className="pendulum-scale scale-right">{card.pendulumScaleRight ?? '—'}</span>
            <section ref={pendulumBoxRef} className="pendulum-card-text">
              <p ref={pendulumRuleRef}>{card.pendulumText}</p>
            </section>
          </>
        )}

        <section ref={textBoxRef} className={`rendered-card-text ${card.kind !== 'monster' ? 'is-spell-trap' : ''}`}>
          {card.kind === 'monster' && <strong>【{card.typeLine}】</strong>}
          <p ref={ruleRef}>
            {ruleSegments.map((segment, index) => (
              <span className={index === 0 && ruleSegments.length > 1 ? 'material-condition' : undefined} key={`${index}-${segment}`}>
                {segment}
              </span>
            ))}
          </p>
        </section>

        {card.kind === 'monster' && (
          <div className={`rendered-card-stats ${card.frame === 'link' ? 'is-link' : ''}`}>
            <span className="stat-atk">{card.atk ?? '—'}</span>
            <span className={card.frame === 'link' ? 'stat-link' : 'stat-def'}>
              {card.frame === 'link' ? card.linkRating ?? '—' : card.def ?? '—'}
            </span>
          </div>
        )}

        <footer className="rendered-card-footer">
          <span>{card.passcode}</span>
          <span>©1996 KAZUKI TAKAHASHI</span>
        </footer>

        {embellishments && finish.scope !== 'art' && <div className={`foil-layer foil-${finish.surface}`} />}
        {embellishments && <div className="glare-layer" />}
        {embellishments && <div className="rim-layer" />}
        {embellishments && finish.stamp && <div className="chronicle-stamp">AA</div>}
      </article>
    </div>
  )
}
