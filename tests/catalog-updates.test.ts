import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { test, type TestContext } from 'node:test'
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CatalogCoverage, CatalogUpdateRequest, CatalogUpdateState } from '../src/shared/catalog'
import { CatalogUpdateService } from '../src/main/catalog-update-service'
import { CatalogDatabase, type CatalogPendingRecord } from '../src/main/catalog-database'
import { CatalogUpdateJob, UPDATE_BATCH_COOLDOWN_MS } from '../src/main/catalog-update-job'
import { type CatalogImportRecord, YgoprodeckSource } from '../src/main/ygoprodeck-source'
import { type ChineseLocalizationResult, YgocdbSource } from '../src/main/ygocdb-source'
import { YgoresourcesSource } from '../src/main/ygoresources-source'
import { waitForUpdate } from '../src/main/update-control'

const request: CatalogUpdateRequest = { mode: 'through', region: 'ocg', year: 1999, month: 1 }
const records = (count: number): CatalogImportRecord[] => Array.from({ length: count }, (_, index) => ({
  id: `ygoprodeck-${index + 1}`, remoteId: index + 1, passcode: String(index + 1).padStart(8, '0'), name: `Card ${index + 1}`,
  konamiId: null, kind: 'monster', frame: 'effect', attribute: '光', race: '龍族', typeLine: '龍族／效果',
  level: 4, rank: null, linkRating: null, linkArrows: [], spellTrapIcon: null,
  pendulumScaleLeft: null, pendulumScaleRight: null, pendulumText: null, atk: 1000, def: 1000,
  ruleText: 'Effect', archetype: null, artworks: [], accent: '#c77b48', sourceUrl: 'https://ygoprodeck.com/',
  releaseDate: '1999-01-01', ocgReleaseDate: '1999-01-01', tcgReleaseDate: null
}))
const localize = async (cards: CatalogImportRecord[]): Promise<ChineseLocalizationResult> => ({
  requestsUsed: Math.ceil(cards.length / 100), missingPasscodes: [],
  localizations: new Map(cards.map((card) => [card.passcode, {
    passcode: card.passcode, konamiId: null, nameZh: '中文卡名', nameJa: '日本語', nameEn: card.name,
    ruleTextZh: '中文效果', pendulumTextZh: null, sourceUrl: 'https://ygocdb.com/'
  }]))
})
const noLocalization = async (): Promise<ChineseLocalizationResult> => ({ requestsUsed: 1, missingPasscodes: [], localizations: new Map() })
const fakeClock = (t: TestContext): void => t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-09-03T00:00:00Z') })
const flush = async (): Promise<void> => { await setImmediate(); await setImmediate() }

test('batch popularity updates use one transaction and preserve missing-card failures', (t) => {
  const database = new CatalogDatabase(':memory:')
  t.after(() => database.close())
  const ids = database.listCards().slice(0, 3).map((card) => card.id)
  assert.equal(ids.length, 3)

  const marked = database.setUnpopularBatch([ids[0], ids[1], ids[0], 'missing-card'], true)
  assert.deepEqual(marked, {
    savedIds: [ids[0], ids[1]],
    failures: [{ id: 'missing-card', message: '找不到這張卡片。' }]
  })
  assert.deepEqual(
    database.listCards().filter((card) => ids.includes(card.id)).map((card) => card.isUnpopular),
    [true, true, false]
  )

  const cleared = database.setUnpopularBatch(ids, false)
  assert.deepEqual(cleared, { savedIds: ids, failures: [] })
  assert.equal(database.listCards().some((card) => ids.includes(card.id) && card.isUnpopular), false)
})

test('fallback catalog records stay visible and duplicate artwork URLs are collapsed', (t) => {
  const database = new CatalogDatabase(':memory:')
  t.after(() => database.close())
  const card = {
    ...records(1)[0],
    artworks: [
      { id: 'duplicate-a', variantLabel: '版本 1', sourceUrl: 'https://images.ygoprodeck.com/images/cards_cropped/1.jpg', shardKey: 'test' },
      { id: 'duplicate-b', variantLabel: '版本 2', sourceUrl: 'https://images.ygoprodeck.com/images/cards_cropped/1.jpg', shardKey: 'test' }
    ],
    localizationStatus: 'english-fallback' as const
  }
  database.importSourceMonth([card], request)
  const imported = database.listCards().find((item) => item.passcode === card.passcode)
  assert.ok(imported)
  assert.equal(imported.localizationStatus, 'english-fallback')
  assert.equal(imported.artworks.length, 1)
  assert.equal(imported.artworks[0]?.sourceUrl, card.artworks[0].sourceUrl)
})

test('full inventory reconciliation imports cards missed by release-date scans and replaces artwork inventory', async (t) => {
  const database = new CatalogDatabase(':memory:')
  t.after(() => database.close())
  const card = {
    ...records(1)[0], id: 'ygoprodeck-38033121', remoteId: 38033121, passcode: '38033121',
    konamiId: 4766, name: 'Dark Magician Girl', releaseDate: '2000-07-25', ocgReleaseDate: '2000-07-25'
  }
  let inventoryCalls = 0
  const metadata = {
    fetchReleaseMonth: async () => ({ request, result: { records: [], requestsUsed: 0, complete: true, skipped: 0 } }),
    fetchDatabaseVersion: async () => ({ version: 'test-version', lastUpdate: null, requestsUsed: 1 }),
    fetchInventory: async () => {
      inventoryCalls += 1
      return { request, result: { records: [card], requestsUsed: 1, complete: true, skipped: 0, totalRows: 1 } }
    }
  }
  const chinese = { localize: async (values: CatalogImportRecord[]) => localize(values) }
  let artworkManifestVersion = 'manifest-v1'
  const artwork = { enrich: async (values: CatalogImportRecord[]) => ({
    records: values.map((value) => ({ ...value, artworks: [
      { id: 'dmg-1', variantLabel: '卡圖版本 1', sourceUrl: 'https://artworks-en-n.ygoresources.com/dmg-1.png', sourceName: 'YGOResources 卡圖索引', shardKey: 'ygoresources' },
      { id: 'dmg-2', variantLabel: '卡圖版本 2', sourceUrl: 'https://artworks-en-n.ygoresources.com/dmg-2.png', sourceName: 'YGOResources 卡圖索引', shardKey: 'ygoresources' }
    ] })),
    version: 'art-test', requestsUsed: 1, cardsWithArtwork: 1, artworkCount: 2
  }), fetchVersion: async () => ({ version: artworkManifestVersion, requestsUsed: 1 }) }
  const service = new CatalogUpdateService(database, metadata, chinese, artwork)
  const result = await service.reconcileInventory(request, {}, true)
  assert.ok(result)
  assert.equal(result.inserted, 1)
  const imported = database.listCards().find((item) => item.passcode === '38033121')
  assert.equal(imported?.nameEn, 'Dark Magician Girl')
  assert.deepEqual(imported?.artworks.map((item) => item.id), ['dmg-1', 'dmg-2'])
  assert.equal(database.getMetaValue('inventory_ocg_ygoprodeck_version'), 'test-version')
  assert.equal(database.getMetaValue('artwork_ygoresources_manifest_version'), 'manifest-v1')

  artworkManifestVersion = 'manifest-v2'
  assert.ok(await service.reconcileInventory(request))
  assert.equal(inventoryCalls, 2)
  assert.equal(database.getMetaValue('artwork_ygoresources_manifest_version'), 'manifest-v2')
  assert.equal(await service.reconcileInventory(request), null)
  assert.equal(inventoryCalls, 2)
})

test('inventory reconciliation directly looks up source-less curated cards', async (t) => {
  const database = new CatalogDatabase(':memory:')
  t.after(() => database.close())
  const darkMagician = {
    ...records(1)[0], id: 'ygoprodeck-46986414', remoteId: 46986414, passcode: '46986414',
    konamiId: 4041, name: 'Dark Magician', releaseDate: '1999-02-04', ocgReleaseDate: '1999-02-04'
  }
  let lookupPasscodes: string[] = []
  const metadata = {
    fetchReleaseMonth: async () => ({ request, result: { records: [], requestsUsed: 0, complete: true, skipped: 0 } }),
    fetchDatabaseVersion: async () => ({ version: 'targeted-test', lastUpdate: null, requestsUsed: 1 }),
    fetchInventory: async () => ({ request, result: { records: [], requestsUsed: 1, complete: true, skipped: 0, totalRows: 0 } }),
    fetchByPasscodes: async (_value: unknown, passcodes: string[]) => {
      lookupPasscodes = passcodes
      return { request, result: { records: [darkMagician], requestsUsed: 1, complete: true, skipped: 0 } }
    }
  }
  const artwork = { enrich: async (values: CatalogImportRecord[]) => ({
    records: values.map((value) => ({ ...value, artworks: [{
      id: 'dark-magician-art-1', variantLabel: '卡圖版本 1',
      sourceUrl: 'https://artworks-en-n.ygoresources.com/dark-magician-1.png',
      sourceName: 'YGOResources 卡圖索引', shardKey: 'ygoresources'
    }] })),
    version: 'art-targeted-test', requestsUsed: 1, cardsWithArtwork: 1, artworkCount: 1
  }) }
  const service = new CatalogUpdateService(database, metadata, { localize }, artwork)

  await service.reconcileInventory(request, {}, true)

  assert.ok(lookupPasscodes.includes('46986414'))
  const imported = database.listCards().find((item) => item.passcode === '46986414')
  assert.equal(imported?.konamiId, 4041)
  assert.equal(imported?.sourceName, 'YGOPRODeck API v7')
  assert.deepEqual(imported?.artworks.map((item) => item.id), ['dark-magician-art-1'])

  lookupPasscodes = []
  await service.reconcileInventory(request, {}, true)
  assert.ok(lookupPasscodes.includes('46986414'), 'cards missing from the bulk inventory remain eligible for direct refresh')
})

test('artwork manifest creates unique IDs and chooses Chinese, Japanese, then English representatives', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    neuron_version: { tcg_high: '1.1.597', ocg_high: '1.1.598' },
    cards: {
      4007: {
        1: {
          bestArt: 'https://artworks-en-n.ygoresources.com/version-1.png',
          idx: {
            en: [{ path: '//artworks-en-n.ygoresources.com/version-1.png', source: 'neuron_high' }],
            ja: [{ path: '//artworks-jp-n.ygoresources.com/version-1.png', source: 'neuron_high' }],
            cn: [{ path: '//artworks-cn-db.ygoresources.com/version-1.png', source: 'database' }]
          }
        },
        2: {
          bestArt: 'https://artworks-en-n.ygoresources.com/version-2.png',
          idx: {
            en: [{ path: '//artworks-en-n.ygoresources.com/version-2.png', source: 'neuron_high' }],
            ja: [
              { path: '//artworks-jp-db.ygoresources.com/version-2.png', source: 'database' },
              { path: '//artworks-jp-n.ygoresources.com/version-2.png', source: 'neuron_high' }
            ]
          }
        },
        3: {
          bestArt: 'https://artworks-en-n.ygoresources.com/version-3.png',
          idx: { en: [{ path: '//artworks-en-n.ygoresources.com/version-3.png', source: 'neuron_high' }] }
        }
      }
    }
  })))
  const source = new YgoresourcesSource()
  const input = records(2).map((card, index) => ({
    ...card,
    passcode: index === 0 ? '89631139' : '00000001',
    konamiId: 4007
  }))

  const result = await source.enrich(input)

  assert.equal(result.version, 'ocg_high=1.1.598;tcg_high=1.1.597')
  assert.notEqual(result.records[0]?.artworks[0]?.id, result.records[1]?.artworks[0]?.id)
  assert.match(result.records[0]?.artworks[0]?.id ?? '', /89631139/)
  assert.match(result.records[1]?.artworks[0]?.id ?? '', /00000001/)
  assert.match(result.records[0]?.artworks[0]?.sourceUrl ?? '', /artworks-cn-db/)
  assert.match(result.records[0]?.artworks[1]?.sourceUrl ?? '', /artworks-jp-n/)
  assert.match(result.records[0]?.artworks[2]?.sourceUrl ?? '', /artworks-en-n/)
})

const fixture = (cards = records(501)) => {
  let coverage: CatalogCoverage = { region: 'ocg', completeThrough: null, scannedThrough: null, pendingCards: 0, resumeMonth: null, resumeOffset: 0, targetMonth: null, status: 'not-started', note: null }
  const pending = new Map<string, CatalogPendingRecord>()
  const imported = new Set<string>()
  const chunks: number[] = []
  const metadataCalls: CatalogUpdateRequest[] = []
  const database = {
    getCoverage: () => structuredClone({ ...coverage, pendingCards: pending.size,
      status: coverage.status === 'complete' && pending.size > 0 ? 'complete-with-gaps' as const : coverage.status }),
    saveCoverage: (value: CatalogCoverage) => { coverage = structuredClone(value) },
    savePendingCards: (values: CatalogPendingRecord[], region: string) => {
      values.forEach((value) => pending.set(`${region}/${value.card.passcode}`, structuredClone(value)))
    },
    resolvePendingCards: (passcodes: string[], region: string) => { passcodes.forEach((value) => pending.delete(`${region}/${value}`)) },
    pendingRecords: (region: string, through: string) => [...pending.entries()]
      .filter(([key, value]) => key.startsWith(`${region}/`) && value.releaseMonth <= through).map(([, value]) => structuredClone(value)),
    importSourceMonth: (values: CatalogImportRecord[]) => {
      const inserted = values.filter((card) => !imported.has(card.id)).length
      values.forEach((card) => imported.add(card.id))
      return { inserted, updated: values.length - inserted }
    }
  }
  const metadata = {
    fetchReleaseMonth: async (value: unknown) => {
      const input = value as CatalogUpdateRequest
      metadataCalls.push(input)
      return { request: input, result: { records: cards, requestsUsed: 1, complete: true, skipped: 0 } }
    }
  }
  const chinese = {
    localize: async (values: CatalogImportRecord[]) => { chunks.push(values.length); return localize(values) }
  }
  const states: CatalogUpdateState[] = []
  const service = new CatalogUpdateService(database, metadata, chinese)
  const job = new CatalogUpdateJob(service, (state) => states.push(state))
  return { job, service, states, database, metadata, chinese, imported, chunks, metadataCalls }
}

test('automatically continues after the 500-card limit and full cooldown, with accurate totals', async (t) => {
  fakeClock(t)
  const f = fixture()
  f.job.start(request)
  assert.throws(() => f.job.start(request), /已有更新作業/)
  await flush()
  assert.equal(f.job.snapshot().status, 'cooling')
  assert.equal(f.imported.size, 500)
  assert.equal(f.database.getCoverage().resumeOffset, 500)
  assert.equal(f.job.snapshot().progress?.monthTotal, 501)
  assert.equal(f.job.snapshot().nextBatchAt, Date.now() + UPDATE_BATCH_COOLDOWN_MS)
  t.mock.timers.tick(UPDATE_BATCH_COOLDOWN_MS - 1)
  await flush()
  assert.equal(f.metadataCalls.length, 1)
  t.mock.timers.tick(1)
  await f.job.settled()
  const final = f.job.snapshot()
  assert.equal(final.status, 'completed')
  assert.equal(final.batchNumber, 2)
  assert.equal(final.inserted, 501)
  assert.equal(final.updated, 0)
  assert.equal(final.progress?.percent, 100)
  assert.equal(f.database.getCoverage().completeThrough, '1999-01-31')
  assert.deepEqual(f.chunks, [100, 100, 100, 100, 100, 1])
  const values = f.states.map((state) => state.progress?.percent ?? 0)
  assert.ok(values.every((value, index) => index === 0 || value >= values[index - 1]))
})

test('40 metadata requests end a batch even across empty months; next batch finishes automatically', async (t) => {
  fakeClock(t)
  const f = fixture([])
  f.job.start({ ...request, year: 2002, month: 6 })
  await flush()
  assert.equal(f.metadataCalls.length, 40)
  assert.equal(f.job.snapshot().status, 'cooling')
  assert.equal(f.job.snapshot().progress?.completedMonths, 40)
  t.mock.timers.tick(UPDATE_BATCH_COOLDOWN_MS)
  await f.job.settled()
  assert.equal(f.metadataCalls.length, 42)
  assert.equal(f.job.snapshot().status, 'completed')
  assert.equal(f.job.snapshot().progress?.percent, 100)
})

test('request count limit is respected even for months with fewer than 100 cards', async (t) => {
  fakeClock(t)
  const f = fixture(records(1))
  f.job.start({ ...request, month: 6 })
  await flush()
  assert.equal(f.chunks.length, 5)
  assert.equal(f.job.snapshot().status, 'cooling')
  t.mock.timers.tick(UPDATE_BATCH_COOLDOWN_MS)
  await f.job.settled()
  assert.equal(f.chunks.length, 6)
  assert.equal(f.job.snapshot().status, 'completed')
})

test('pause saves the current 100-card checkpoint; resume honors cooldown without reimporting it', async (t) => {
  fakeClock(t)
  const f = fixture(records(201))
  let paused = false
  const job = new CatalogUpdateJob(f.service, (state) => {
    if (!paused && state.fetched === 100) { paused = true; job.control('pause') }
  })
  job.start(request)
  await job.settled()
  assert.equal(job.snapshot().status, 'paused')
  assert.equal(f.database.getCoverage().resumeOffset, 100)
  assert.equal(f.imported.size, 100)
  assert.throws(() => job.start(request), /已有更新作業/)
  job.control('resume')
  await flush()
  assert.equal(job.snapshot().status, 'cooling')
  assert.equal(f.chunks.length, 1)
  t.mock.timers.tick(UPDATE_BATCH_COOLDOWN_MS)
  await job.settled()
  assert.equal(job.snapshot().status, 'completed')
  assert.equal(job.snapshot().inserted, 201)
  assert.equal(job.snapshot().updated, 0)
  assert.deepEqual(f.chunks, [100, 100, 1])
})

test('cancel interrupts cooling, never schedules another batch, and retains saved data', async (t) => {
  fakeClock(t)
  const f = fixture()
  f.job.start(request)
  await flush()
  f.job.control('cancel')
  await f.job.settled()
  assert.equal(f.job.snapshot().status, 'cancelled')
  t.mock.timers.tick(300_000)
  await flush()
  assert.equal(f.metadataCalls.length, 1)
  assert.equal(f.imported.size, 500)
  assert.equal(f.database.getCoverage().resumeOffset, 500)
})

test('pause during cooling and cancel while paused leave no live timer', async (t) => {
  fakeClock(t)
  const f = fixture()
  f.job.start(request)
  await flush()
  f.job.control('pause')
  await f.job.settled()
  assert.equal(f.job.snapshot().status, 'paused')
  f.job.control('cancel')
  assert.equal(f.job.snapshot().status, 'cancelled')
  t.mock.timers.tick(300_000)
  await flush()
  assert.equal(f.metadataCalls.length, 1)
})

test('starting again after cancellation cannot bypass cooldown or discard the saved cursor', async (t) => {
  fakeClock(t)
  const f = fixture()
  f.job.start(request)
  await flush()
  f.job.control('cancel')
  await f.job.settled()
  f.job.start(request)
  await flush()
  assert.equal(f.job.snapshot().status, 'cooling')
  assert.equal(f.metadataCalls.length, 1)
  t.mock.timers.tick(UPDATE_BATCH_COOLDOWN_MS)
  await f.job.settled()
  assert.equal(f.job.snapshot().status, 'completed')
  assert.equal(f.job.snapshot().inserted, 1)
  assert.equal(f.job.snapshot().updated, 0)
  assert.equal(f.imported.size, 501)
})

test('a partially fetched month is retried with a fresh metadata budget without skipping it', async (t) => {
  fakeClock(t)
  const f = fixture([])
  const attempts: number[] = []
  const service = new CatalogUpdateService(f.database, {
    fetchReleaseMonth: async (input, budget = 40) => {
      const month = (input as CatalogUpdateRequest).month
      if (month === 2) attempts.push(budget)
      return {
        request: input as CatalogUpdateRequest,
        result: { records: [], complete: month === 1 || budget >= 2, requestsUsed: month === 1 ? 39 : Math.min(2, budget), skipped: 0 }
      }
    }
  }, f.chinese)
  const job = new CatalogUpdateJob(service, () => {})
  job.start({ ...request, month: 2 })
  await flush()
  assert.equal(job.snapshot().status, 'cooling')
  assert.equal(f.database.getCoverage().resumeMonth, '1999-02')
  t.mock.timers.tick(UPDATE_BATCH_COOLDOWN_MS)
  await job.settled()
  assert.deepEqual(attempts, [1, 40])
  assert.equal(job.snapshot().status, 'completed')
  assert.equal(f.database.getCoverage().completeThrough, '1999-02-28')
})

test('cancellation of an in-flight fetch prevents all subsequent imports', async (t) => {
  fakeClock(t)
  const f = fixture(records(1))
  const service = new CatalogUpdateService(f.database, {
    fetchReleaseMonth: async (input, _budget, signal) => {
      await waitForUpdate(10_000, signal)
      return f.metadata.fetchReleaseMonth(input)
    }
  }, f.chinese)
  const job = new CatalogUpdateJob(service, () => {})
  job.start(request)
  await flush()
  job.control('cancel')
  await job.settled()
  assert.equal(job.snapshot().status, 'cancelled')
  t.mock.timers.tick(60_000)
  await flush()
  assert.equal(f.imported.size, 0)
  assert.equal(f.metadataCalls.length, 0)
})

test('missing Chinese is recorded without pausing or retrying the same gap', async (t) => {
  fakeClock(t)
  const f = fixture(records(3))
  const service = new CatalogUpdateService(f.database, f.metadata, {
    localize: async (cards) => {
      const result = await localize(cards)
      result.localizations.get(cards[1].passcode)!.nameZh = null
      return result
    }
  })
  const job = new CatalogUpdateJob(service, () => {})
  job.start(request)
  await job.settled()
  assert.equal(job.snapshot().status, 'completed')
  assert.equal(f.database.getCoverage().resumeOffset, 0)
  assert.equal(f.database.getCoverage().pendingCards, 1)
  assert.equal(job.snapshot().deferred, 1)
  assert.equal(f.imported.size, 2)
  assert.equal(job.snapshot().progress!.percent, 100)
  t.mock.timers.tick(300_000)
  await flush()
  assert.equal(f.metadataCalls.length, 1)
})

for (const mode of ['month', 'through'] as const) {
  test(`OCG ${mode} imports Chinese-only cards and exposes them in the real SQLite catalog`, async (t) => {
    const cards = records(2).map((card, index) => ({ ...card, name: '', tcgReleaseDate: index === 0 ? null : '2002-01-01' }))
    const f = fixture(cards)
    const database = new CatalogDatabase(':memory:')
    t.after(() => database.close())
    const before = database.stats().cards
    // A cursor saved under the old Japanese requirement must now advance normally.
    if (mode === 'through') database.saveCoverage({ ...f.database.getCoverage(), resumeMonth: '1999-01', status: 'waiting-language' })
    const service = new CatalogUpdateService(database, f.metadata, {
      localize: async (values) => {
        const result = await localize(values)
        result.localizations.forEach((value) => { value.nameJa = null; value.nameEn = null })
        return result
      }
    })
    const result = await service.run({ ...request, mode })
    assert.equal(result.stoppedBy, 'complete')
    assert.equal(result.missingRequiredLanguages, 0)
    assert.deepEqual(result.languageGaps, { zh: 0, en: 0, ja: 0 })
    assert.equal(result.inserted, 2)
    assert.equal(database.stats().cards, before + 2)
    for (const record of cards) {
      const card = database.listCards().find((item) => item.passcode === record.passcode)!
      assert.ok(card, 'The imported card must remain visible')
      assert.equal(card.nameZh, '中文卡名')
      assert.equal(card.nameJa, '')
      assert.equal(card.nameEn, '')
      assert.deepEqual(card.requiredLanguages, ['zh'])
      assert.deepEqual(card.supportedLanguages, ['zh'])
      assert.equal(card.ruleTexts[0].textZh, '中文效果')
    }
    assert.equal(database.getCoverage('ocg').completeThrough, mode === 'through' ? '1999-01-31' : null)
  })
}

test('OCG still requires Chinese effect text, even when other languages are present', async () => {
  const f = fixture(records(1))
  const service = new CatalogUpdateService(f.database, f.metadata, {
    localize: async (cards) => {
      const result = await localize(cards)
      result.localizations.get(cards[0].passcode)!.ruleTextZh = null
      return result
    }
  })
  const result = await service.run(request)
  assert.equal(result.stoppedBy, 'complete')
  assert.equal(result.languageGaps.zh, 1)
  assert.equal(f.imported.size, 0)
  assert.equal(f.database.getCoverage().pendingCards, 1)
})

test('TCG language rules remain unchanged for exclusive and cross-region cards', async (t) => {
  const cards = records(2).map((card, index) => ({
    ...card, releaseDate: '2002-01-01', tcgReleaseDate: '2002-01-01', ocgReleaseDate: index === 0 ? null : '1999-01-01'
  }))
  const f = fixture(cards)
  const database = new CatalogDatabase(':memory:')
  t.after(() => database.close())
  const service = new CatalogUpdateService(database, f.metadata, {
    localize: async (values) => {
      const result = await localize(values)
      result.localizations.forEach((value) => { value.nameJa = null })
      return result
    }
  })
  const tcgRequest: CatalogUpdateRequest = { ...request, region: 'tcg', year: 2002 }
  const result = await service.run(tcgRequest)
  assert.equal(result.stoppedBy, 'complete')
  assert.equal(result.inserted, 1)
  assert.equal(result.languageGaps.ja, 1)
  assert.equal(database.getCoverage('tcg').scannedThrough, '2002-01-31')
  assert.equal(database.getCoverage('tcg').pendingCards, 1)
  assert.equal(database.getCoverage('tcg').status, 'complete-with-gaps')
  assert.deepEqual(database.listCards().find((item) => item.id === cards[0].id)?.requiredLanguages, ['zh', 'en'])
  assert.ok(!database.listCards().some((item) => item.id === cards[1].id))

  // Direct database callers must not bypass the TCG validation either.
  assert.throws(() => database.importSourceMonth([{
    ...cards[1], nameZh: '中文卡名', ruleTextZh: '中文效果', nameEn: 'English', nameJa: '', localizationSourceName: 'test'
  }], tcgRequest), /語系規則/)
  assert.throws(() => database.importSourceMonth([{
    ...cards[0], nameZh: '中文卡名', ruleTextZh: '中文效果', nameEn: '', nameJa: '', localizationSourceName: 'test'
  }], tcgRequest), /語系規則/)
})

test('Chinese-only OCG updates preserve previously stored Japanese and English names', (t) => {
  const database = new CatalogDatabase(':memory:')
  t.after(() => database.close())
  const card: CatalogImportRecord = {
    ...records(1)[0], nameZh: '中文卡名', ruleTextZh: '中文效果', nameJa: '日本語', nameEn: 'English', localizationSourceName: 'test'
  }
  database.importSourceMonth([card], request)
  database.importSourceMonth([{ ...card, nameZh: '更新中文名', nameJa: '', nameEn: '' }], request)
  const updated = database.listCards().find((item) => item.id === card.id)!
  assert.equal(updated.nameZh, '更新中文名')
  assert.equal(updated.nameJa, '日本語')
  assert.equal(updated.nameEn, 'English')
  assert.deepEqual(updated.requiredLanguages, ['zh'])
  assert.throws(() => database.importSourceMonth([{ ...card, ruleTextZh: '' }], request), /語系規則/)
})

test('501 missing cards are deferred across automatic batches; later scans do not revisit their gaps', async (t) => {
  fakeClock(t)
  const f = fixture(records(501))
  const database = new CatalogDatabase(':memory:')
  t.after(() => database.close())
  const states: CatalogUpdateState[] = []
  const job = new CatalogUpdateJob(new CatalogUpdateService(database, f.metadata, { localize: noLocalization }), (state) => states.push(state))
  job.start(request)
  await flush()
  assert.equal(job.snapshot().status, 'cooling')
  assert.equal(database.pendingCards('ocg').total, 500)
  assert.equal(database.getCoverage('ocg').resumeOffset, 500)
  t.mock.timers.tick(UPDATE_BATCH_COOLDOWN_MS)
  await job.settled()
  assert.equal(job.snapshot().status, 'completed')
  assert.equal(job.snapshot().deferred, 501)
  assert.equal(database.pendingCards('ocg').total, 501)
  assert.equal(database.pendingCards('ocg', 10).items.length, 1)
  assert.equal(database.getCoverage('ocg').scannedThrough, '1999-01-31')
  assert.equal(database.getCoverage('ocg').completeThrough, null)
  assert.equal(database.getCoverage('ocg').status, 'complete-with-gaps')
  assert.equal(job.snapshot().progress?.percent, 100)
  assert.ok(!states.some((state) => ['paused', 'blocked'].includes(state.status)))
  job.start(request)
  await flush()
  t.mock.timers.tick(UPDATE_BATCH_COOLDOWN_MS)
  await job.settled()
  assert.equal(f.metadataCalls.length, 2)
  assert.equal(job.snapshot().fetched, 0)
  assert.equal(database.pendingCards('ocg').items[0].attempts, 1)
})

test('later months continue despite earlier gaps and complete coverage remains bounded by the first gap', async (t) => {
  const database = new CatalogDatabase(':memory:')
  t.after(() => database.close())
  const service = new CatalogUpdateService(database, {
    fetchReleaseMonth: async (input) => {
      const request = input as CatalogUpdateRequest
      const month = `1999-${String(request.month).padStart(2, '0')}`
      const cards = records(2).map((card, index) => ({ ...card, id: `ygoprodeck-${request.month * 10 + index}`,
        remoteId: request.month * 10 + index, passcode: String(request.month * 10 + index).padStart(8, '0'), releaseDate: `${month}-${index === 0 ? '15' : '20'}` }))
      return { request, result: { records: cards, complete: true, requestsUsed: 1, skipped: 0 } }
    }
  }, {
    localize: async (cards) => {
      const result = await localize(cards)
      result.localizations.get(cards[0].passcode)!.ruleTextZh = null
      return result
    }
  })
  const result = await service.run({ ...request, month: 2 })
  assert.equal(result.stoppedBy, 'complete')
  assert.equal(result.inserted, 2)
  assert.equal(result.pendingCards, 2)
  assert.equal(database.getCoverage('ocg').scannedThrough, '1999-02-28')
  assert.equal(database.getCoverage('ocg').completeThrough, '1999-01-14')
  assert.deepEqual(database.pendingCards('ocg').items.map((card) => card.releaseMonth), ['1999-01', '1999-02'])
})

test('pending payloads survive reopening; targeted repair clears successes and leaves remaining gaps for later', async (t) => {
  fakeClock(t)
  const directory = mkdtempSync(join(tmpdir(), 'arcana-pending-test-'))
  const path = join(directory, 'catalog.sqlite')
  let database = new CatalogDatabase(path)
  t.after(() => {
    database.close()
    for (const file of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(file)) unlinkSync(file)
    rmdirSync(directory)
  })
  const f = fixture(records(2))
  const scan = new CatalogUpdateService(database, f.metadata, {
    localize: async (cards) => {
      const result = await localize(cards)
      result.localizations.forEach((entry) => { entry.ruleTextZh = null })
      return result
    }
  })
  await scan.run(request)
  const initial = database.pendingCards('ocg').items
  assert.equal(initial[0].attempts, 1)
  assert.deepEqual(initial[0].missingFields, ['ruleTextZh'])
  database.close()
  database = new CatalogDatabase(path)
  assert.equal(database.pendingCards('ocg').total, 2)
  assert.equal(database.pendingRecords('ocg', '1999-01')[0].card.nameZh, '中文卡名')
  t.mock.timers.tick(60_000)
  let localizedCalls = 0
  const repair = new CatalogUpdateService(database, {
    fetchReleaseMonth: async () => { throw new Error('Repair must not fetch a full month') }
  }, {
    localize: async (cards) => {
      localizedCalls++
      const result = await localize(cards)
      result.localizations.get(cards[1].passcode)!.ruleTextZh = null
      return result
    }
  })
  const job = new CatalogUpdateJob(repair, () => {})
  job.start({ ...request, mode: 'repair' })
  await job.settled()
  assert.equal(job.snapshot().status, 'completed')
  assert.equal(job.snapshot().fetched, 2)
  assert.equal(job.snapshot().inserted, 1)
  const remaining = database.pendingCards('ocg').items
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].attempts, 2)
  assert.equal(remaining[0].firstSeenAt, initial[1].firstSeenAt)
  assert.notEqual(remaining[0].lastCheckedAt, initial[1].lastCheckedAt)
  t.mock.timers.tick(300_000)
  await flush()
  assert.equal(localizedCalls, 1)
  // The next explicit repair resolves the final gap and restores complete coverage.
  const success = new CatalogUpdateJob(new CatalogUpdateService(database, f.metadata, { localize }), () => {})
  success.start({ ...request, mode: 'repair' })
  await success.settled()
  assert.equal(database.pendingCards('ocg').total, 0)
  assert.equal(database.getCoverage('ocg').completeThrough, '1999-01-31')
  assert.equal(database.getCoverage('ocg').status, 'complete')
})

test('repair respects batch caps and visits each still-missing card only once per invocation', async (t) => {
  fakeClock(t)
  const f = fixture(records(501))
  f.database.savePendingCards(records(501).map((card) => ({ card, releaseMonth: '1999-01', missingFields: ['nameZh'], reason: 'missing' })), 'ocg')
  const calls: number[] = []
  const service = new CatalogUpdateService(f.database, f.metadata, { localize: async (cards) => { calls.push(cards.length); return noLocalization() } })
  const job = new CatalogUpdateJob(service, () => {})
  job.start({ ...request, mode: 'repair' })
  await flush()
  assert.equal(job.snapshot().status, 'cooling')
  assert.equal(job.snapshot().fetched, 500)
  assert.ok(job.snapshot().progress!.percent < 100)
  t.mock.timers.tick(UPDATE_BATCH_COOLDOWN_MS)
  await job.settled()
  assert.equal(job.snapshot().status, 'completed')
  assert.equal(job.snapshot().deferred, 501)
  assert.equal(f.metadataCalls.length, 0)
  assert.deepEqual(calls, [100, 100, 100, 100, 100, 1])
  t.mock.timers.tick(300_000)
  await flush()
  assert.equal(calls.length, 6)
})

test('paused repair resumes its snapshot without retrying already examined unresolved entries', async (t) => {
  fakeClock(t)
  const f = fixture()
  f.database.savePendingCards(records(201).map((card) => ({ card, releaseMonth: '1999-01', missingFields: ['nameZh'], reason: 'missing' })), 'ocg')
  const seen: string[] = []
  const service = new CatalogUpdateService(f.database, f.metadata, { localize: async (cards) => { seen.push(...cards.map((card) => card.passcode)); return noLocalization() } })
  let paused = false
  const job = new CatalogUpdateJob(service, (state) => {
    if (!paused && state.fetched === 100) { paused = true; job.control('pause') }
  })
  job.start({ ...request, mode: 'repair' })
  await job.settled()
  assert.equal(job.snapshot().status, 'paused')
  job.control('resume')
  await flush()
  t.mock.timers.tick(UPDATE_BATCH_COOLDOWN_MS)
  await job.settled()
  assert.equal(job.snapshot().status, 'completed')
  assert.equal(new Set(seen).size, 201)
  assert.equal(seen.length, 201)
})

test('failed persistence never silently advances past an unrecorded gap', async () => {
  const f = fixture(records(1))
  const service = new CatalogUpdateService({ ...f.database,
    savePendingCards: () => { throw new Error('disk full') }
  }, f.metadata, { localize: noLocalization })
  const job = new CatalogUpdateJob(service, () => {})
  job.start(request)
  await job.settled()
  assert.equal(job.snapshot().status, 'blocked')
  assert.match(job.snapshot().message, /disk full/)
  assert.equal(f.database.getCoverage().scannedThrough, null)
  assert.equal(f.database.getCoverage().resumeOffset, 0)
})

test('targeted repair only touches the selected region and cutoff month', async (t) => {
  const database = new CatalogDatabase(':memory:')
  t.after(() => database.close())
  const entries: CatalogPendingRecord[] = records(2).map((card, index) => ({
    card, releaseMonth: index === 0 ? '1999-01' : '1999-02', missingFields: ['nameZh'], reason: 'missing'
  }))
  database.savePendingCards(entries, 'ocg')
  database.savePendingCards([entries[0]], 'tcg')
  const seen: string[] = []
  const f = fixture()
  const service = new CatalogUpdateService(database, f.metadata, { localize: async (cards) => {
    seen.push(...cards.map((card) => card.passcode))
    return localize(cards)
  } })
  const job = new CatalogUpdateJob(service, () => {})
  job.start({ ...request, mode: 'repair' })
  await job.settled()
  assert.deepEqual(seen, [entries[0].card.passcode])
  assert.equal(database.pendingCards('ocg').items[0].releaseMonth, '1999-02')
  assert.equal(database.pendingCards('tcg').total, 1)
  assert.equal(f.metadataCalls.length, 0)
})

test('an empty repair queue finishes without making any source requests', async () => {
  const f = fixture()
  f.job.start({ ...request, mode: 'repair' })
  await f.job.settled()
  assert.equal(f.job.snapshot().status, 'completed')
  assert.equal(f.job.snapshot().progress?.percent, 100)
  assert.equal(f.metadataCalls.length, 0)
  assert.equal(f.chunks.length, 0)
})

test('network failure after a committed chunk retains its cursor and reports a resumable pause', async () => {
  const f = fixture(records(201))
  let count = 0
  const service = new CatalogUpdateService(f.database, f.metadata, {
    localize: async (cards) => { if (++count === 2) throw new Error('HTTP 429'); return localize(cards) }
  })
  const job = new CatalogUpdateJob(service, () => {})
  job.start(request)
  await job.settled()
  assert.equal(job.snapshot().status, 'blocked')
  assert.match(job.snapshot().message, /HTTP 429/)
  assert.equal(job.snapshot().inserted, 100)
  assert.equal(f.database.getCoverage().resumeOffset, 100)
})

test('a source limit without cursor advancement stops instead of looping', async (t) => {
  fakeClock(t)
  const f = fixture([])
  f.database.saveCoverage({ ...f.database.getCoverage(), resumeMonth: '1999-01', status: 'source-limit' })
  const service = new CatalogUpdateService(f.database, {
    fetchReleaseMonth: async (input) => ({ request: input as CatalogUpdateRequest, result: { records: [], complete: false, requestsUsed: 40, skipped: 0 } })
  }, f.chinese)
  const job = new CatalogUpdateJob(service, () => {})
  job.start(request)
  await job.settled()
  assert.equal(job.snapshot().status, 'blocked')
  assert.match(job.snapshot().message, /避免重複請求/)
})

test('already-covered scope completes without network access or percent overflow', async () => {
  const f = fixture()
  f.database.saveCoverage({ ...f.database.getCoverage(), completeThrough: '2000-01-31', scannedThrough: '2000-01-31', status: 'complete' })
  f.job.start(request)
  await f.job.settled()
  assert.equal(f.job.snapshot().status, 'completed')
  assert.equal(f.job.snapshot().progress?.percent, 100)
  assert.equal(f.metadataCalls.length, 0)
})

test('single-month mode stays a single operation and never modifies continuous coverage', async () => {
  const f = fixture(records(600))
  f.job.start({ ...request, mode: 'month' })
  await f.job.settled()
  assert.equal(f.job.snapshot().status, 'completed')
  assert.equal(f.job.snapshot().batchNumber, 1)
  assert.equal(f.imported.size, 500)
  assert.equal(f.database.getCoverage().completeThrough, null)
})

test('metadata source propagates user abort to the active HTTP request', async (t) => {
  let fetched = false
  t.mock.method(globalThis, 'fetch', async (_input: unknown, options: RequestInit) => {
    fetched = true
    await waitForUpdate(10_000, options.signal as AbortSignal)
    return new Response('{}')
  })
  const controller = new AbortController()
  const pending = new YgoprodeckSource().fetchReleaseMonth(request, 40, controller.signal)
  await flush()
  assert.equal(fetched, true)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('localization source aborts its throttle wait without sending another request', async (t) => {
  fakeClock(t)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{}') })
  const source = new YgocdbSource()
  await source.localize(records(1))
  const controller = new AbortController()
  const pending = source.localize(records(1), controller.signal)
  await flush()
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(calls, 1)
})
