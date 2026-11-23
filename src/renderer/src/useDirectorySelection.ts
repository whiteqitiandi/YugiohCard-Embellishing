import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type KeyboardEvent, type RefObject } from 'react'
import { cardsInsideSelection, selectionRange, selectionRectangle, type SelectionPoint, type SelectionRect } from './directorySelection'

interface SelectionOptions {
  gridRef: RefObject<HTMLDivElement | null>
  cardRefs: RefObject<Map<string, HTMLButtonElement>>
  ids: string[]
  scope: string
  disabled: boolean
  focusedId?: string
  onFocus: (id: string) => void
  hitTest?: (rect: SelectionRect) => string[]
}

interface DragSession {
  pointerId: number
  start: SelectionPoint
  clientStart: SelectionPoint
  client: SelectionPoint
  base: Set<string>
  additive: boolean
  dragging: boolean
  hits: string[]
}

export function useDirectorySelection(options: SelectionOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const selectionRef = useRef(selectedIds)
  const [marquee, setMarquee] = useState<SelectionRect | null>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const anchorRef = useRef<string | null>(null)
  const frameRef = useRef(0)
  const suppressClickRef = useRef(false)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const replaceSelection = (ids: Iterable<string>): void => {
    const next = new Set(ids)
    const previous = selectionRef.current
    if (next.size === previous.size && [...next].every((id) => previous.has(id))) return
    selectionRef.current = next
    setSelectedIds(next)
  }

  const pointInGrid = (grid: HTMLDivElement, point: SelectionPoint): SelectionPoint => {
    const bounds = grid.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(grid.scrollWidth, point.x - bounds.left - grid.clientLeft + grid.scrollLeft)),
      y: Math.max(0, Math.min(grid.scrollHeight, point.y - bounds.top - grid.clientTop + grid.scrollTop))
    }
  }

  const updateDrag = (): void => {
    const session = sessionRef.current
    const { gridRef, cardRefs, hitTest, ids } = optionsRef.current
    const grid = gridRef.current
    if (!session?.dragging || !grid) return
    const bounds = grid.getBoundingClientRect()
    const rectangle = selectionRectangle(session.start, pointInGrid(grid, session.client))
    session.hits = hitTest ? hitTest(rectangle) : cardsInsideSelection(rectangle, ids.flatMap((id) => {
      const card = cardRefs.current.get(id)
      if (!card) return []
      const cardBounds = card.getBoundingClientRect()
      return [{
        id, left: cardBounds.left - bounds.left - grid.clientLeft + grid.scrollLeft,
        top: cardBounds.top - bounds.top - grid.clientTop + grid.scrollTop,
        width: cardBounds.width, height: cardBounds.height
      }]
    }))
    setMarquee(rectangle)
    replaceSelection(session.additive ? [...session.base, ...session.hits] : session.hits)
  }

  const stopDrag = (cancelled: boolean): void => {
    const session = sessionRef.current
    if (!session) return
    sessionRef.current = null
    cancelAnimationFrame(frameRef.current)
    setMarquee(null)
    const grid = optionsRef.current.gridRef.current
    if (grid?.hasPointerCapture(session.pointerId)) grid.releasePointerCapture(session.pointerId)
    if (session.dragging) {
      if (cancelled) replaceSelection(session.base)
      else if (session.hits[0]) {
        anchorRef.current = session.hits[0]
        optionsRef.current.onFocus(session.hits[0])
        optionsRef.current.cardRefs.current.get(session.hits[0])?.focus({ preventScroll: true })
      }
      // The pointer-up click must not replace the completed multi-selection.
      suppressClickRef.current = true
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
      clickTimerRef.current = setTimeout(() => { suppressClickRef.current = false }, 0)
    }
  }

  const autoScroll = (): void => {
    const session = sessionRef.current
    const grid = optionsRef.current.gridRef.current
    if (!session?.dragging || !grid) return
    const bounds = grid.getBoundingClientRect()
    const top = bounds.top + grid.clientTop
    const bottom = top + grid.clientHeight
    const edge = 30
    const delta = session.client.y < top + edge
      ? -Math.min(12, (top + edge - session.client.y) / 3)
      : session.client.y > bottom - edge ? Math.min(12, (session.client.y - bottom + edge) / 3) : 0
    const previous = grid.scrollTop
    grid.scrollTop += delta
    if (grid.scrollTop !== previous) updateDrag()
    frameRef.current = requestAnimationFrame(autoScroll)
  }

  useEffect(() => {
    const move = (event: globalThis.PointerEvent): void => {
      const session = sessionRef.current
      const grid = optionsRef.current.gridRef.current
      if (!session || !grid || event.pointerId !== session.pointerId) return
      session.client = { x: event.clientX, y: event.clientY }
      if (!session.dragging && Math.hypot(event.clientX - session.clientStart.x, event.clientY - session.clientStart.y) >= 5) {
        session.dragging = true
        grid.setPointerCapture(event.pointerId)
        suppressClickRef.current = true
        frameRef.current = requestAnimationFrame(autoScroll)
      }
      if (session.dragging) {
        event.preventDefault()
        updateDrag()
      }
    }
    const up = (event: globalThis.PointerEvent): void => {
      if (sessionRef.current?.pointerId === event.pointerId) stopDrag(false)
    }
    const cancel = (): void => stopDrag(true)
    const key = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && sessionRef.current && !event.defaultPrevented) {
        event.preventDefault()
        stopDrag(true)
      }
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key)
      cancelAnimationFrame(frameRef.current)
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
      sessionRef.current = null
    }
  }, [])

  useEffect(() => {
    stopDrag(true)
    replaceSelection([])
    anchorRef.current = null
  }, [options.scope])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (optionsRef.current.disabled || event.button !== 0 || !event.isPrimary || event.pointerType === 'touch') return
    const grid = event.currentTarget
    const bounds = grid.getBoundingClientRect()
    if (event.clientX >= bounds.left + grid.clientLeft + grid.clientWidth || event.clientY >= bounds.top + grid.clientTop + grid.clientHeight) return
    const client = { x: event.clientX, y: event.clientY }
    sessionRef.current = {
      pointerId: event.pointerId, start: pointInGrid(grid, client), clientStart: client, client,
      base: new Set(selectionRef.current), additive: event.ctrlKey || event.metaKey || event.shiftKey,
      dragging: false, hits: []
    }
  }

  const onCardClick = (event: MouseEvent<HTMLButtonElement>, id: string): void => {
    const current = optionsRef.current
    current.onFocus(id)
    if (current.disabled) return
    if (event.shiftKey) {
      const range = selectionRange(current.ids, anchorRef.current ?? current.focusedId ?? null, id)
      replaceSelection(event.ctrlKey || event.metaKey ? [...selectionRef.current, ...range] : range)
    } else if (event.ctrlKey || event.metaKey) {
      const next = new Set(selectionRef.current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      replaceSelection(next)
      anchorRef.current = id
    } else {
      replaceSelection([id])
      anchorRef.current = id
    }
  }

  const onClickCapture = (event: MouseEvent<HTMLDivElement>): void => {
    if (!suppressClickRef.current) return
    event.preventDefault()
    event.stopPropagation()
  }

  const onBackgroundClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!optionsRef.current.disabled && !(event.target as Element).closest('.directory-card-tile')) replaceSelection([])
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): boolean => {
    if (optionsRef.current.disabled) return false
    if (event.key === 'Escape') {
      event.preventDefault()
      if (sessionRef.current) stopDrag(true)
      else replaceSelection([])
      return true
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      replaceSelection(optionsRef.current.ids)
      return true
    }
    if (event.key === ' ' && optionsRef.current.focusedId) {
      event.preventDefault()
      const next = new Set(selectionRef.current)
      const id = optionsRef.current.focusedId
      if (next.has(id)) next.delete(id)
      else next.add(id)
      replaceSelection(next)
      return true
    }
    return false
  }

  return { selectedIds, marquee, replaceSelection, onPointerDown, onCardClick, onClickCapture, onBackgroundClick, onKeyDown }
}
