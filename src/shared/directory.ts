export const directoryPageRowOptions = [3, 6, 9, 12, 18, 24, 'all'] as const

export type DirectoryPageRows = typeof directoryPageRowOptions[number]

export const defaultDirectoryPageRows: DirectoryPageRows = 12

export function sanitizeDirectoryPageRows(value: unknown): DirectoryPageRows {
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return directoryPageRowOptions.includes(normalized as DirectoryPageRows)
    ? normalized as DirectoryPageRows
    : defaultDirectoryPageRows
}

export function directoryPageSize(rows: DirectoryPageRows, columns: number, itemCount: number): number {
  if (rows === 'all') return Math.max(1, itemCount)
  return Math.max(1, columns) * rows
}

export function clampDirectoryPage(page: number, itemCount: number, pageSize: number): number {
  const pageCount = Math.max(1, Math.ceil(itemCount / Math.max(1, pageSize)))
  return Math.max(0, Math.min(pageCount - 1, page))
}

export function isIndexOnDirectoryPage(index: number, page: number, pageSize: number): boolean {
  const start = page * pageSize
  return index >= start && index < start + pageSize
}

export interface VirtualGridRange {
  startIndex: number
  endIndex: number
  startRow: number
  endRow: number
  totalRows: number
}

export function calculateVirtualGridRange(
  itemCount: number,
  columns: number,
  rowPitch: number,
  scrollTop: number,
  viewportHeight: number,
  overscanRows = 4
): VirtualGridRange {
  const safeColumns = Math.max(1, columns)
  const safePitch = Math.max(1, rowPitch)
  const totalRows = Math.ceil(itemCount / safeColumns)
  const startRow = Math.max(0, Math.floor(Math.max(0, scrollTop) / safePitch) - overscanRows)
  const visibleBottom = Math.max(0, scrollTop) + Math.max(safePitch, viewportHeight)
  const endRow = Math.min(totalRows, Math.ceil(visibleBottom / safePitch) + overscanRows)
  return {
    startIndex: Math.min(itemCount, startRow * safeColumns),
    endIndex: Math.min(itemCount, endRow * safeColumns),
    startRow,
    endRow,
    totalRows
  }
}
