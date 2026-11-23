import type { CatalogPopularityBatchResult } from '../../shared/catalog'

export interface SelectionPoint { x: number; y: number }
export interface SelectionRect { left: number; top: number; width: number; height: number }
export interface SelectionCardBounds extends SelectionRect { id: string }

export interface VirtualGridMetrics {
  columns: number
  columnWidths: number[]
  columnGap: number
  paddingLeft: number
  paddingTop: number
  rowPitch: number
  tileWidth: number
  tileHeight: number
}

export function selectionRectangle(start: SelectionPoint, end: SelectionPoint): SelectionRect {
  return {
    left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y)
  }
}

export function cardsInsideSelection(rect: SelectionRect, cards: SelectionCardBounds[]): string[] {
  return cards.filter((card) =>
    rect.left < card.left + card.width && rect.left + rect.width > card.left &&
    rect.top < card.top + card.height && rect.top + rect.height > card.top
  ).map((card) => card.id)
}

export function cardsInsideVirtualGrid(
  rect: SelectionRect,
  ids: string[],
  metrics: VirtualGridMetrics
): string[] {
  if (ids.length === 0 || metrics.columnWidths.length === 0) return []
  const columns = Math.max(1, Math.min(metrics.columns, metrics.columnWidths.length))
  const pitch = Math.max(1, metrics.rowPitch)
  const firstRow = Math.max(0, Math.floor((rect.top - metrics.paddingTop) / pitch) - 1)
  const lastRow = Math.min(
    Math.ceil(ids.length / columns) - 1,
    Math.ceil((rect.top + rect.height - metrics.paddingTop) / pitch) + 1
  )
  const columnLefts: number[] = []
  let cellLeft = metrics.paddingLeft
  for (let column = 0; column < columns; column += 1) {
    const cellWidth = metrics.columnWidths[column] ?? metrics.columnWidths.at(-1) ?? metrics.tileWidth
    columnLefts.push(cellLeft + Math.max(0, (cellWidth - metrics.tileWidth) / 2))
    cellLeft += cellWidth + metrics.columnGap
  }
  const matches: SelectionCardBounds[] = []
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column
      const id = ids[index]
      if (!id) break
      matches.push({
        id,
        left: columnLefts[column] ?? metrics.paddingLeft,
        top: metrics.paddingTop + row * pitch,
        width: metrics.tileWidth,
        height: metrics.tileHeight
      })
    }
  }
  return cardsInsideSelection(rect, matches)
}

export function selectionRange(ids: string[], anchor: string | null, target: string): string[] {
  const end = ids.indexOf(target)
  if (end < 0) return []
  const start = anchor == null ? end : ids.indexOf(anchor)
  return ids.slice(Math.min(start < 0 ? end : start, end), Math.max(start, end) + 1)
}

export type UnpopularBatchResult = CatalogPopularityBatchResult

// Set the requested value (never toggle). Record partial success so retries are safe.
export async function setSelectedUnpopular(
  ids: string[],
  isUnpopular: boolean,
  save: (id: string, isUnpopular: boolean) => Promise<boolean>
): Promise<UnpopularBatchResult> {
  const result: UnpopularBatchResult = { savedIds: [], failures: [] }
  for (const id of new Set(ids)) {
    try {
      if (!await save(id, isUnpopular)) throw new Error('找不到這張卡片。')
      result.savedIds.push(id)
    } catch (error: unknown) {
      result.failures.push({
        id,
        message: error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '')
          : '無法儲存冷門卡片標記。'
      })
    }
  }
  return result
}
