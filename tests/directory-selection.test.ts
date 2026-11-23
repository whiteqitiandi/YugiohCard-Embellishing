import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cardsInsideSelection,
  cardsInsideVirtualGrid,
  selectionRange,
  selectionRectangle,
  setSelectedUnpopular
} from '../src/renderer/src/directorySelection.ts'
import {
  calculateVirtualGridRange,
  clampDirectoryPage,
  directoryPageSize,
  isIndexOnDirectoryPage,
  sanitizeDirectoryPageRows
} from '../src/shared/directory.ts'
import { sortCatalogCards } from '../src/renderer/src/catalogSorting.ts'
import type { CatalogCard } from '../src/shared/catalog.ts'

const sortableCard = (id: string, nameZh: string, atk: number | null, def: number | null): CatalogCard => ({
  id,
  nameZh,
  nameJa: '',
  nameEn: '',
  atk,
  def
} as CatalogCard)

test('equal ATK or DEF values use ascending card names as the secondary order', () => {
  const cards = [
    sortableCard('beta', 'Beta', 2000, 1500),
    sortableCard('charlie', 'Charlie', 1000, 2500),
    sortableCard('alpha', 'Alpha', 2000, 1500)
  ]
  assert.deepEqual(sortCatalogCards(cards, 'atk', 'asc').map((card) => card.id), ['charlie', 'alpha', 'beta'])
  assert.deepEqual(sortCatalogCards(cards, 'atk', 'desc').map((card) => card.id), ['alpha', 'beta', 'charlie'])
  assert.deepEqual(sortCatalogCards(cards, 'def', 'asc').map((card) => card.id), ['alpha', 'beta', 'charlie'])
  assert.deepEqual(sortCatalogCards(cards, 'def', 'desc').map((card) => card.id), ['charlie', 'alpha', 'beta'])
})

test('rectangle is normalized for all drag directions', () => {
  const expected = { left: 10, top: 20, width: 90, height: 130 }
  assert.deepEqual(selectionRectangle({ x: 10, y: 20 }, { x: 100, y: 150 }), expected)
  assert.deepEqual(selectionRectangle({ x: 100, y: 150 }, { x: 10, y: 20 }), expected)
  assert.deepEqual(selectionRectangle({ x: 10, y: 150 }, { x: 100, y: 20 }), expected)
})

test('box selection includes overlapping cards, not gaps or just touching edges', () => {
  const cards = [
    { id: 'a', left: 10, top: 100, width: 60, height: 90 },
    { id: 'b', left: 80, top: 100, width: 60, height: 90 },
    { id: 'c', left: 10, top: 200, width: 60, height: 90 }
  ]
  assert.deepEqual(cardsInsideSelection({ left: 30, top: 150, width: 60, height: 10 }, cards), ['a', 'b'])
  assert.deepEqual(cardsInsideSelection({ left: 70, top: 100, width: 10, height: 90 }, cards), [])
  assert.deepEqual(cardsInsideSelection({ left: 5, top: 195, width: 70, height: 80 }, cards), ['c'])
  assert.deepEqual(cardsInsideSelection({ left: 0, top: 0, width: 0, height: 0 }, cards), [])
})

test('virtualized box selection resolves cards that are not currently mounted', () => {
  const metrics = {
    columns: 2, columnWidths: [90, 90], columnGap: 10,
    paddingLeft: 5, paddingTop: 6, rowPitch: 110, tileWidth: 75, tileHeight: 100
  }
  assert.deepEqual(
    cardsInsideVirtualGrid({ left: 10, top: 8, width: 190, height: 95 }, ['a', 'b', 'c', 'd'], metrics),
    ['a', 'b']
  )
  assert.deepEqual(
    cardsInsideVirtualGrid({ left: 100, top: 120, width: 90, height: 80 }, ['a', 'b', 'c', 'd'], metrics),
    ['d']
  )
})

test('row settings derive page sizes and preserve the nearest valid page after filtering', () => {
  assert.equal(sanitizeDirectoryPageRows('9'), 9)
  assert.equal(sanitizeDirectoryPageRows('all'), 'all')
  assert.equal(sanitizeDirectoryPageRows('999'), 12)
  assert.equal(directoryPageSize(6, 8, 1_000), 48)
  assert.equal(directoryPageSize('all', 8, 1_000), 1_000)
  assert.equal(clampDirectoryPage(3, 145, 48), 3)
  assert.equal(clampDirectoryPage(3, 140, 48), 2)
  assert.equal(isIndexOnDirectoryPage(144, 3, 48), true)
  assert.equal(isIndexOnDirectoryPage(0, 3, 48), false)
})

test('all-card mode renders only visible rows plus overscan', () => {
  assert.deepEqual(calculateVirtualGridRange(1_000, 5, 100, 1_000, 300, 2), {
    startIndex: 40, endIndex: 75, startRow: 8, endRow: 15, totalRows: 200
  })
  const initial = calculateVirtualGridRange(20_000, 8, 112, 0, 300)
  assert.equal(initial.startIndex, 0)
  assert.ok(initial.endIndex <= 64)
})

test('shift ranges stay within the current page and work backwards', () => {
  const ids = ['a', 'b', 'c', 'd']
  assert.deepEqual(selectionRange(ids, 'b', 'd'), ['b', 'c', 'd'])
  assert.deepEqual(selectionRange(ids, 'd', 'b'), ['b', 'c', 'd'])
  assert.deepEqual(selectionRange(ids, 'previous-page', 'b'), ['b'])
  assert.deepEqual(selectionRange(ids, null, 'c'), ['c'])
  assert.deepEqual(selectionRange(ids, 'a', 'missing'), [])
})

test('batch marking deduplicates and sets the requested unpopular state', async () => {
  const calls: Array<[string, boolean]> = []
  const result = await setSelectedUnpopular(['a', 'b', 'a'], true, async (id, value) => {
    calls.push([id, value])
    return true
  })
  assert.deepEqual(calls, [['a', true], ['b', true]])
  assert.deepEqual(result, { savedIds: ['a', 'b'], failures: [] })
})

test('batch clearing sets false without toggling cards that are already non-unpopular', async () => {
  const values = new Map([['a', true], ['b', false], ['unselected', true]])
  const result = await setSelectedUnpopular(['a', 'b', 'a'], false, async (id, value) => {
    values.set(id, value)
    return true
  })
  assert.deepEqual(result, { savedIds: ['a', 'b'], failures: [] })
  assert.deepEqual(Object.fromEntries(values), { a: false, b: false, unselected: true })
})

test('batch failures preserve successful saves and can be retried independently', async () => {
  const result = await setSelectedUnpopular(['a', 'missing', 'error', 'b'], false, async (id, value) => {
    assert.equal(value, false)
    if (id === 'missing') return false
    if (id === 'error') throw new Error("Error invoking remote method 'catalog:set-unpopular': test failure")
    return true
  })
  assert.deepEqual(result.savedIds, ['a', 'b'])
  assert.deepEqual(result.failures, [
    { id: 'missing', message: '找不到這張卡片。' },
    { id: 'error', message: 'test failure' }
  ])
  const retry = await setSelectedUnpopular(result.failures.map((failure) => failure.id), false, async () => true)
  assert.deepEqual(retry.savedIds, ['missing', 'error'])
  assert.deepEqual(await setSelectedUnpopular([], false, async () => { throw new Error('must not save') }), { savedIds: [], failures: [] })
})
