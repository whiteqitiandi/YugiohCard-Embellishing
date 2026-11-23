import { DatabaseSync } from 'node:sqlite'
import type {
  CardLanguage,
  CatalogCard,
  CatalogCoverage,
  CatalogStats,
  CatalogUpdateRequest,
  CatalogPendingCard,
  CatalogPendingPage,
  CatalogPopularityBatchResult,
  CoverageStatus,
  ReleaseRegion
} from '../shared/catalog'
import { seedCards } from './seed'
import {
  type CatalogImportRecord,
  YGOPRODECK_SOURCE_NAME
} from './ygoprodeck-source'
import { YGOCDB_SOURCE_NAME } from './ygocdb-source'

type DbRow = Record<string, unknown>

export interface CatalogImportSummary {
  inserted: number
  updated: number
}

export interface CatalogPendingRecord {
  card: CatalogImportRecord
  missingFields: CatalogPendingCard['missingFields']
  reason: string
  releaseMonth: string
}

const asRows = (value: unknown): DbRow[] => value as DbRow[]
const VISIBLE_CARD_PREDICATE = `(
  source_name IS NULL OR (
    localization_status IN ('curated', 'zh-tw-converted', 'english-fallback')
    AND TRIM(name_zh) <> ''
    AND (localization_status = 'english-fallback' OR release_region = 'ocg' OR (
      (ocg_release_date IS NULL OR TRIM(name_ja) <> '')
      AND (tcg_release_date IS NULL OR TRIM(name_en) <> '')
    ))
  )
)`

export class CatalogDatabase {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5_000 })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
    this.migrate()
    this.seed()
    this.db.exec(`
      UPDATE cards
         SET localization_source_name = '內建人工資料', localization_status = 'curated'
       WHERE source_name IS NULL AND localization_status IS NULL;
    `)
  }

  close(): void {
    this.db.close()
  }

  listCards(): CatalogCard[] {
    const cards = asRows(
      this.db
        .prepare(
          `SELECT id, passcode, konami_id, name_zh, name_ja, name_en, kind, frame,
                  attribute, race, type_line, level, rank, link_rating, link_arrows,
                  spell_trap_icon, pendulum_scale_left, pendulum_scale_right, pendulum_text,
                  atk, def, accent, source_name, source_url, localization_source_name,
                  localization_source_url, localization_status, release_region, release_date,
                  ocg_release_date, tcg_release_date, is_unpopular
             FROM cards
            WHERE ${VISIBLE_CARD_PREDICATE}
            ORDER BY sort_order, name_zh`
        )
        .all()
    )

    const effectStatement = this.db.prepare(
      `SELECT t.label
         FROM card_effect_tags c
         JOIN effect_tags t ON t.id = c.tag_id
        WHERE c.card_id = ?
        ORDER BY c.weight DESC, t.label`
    )
    const relationStatement = this.db.prepare(
      'SELECT label FROM card_relations WHERE card_id = ? ORDER BY weight DESC, label'
    )
    const compatibilityStatement = this.db.prepare(
      'SELECT trait_key, label, weight FROM compatibility_traits WHERE card_id = ? ORDER BY weight DESC, label'
    )
    const artworkStatement = this.db.prepare(
      `SELECT id, variant_label, source_url, source_name, shard_key
         FROM artworks WHERE card_id = ? ORDER BY sort_order, id`
    )
    const ruleTextStatement = this.db.prepare(
      `SELECT ruleset, label, text_zh, note
         FROM rule_texts WHERE card_id = ? ORDER BY sort_order, ruleset`
    )

    return cards.map((row) => {
      const cardId = String(row.id)
      const effects = asRows(effectStatement.all(cardId))
      const relations = asRows(relationStatement.all(cardId))
      const compatibility = asRows(compatibilityStatement.all(cardId))
      const artworks = asRows(artworkStatement.all(cardId))
      const ruleTexts = asRows(ruleTextStatement.all(cardId))
      const ocgReleaseDate = row.ocg_release_date == null ? null : String(row.ocg_release_date)
      const tcgReleaseDate = row.tcg_release_date == null ? null : String(row.tcg_release_date)
      const requiredLanguages: CardLanguage[] = row.release_region === 'ocg'
        ? ['zh']
        : ocgReleaseDate || tcgReleaseDate
          ? ['zh', ...(tcgReleaseDate ? ['en' as const] : []), ...(ocgReleaseDate ? ['ja' as const] : [])]
          : ['zh', 'en', 'ja']
      const supportedLanguages: CardLanguage[] = [
        ...(String(row.name_zh).trim() ? ['zh' as const] : []),
        ...(String(row.name_en).trim() ? ['en' as const] : []),
        ...(String(row.name_ja).trim() ? ['ja' as const] : [])
      ]

      return {
        id: cardId,
        passcode: String(row.passcode),
        konamiId: row.konami_id == null ? null : Number(row.konami_id),
        nameZh: String(row.name_zh),
        nameJa: String(row.name_ja),
        nameEn: String(row.name_en),
        kind: row.kind as CatalogCard['kind'],
        frame: row.frame as CatalogCard['frame'],
        attribute: String(row.attribute),
        race: String(row.race),
        typeLine: String(row.type_line),
        level: row.level == null ? null : Number(row.level),
        rank: row.rank == null ? null : Number(row.rank),
        linkRating: row.link_rating == null ? null : Number(row.link_rating),
        linkArrows: JSON.parse(String(row.link_arrows ?? '[]')) as number[],
        spellTrapIcon: row.spell_trap_icon == null
          ? null
          : row.spell_trap_icon as CatalogCard['spellTrapIcon'],
        pendulumScaleLeft: row.pendulum_scale_left == null ? null : Number(row.pendulum_scale_left),
        pendulumScaleRight: row.pendulum_scale_right == null ? null : Number(row.pendulum_scale_right),
        pendulumText: row.pendulum_text == null ? null : String(row.pendulum_text),
        atk: row.atk == null ? null : Number(row.atk),
        def: row.def == null ? null : Number(row.def),
        effectTags: effects.map((item) => String(item.label)),
        relations: relations.map((item) => String(item.label)),
        compatibility: compatibility.map((item) => ({
          key: String(item.trait_key),
          label: String(item.label),
          weight: Number(item.weight)
        })),
        artworks: artworks.map((item) => ({
          id: String(item.id),
          variantLabel: String(item.variant_label),
          sourceUrl: item.source_url == null ? null : String(item.source_url),
          sourceName: String(item.source_name),
          shardKey: String(item.shard_key)
        })),
        ruleTexts: ruleTexts.map((item) => ({
          ruleset: item.ruleset as CatalogCard['ruleTexts'][number]['ruleset'],
          label: String(item.label),
          textZh: String(item.text_zh),
          note: item.note == null ? null : String(item.note)
        })),
        accent: String(row.accent),
        sourceName: row.source_name == null ? null : String(row.source_name),
        sourceUrl: row.source_url == null ? null : String(row.source_url),
        localizationSourceName: row.localization_source_name == null ? null : String(row.localization_source_name),
        localizationSourceUrl: row.localization_source_url == null ? null : String(row.localization_source_url),
        localizationStatus: row.localization_status === 'curated' || row.localization_status === 'zh-tw-converted' || row.localization_status === 'english-fallback'
          ? row.localization_status
          : null,
        releaseRegion: row.release_region === 'ocg' || row.release_region === 'tcg'
          ? row.release_region
          : null,
        releaseDate: row.release_date == null ? null : String(row.release_date),
        ocgReleaseDate,
        tcgReleaseDate,
        requiredLanguages,
        supportedLanguages,
        isUnpopular: Number(row.is_unpopular ?? 0) === 1
      }
    })
  }

  stats(): CatalogStats {
    const cards = this.db.prepare(`SELECT COUNT(*) AS total FROM cards WHERE ${VISIBLE_CARD_PREDICATE}`).get() as DbRow
    const artworks = this.db.prepare(
      `SELECT COUNT(*) AS total FROM artworks WHERE card_id IN (SELECT id FROM cards WHERE ${VISIBLE_CARD_PREDICATE})`
    ).get() as DbRow
    const ruleVariants = this.db.prepare(
      `SELECT COUNT(*) AS total FROM rule_texts WHERE card_id IN (SELECT id FROM cards WHERE ${VISIBLE_CARD_PREDICATE})`
    ).get() as DbRow
    const seededAt = this.db.prepare("SELECT value FROM app_meta WHERE key = 'last_seeded_at'").get() as DbRow
    const importedCards = this.db.prepare("SELECT COUNT(*) AS total FROM cards WHERE localization_status = 'zh-tw-converted'").get() as DbRow
    const lastUpdatedAt = this.db.prepare("SELECT value FROM app_meta WHERE key = 'last_card_update_at'").get() as DbRow | undefined
    const lastUpdateLabel = this.db.prepare("SELECT value FROM app_meta WHERE key = 'last_card_update_label'").get() as DbRow | undefined
    return {
      cards: Number(cards.total),
      artworks: Number(artworks.total),
      ruleVariants: Number(ruleVariants.total),
      lastSeededAt: String(seededAt.value),
      importedCards: Number(importedCards.total),
      lastUpdatedAt: lastUpdatedAt == null ? null : String(lastUpdatedAt.value),
      lastUpdateLabel: lastUpdateLabel == null ? null : String(lastUpdateLabel.value),
      coverage: [this.getCoverage('ocg'), this.getCoverage('tcg')]
    }
  }

  getCoverage(region: ReleaseRegion): CatalogCoverage {
    const read = (suffix: string): string | null => {
      const row = this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(`coverage_${region}_${suffix}`) as DbRow | undefined
      return row == null ? null : String(row.value)
    }
    const rawStatus = read('status')
    let status: CoverageStatus = rawStatus === 'complete' || rawStatus === 'complete-with-gaps' || rawStatus === 'source-limit' || rawStatus === 'waiting-language'
      ? rawStatus
      : rawStatus === 'waiting-chinese' ? 'waiting-language' : 'not-started'
    // Before this field existed, the old continuous completion date was also the scan cursor.
    const savedScan = read('scanned_through')
    const scannedThrough = savedScan == null ? read('complete_through') : savedScan || null
    const verifiedThrough = read('complete_through')
    let completeThrough = [scannedThrough, verifiedThrough].filter((value): value is string => value != null).sort().at(-1) ?? null
    const pending = this.db.prepare(`SELECT COUNT(*) AS total, MIN(COALESCE(release_date, release_month || '-01')) AS first_date,
      MIN(release_month) AS first_month FROM catalog_pending_cards WHERE region = ?`).get(region) as DbRow
    if (completeThrough && pending.first_date && String(pending.first_date) <= completeThrough) {
      const previousDay = new Date(`${String(pending.first_date)}T00:00:00Z`)
      previousDay.setUTCDate(previousDay.getUTCDate() - 1)
      const date = previousDay.toISOString().slice(0, 10)
      completeThrough = date < (region === 'ocg' ? '1999-01-01' : '2002-01-01') ? null : date
    }
    const targetMonth = read('target_month')
    if (status === 'complete' || status === 'complete-with-gaps') {
      status = pending.first_month && (!targetMonth || String(pending.first_month) <= targetMonth) ? 'complete-with-gaps' : 'complete'
    }
    return {
      region,
      completeThrough,
      scannedThrough,
      pendingCards: Number(pending.total),
      resumeMonth: read('resume_month'),
      resumeOffset: Number(read('resume_offset') ?? 0),
      targetMonth,
      status,
      note: read('note')
    }
  }

  saveCoverage(coverage: CatalogCoverage): void {
    const upsert = this.db.prepare(
      'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    const remove = this.db.prepare('DELETE FROM app_meta WHERE key = ?')
    const write = (suffix: string, value: string | number | null): void => {
      const key = `coverage_${coverage.region}_${suffix}`
      if (value == null || value === '') remove.run(key)
      else upsert.run(key, String(value))
    }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      write('complete_through', coverage.completeThrough)
      upsert.run(`coverage_${coverage.region}_scanned_through`, coverage.scannedThrough ?? '')
      write('resume_month', coverage.resumeMonth)
      write('resume_offset', coverage.resumeOffset)
      write('target_month', coverage.targetMonth)
      write('status', coverage.status)
      write('note', coverage.note)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  savePendingCards(records: CatalogPendingRecord[], region: ReleaseRegion): void {
    if (records.length === 0) return
    const upsert = this.db.prepare(`INSERT INTO catalog_pending_cards
      (region, passcode, name, release_month, release_date, missing_fields, reason, source_url, payload, attempts, first_seen_at, last_checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(region, passcode) DO UPDATE SET name = excluded.name, release_month = excluded.release_month,
        release_date = excluded.release_date, missing_fields = excluded.missing_fields, reason = excluded.reason,
        source_url = excluded.source_url, payload = excluded.payload, attempts = attempts + 1, last_checked_at = excluded.last_checked_at`)
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const entry of records) {
        const card = entry.card
        const parsedDate = card.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(card.releaseDate)
          ? new Date(`${card.releaseDate}T00:00:00Z`) : null
        const releaseDate = parsedDate && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === card.releaseDate
          ? card.releaseDate : null
        upsert.run(region, card.passcode, card.nameZh || card.name || card.nameJa || card.passcode,
          entry.releaseMonth, releaseDate, JSON.stringify(entry.missingFields), entry.reason,
          card.localizationSourceUrl || card.sourceUrl, JSON.stringify(card), now, now)
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  resolvePendingCards(passcodes: string[], region: ReleaseRegion): void {
    if (passcodes.length === 0) return
    const remove = this.db.prepare('DELETE FROM catalog_pending_cards WHERE region = ? AND passcode = ?')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const passcode of passcodes) remove.run(region, passcode)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  pendingCards(region: ReleaseRegion, page: number = 0): CatalogPendingPage {
    const total = this.db.prepare('SELECT COUNT(*) AS total FROM catalog_pending_cards WHERE region = ?').get(region) as DbRow
    const rows = asRows(this.db.prepare(`SELECT * FROM catalog_pending_cards WHERE region = ?
      ORDER BY release_month, passcode LIMIT 50 OFFSET ?`).all(region, page * 50))
    return { total: Number(total.total), items: rows.map((row) => ({
      region, passcode: String(row.passcode), name: String(row.name), releaseMonth: String(row.release_month),
      releaseDate: row.release_date == null ? null : String(row.release_date),
      missingFields: JSON.parse(String(row.missing_fields)) as CatalogPendingCard['missingFields'],
      reason: String(row.reason), sourceUrl: String(row.source_url), attempts: Number(row.attempts),
      firstSeenAt: String(row.first_seen_at), lastCheckedAt: String(row.last_checked_at)
    })) }
  }

  pendingRecords(region: ReleaseRegion, throughMonth: string): CatalogPendingRecord[] {
    return asRows(this.db.prepare(`SELECT payload, release_month, missing_fields, reason FROM catalog_pending_cards
      WHERE region = ? AND release_month <= ? ORDER BY release_month, passcode`).all(region, throughMonth)).map((row) => ({
      card: JSON.parse(String(row.payload)) as CatalogImportRecord, releaseMonth: String(row.release_month),
      missingFields: JSON.parse(String(row.missing_fields)) as CatalogPendingCard['missingFields'], reason: String(row.reason)
    }))
  }

  setUnpopular(cardId: string, isUnpopular: boolean): boolean {
    const result = this.db.prepare('UPDATE cards SET is_unpopular = ? WHERE id = ?').run(isUnpopular ? 1 : 0, cardId)
    return Number(result.changes) > 0
  }

  setUnpopularBatch(cardIds: string[], isUnpopular: boolean): CatalogPopularityBatchResult {
    const result: CatalogPopularityBatchResult = { savedIds: [], failures: [] }
    const update = this.db.prepare('UPDATE cards SET is_unpopular = ? WHERE id = ?')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const id of new Set(cardIds)) {
        const changed = update.run(isUnpopular ? 1 : 0, id)
        if (Number(changed.changes) > 0) result.savedIds.push(id)
        else result.failures.push({ id, message: '找不到這張卡片。' })
      }
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getMetaValue(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as DbRow | undefined
    return row == null ? null : String(row.value)
  }

  setMetaValue(key: string, value: string): void {
    this.db.prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value)
  }

  recordsNeedingLocalization(records: CatalogImportRecord[]): CatalogImportRecord[] {
    const find = this.db.prepare('SELECT source_name, localization_status FROM cards WHERE passcode = ?')
    return records.filter((card) => {
      const row = find.get(card.passcode) as DbRow | undefined
      return row == null || row.source_name == null || row.localization_status === 'english-fallback'
    })
  }

  passcodesNeedingSourceRefresh(): string[] {
    return asRows(this.db.prepare(`SELECT passcode FROM cards
      WHERE source_name IS NULL OR TRIM(source_name) = '' ORDER BY passcode`).all())
      .map((row) => String(row.passcode))
  }

  catalogPasscodes(): string[] {
    return asRows(this.db.prepare('SELECT passcode FROM cards ORDER BY passcode').all())
      .map((row) => String(row.passcode))
  }

  refreshSourceRecords(records: CatalogImportRecord[], request: CatalogUpdateRequest): number {
    const findExisting = this.db.prepare('SELECT id FROM cards WHERE passcode = ?')
    const update = this.db.prepare(
      `UPDATE cards
          SET konami_id = COALESCE(?, konami_id), name_en = COALESCE(NULLIF(name_en, ''), ?),
              kind = ?, frame = ?, attribute = ?, race = ?, type_line = ?, level = ?, rank = ?,
              link_rating = ?, link_arrows = ?, spell_trap_icon = ?, pendulum_scale_left = ?,
              pendulum_scale_right = ?, pendulum_text = COALESCE(pendulum_text, ?), atk = ?, def = ?,
              accent = ?, source_name = ?, source_url = ?, release_region = ?, release_date = ?,
              ocg_release_date = COALESCE(?, ocg_release_date), tcg_release_date = COALESCE(?, tcg_release_date),
              imported_at = ?
        WHERE id = ?`
    )
    const deleteArtworks = this.db.prepare('DELETE FROM artworks WHERE card_id = ?')
    const insertArtwork = this.db.prepare(
      `INSERT INTO artworks (id, card_id, variant_label, source_url, source_name, shard_key, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const upsertArchetype = this.db.prepare(
      `INSERT INTO card_relations (card_id, relation_key, label, weight)
       VALUES (?, 'ygoprodeck-archetype', ?, 0.8)
       ON CONFLICT(card_id, relation_key) DO UPDATE SET label = excluded.label, weight = excluded.weight`
    )
    const completedAt = new Date().toISOString()
    let updated = 0
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const card of records) {
        const existing = findExisting.get(card.passcode) as DbRow | undefined
        if (!existing) continue
        const cardId = String(existing.id)
        update.run(
          card.konamiId, card.name, card.kind, card.frame, card.attribute, card.race, card.typeLine,
          card.level, card.rank, card.linkRating, JSON.stringify(card.linkArrows), card.spellTrapIcon,
          card.pendulumScaleLeft, card.pendulumScaleRight, card.pendulumText, card.atk, card.def,
          card.accent, YGOPRODECK_SOURCE_NAME, card.sourceUrl, request.region, card.releaseDate,
          card.ocgReleaseDate, card.tcgReleaseDate, completedAt, cardId
        )
        if (card.artworks.length > 0) {
          deleteArtworks.run(cardId)
          const seenUrls = new Set<string>()
          card.artworks.forEach((artwork, index) => {
            if (seenUrls.has(artwork.sourceUrl)) return
            seenUrls.add(artwork.sourceUrl)
            insertArtwork.run(
              artwork.id, cardId, artwork.variantLabel, artwork.sourceUrl,
              artwork.sourceName ?? YGOPRODECK_SOURCE_NAME, artwork.shardKey, index
            )
          })
        }
        if (card.archetype) upsertArchetype.run(cardId, card.archetype)
        updated += 1
      }
      this.db.exec('COMMIT')
      return updated
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  importSourceMonth(
    records: CatalogImportRecord[],
    request: CatalogUpdateRequest
  ): CatalogImportSummary {
    if (records.some((card) => card.localizationStatus !== 'english-fallback' && (
      !card.nameZh || !card.ruleTextZh || !card.localizationSourceName ||
      (request.region !== 'ocg' && (
        (card.ocgReleaseDate != null && !card.nameJa) ||
        (card.tcgReleaseDate != null && !card.nameEn)
      ))
    ))) {
      throw new Error('匯入批次含有未符合發行區域語系規則的卡片，已拒絕寫入。')
    }
    const findExisting = this.db.prepare('SELECT id FROM cards WHERE passcode = ?')
    const insertCard = this.db.prepare(
      `INSERT INTO cards
        (id, passcode, konami_id, name_zh, name_ja, name_en, kind, frame, attribute, race,
         type_line, level, rank, link_rating, link_arrows, spell_trap_icon,
         pendulum_scale_left, pendulum_scale_right, pendulum_text, atk, def, accent, sort_order,
         source_name, source_url, localization_source_name, localization_source_url,
         localization_status, release_region, release_date, ocg_release_date,
         tcg_release_date, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const updateManagedCard = this.db.prepare(
      `UPDATE cards
          SET konami_id = COALESCE(?, konami_id), name_zh = ?,
              name_ja = COALESCE(NULLIF(?, ''), name_ja), name_en = COALESCE(NULLIF(?, ''), name_en),
              kind = ?, frame = ?, attribute = ?, race = ?, type_line = ?, level = ?, rank = ?,
              link_rating = ?, link_arrows = ?, spell_trap_icon = ?, pendulum_scale_left = ?,
              pendulum_scale_right = ?, pendulum_text = ?, atk = ?, def = ?, accent = ?,
              source_name = ?, source_url = ?, localization_source_name = ?,
              localization_source_url = ?, localization_status = ?,
              release_region = ?, release_date = ?, ocg_release_date = ?,
              tcg_release_date = ?, imported_at = ?
        WHERE id = ?`
    )
    const updateCuratedCard = this.db.prepare(
      `UPDATE cards
          SET konami_id = COALESCE(?, konami_id), name_en = ?, kind = ?, frame = ?,
              attribute = ?, race = ?, type_line = ?, level = ?, rank = ?, link_rating = ?,
              link_arrows = ?, spell_trap_icon = ?, pendulum_scale_left = ?,
              pendulum_scale_right = ?, pendulum_text = COALESCE(pendulum_text, ?),
              atk = ?, def = ?, accent = ?, source_name = ?, source_url = ?,
              release_region = ?, release_date = ?, ocg_release_date = ?,
              tcg_release_date = ?, imported_at = ?
        WHERE id = ?`
    )
    const deleteArtworks = this.db.prepare('DELETE FROM artworks WHERE card_id = ?')
    const upsertArtwork = this.db.prepare(
      `INSERT INTO artworks (id, card_id, variant_label, source_url, source_name, shard_key, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET
         variant_label = excluded.variant_label,
         source_url = excluded.source_url,
         source_name = excluded.source_name,
         shard_key = excluded.shard_key,
         sort_order = excluded.sort_order`
    )
    const upsertRuleText = this.db.prepare(
      `INSERT INTO rule_texts (card_id, ruleset, label, text_zh, note, sort_order)
       VALUES (?, 'ocg-master', ?, ?, ?, 0)
       ON CONFLICT(card_id, ruleset) DO UPDATE SET
         label = excluded.label, text_zh = excluded.text_zh, note = excluded.note`
    )
    const upsertArchetype = this.db.prepare(
      `INSERT INTO card_relations (card_id, relation_key, label, weight)
       VALUES (?, 'ygoprodeck-archetype', ?, 0.8)
       ON CONFLICT(card_id, relation_key) DO UPDATE SET label = excluded.label, weight = excluded.weight`
    )
    const upsertMeta = this.db.prepare(
      'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )

    let inserted = 0
    let updated = 0
    const completedAt = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      records.forEach((card) => {
        const fallback = card.localizationStatus === 'english-fallback'
        const localizationStatus = fallback ? 'english-fallback' : 'zh-tw-converted'
        const localizationSourceName = card.localizationSourceName ?? (fallback ? YGOPRODECK_SOURCE_NAME : YGOCDB_SOURCE_NAME)
        const existing = findExisting.get(card.passcode) as DbRow | undefined
        const cardId = existing == null ? card.id : String(existing.id)
        if (existing == null) {
          insertCard.run(
            cardId,
            card.passcode,
            card.konamiId,
            card.nameZh ?? card.name,
            card.nameJa ?? '',
            card.nameEn ?? card.name,
            card.kind,
            card.frame,
            card.attribute,
            card.race,
            card.typeLine,
            card.level,
            card.rank,
            card.linkRating,
            JSON.stringify(card.linkArrows),
            card.spellTrapIcon,
            card.pendulumScaleLeft,
            card.pendulumScaleRight,
            card.pendulumTextZh ?? card.pendulumText,
            card.atk,
            card.def,
            card.accent,
            100_000 + card.remoteId,
            YGOPRODECK_SOURCE_NAME,
            card.sourceUrl,
            localizationSourceName,
            card.localizationSourceUrl ?? null,
            localizationStatus,
            request.region,
            card.releaseDate,
            card.ocgReleaseDate,
            card.tcgReleaseDate,
            completedAt
          )
          inserted += 1
        } else if (cardId.startsWith('ygoprodeck-')) {
          updateManagedCard.run(
            card.konamiId,
            card.nameZh ?? card.name,
            card.nameJa ?? '',
            card.nameEn ?? card.name,
            card.kind,
            card.frame,
            card.attribute,
            card.race,
            card.typeLine,
            card.level,
            card.rank,
            card.linkRating,
            JSON.stringify(card.linkArrows),
            card.spellTrapIcon,
            card.pendulumScaleLeft,
            card.pendulumScaleRight,
            card.pendulumTextZh ?? card.pendulumText,
            card.atk,
            card.def,
            card.accent,
            YGOPRODECK_SOURCE_NAME,
            card.sourceUrl,
            localizationSourceName,
            card.localizationSourceUrl ?? null,
            localizationStatus,
            request.region,
            card.releaseDate,
            card.ocgReleaseDate,
            card.tcgReleaseDate,
            completedAt,
            cardId
          )
          updated += 1
        } else {
          updateCuratedCard.run(
            card.konamiId,
            card.nameEn ?? card.name,
            card.kind,
            card.frame,
            card.attribute,
            card.race,
            card.typeLine,
            card.level,
            card.rank,
            card.linkRating,
            JSON.stringify(card.linkArrows),
            card.spellTrapIcon,
            card.pendulumScaleLeft,
            card.pendulumScaleRight,
            card.pendulumTextZh ?? card.pendulumText,
            card.atk,
            card.def,
            card.accent,
            YGOPRODECK_SOURCE_NAME,
            card.sourceUrl,
            request.region,
            card.releaseDate,
            card.ocgReleaseDate,
            card.tcgReleaseDate,
            completedAt,
            cardId
          )
          updated += 1
        }

        if (card.artworks.length > 0) deleteArtworks.run(cardId)
        const seenArtworkUrls = new Set<string>()
        card.artworks.forEach((artwork, index) => {
          if (seenArtworkUrls.has(artwork.sourceUrl)) return
          seenArtworkUrls.add(artwork.sourceUrl)
          upsertArtwork.run(
            artwork.id,
            cardId,
            artwork.variantLabel,
            artwork.sourceUrl,
            artwork.sourceName ?? YGOPRODECK_SOURCE_NAME,
            artwork.shardKey,
            100 + index
          )
        })
        if (cardId.startsWith('ygoprodeck-')) upsertRuleText.run(
          cardId,
          fallback ? '英文來源暫代' : '中文來源／台灣正體',
          card.ruleTextZh ?? card.ruleText,
          fallback
            ? '中文資料尚待補齊，目前顯示 YGOPRODeck 英文卡片文字。'
            : '中文原文由百鴿 API 提供，並以 OpenCC 轉為台灣正體；非官方繁中校訂。'
        )
        if (card.archetype) upsertArchetype.run(cardId, card.archetype)
      })

      const label = `${request.region.toUpperCase()} ${request.year}-${String(request.month).padStart(2, '0')}`
      upsertMeta.run('last_card_update_at', completedAt)
      upsertMeta.run('last_card_update_label', label)
      upsertMeta.run('last_card_update_source', YGOPRODECK_SOURCE_NAME)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    return { inserted, updated }
  }

  getArtwork(artworkId: string): { id: string; sourceUrl: string | null; shardKey: string } | null {
    const row = this.db
      .prepare('SELECT id, source_url, shard_key FROM artworks WHERE id = ?')
      .get(artworkId) as DbRow | undefined
    if (!row) return null
    return {
      id: String(row.id),
      sourceUrl: row.source_url == null ? null : String(row.source_url),
      shardKey: String(row.shard_key)
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS catalog_pending_cards (
        region TEXT NOT NULL CHECK (region IN ('ocg', 'tcg')),
        passcode TEXT NOT NULL,
        name TEXT NOT NULL,
        release_month TEXT NOT NULL,
        release_date TEXT,
        missing_fields TEXT NOT NULL,
        reason TEXT NOT NULL,
        source_url TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 1,
        first_seen_at TEXT NOT NULL,
        last_checked_at TEXT NOT NULL,
        PRIMARY KEY (region, passcode)
      );
      CREATE INDEX IF NOT EXISTS pending_cards_month_idx ON catalog_pending_cards(region, release_month);

      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY,
        passcode TEXT NOT NULL UNIQUE,
        konami_id INTEGER,
        name_zh TEXT NOT NULL,
        name_ja TEXT NOT NULL,
        name_en TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('monster', 'spell', 'trap')),
        frame TEXT NOT NULL,
        attribute TEXT NOT NULL,
        race TEXT NOT NULL,
        type_line TEXT NOT NULL,
        level INTEGER,
        rank INTEGER,
        link_rating INTEGER,
        link_arrows TEXT NOT NULL DEFAULT '[]',
        spell_trap_icon TEXT,
        pendulum_scale_left INTEGER,
        pendulum_scale_right INTEGER,
        pendulum_text TEXT,
        atk INTEGER,
        def INTEGER,
        accent TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        source_name TEXT,
        source_url TEXT,
        localization_source_name TEXT,
        localization_source_url TEXT,
        localization_status TEXT,
        release_region TEXT,
        release_date TEXT,
        ocg_release_date TEXT,
        tcg_release_date TEXT,
        is_unpopular INTEGER NOT NULL DEFAULT 0 CHECK (is_unpopular IN (0, 1)),
        imported_at TEXT
      );

      CREATE TABLE IF NOT EXISTS rule_texts (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        ruleset TEXT NOT NULL,
        label TEXT NOT NULL,
        text_zh TEXT NOT NULL,
        note TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (card_id, ruleset)
      );

      CREATE TABLE IF NOT EXISTS artworks (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        variant_label TEXT NOT NULL,
        source_url TEXT,
        source_name TEXT NOT NULL,
        shard_key TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      DELETE FROM artworks
       WHERE source_url IS NOT NULL
         AND rowid NOT IN (
           SELECT MIN(rowid) FROM artworks WHERE source_url IS NOT NULL GROUP BY card_id, source_url
         );
      UPDATE artworks
         SET source_name = 'YGOResources 卡圖索引'
       WHERE source_name = 'YGOResources 官方卡圖索引';
      CREATE INDEX IF NOT EXISTS artworks_card_idx ON artworks(card_id, sort_order);
      CREATE INDEX IF NOT EXISTS artworks_shard_idx ON artworks(shard_key);
      CREATE UNIQUE INDEX IF NOT EXISTS artworks_card_url_idx ON artworks(card_id, source_url) WHERE source_url IS NOT NULL;

      CREATE TABLE IF NOT EXISTS effect_tags (
        id INTEGER PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS card_effect_tags (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES effect_tags(id) ON DELETE CASCADE,
        weight REAL NOT NULL DEFAULT 1,
        PRIMARY KEY (card_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS card_relations (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        relation_key TEXT NOT NULL,
        label TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1,
        PRIMARY KEY (card_id, relation_key)
      );

      CREATE TABLE IF NOT EXISTS compatibility_traits (
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        trait_key TEXT NOT NULL,
        label TEXT NOT NULL,
        weight REAL NOT NULL,
        PRIMARY KEY (card_id, trait_key)
      );
    `)

    const columns = new Set(
      asRows(this.db.prepare('PRAGMA table_info(cards)').all()).map((row) => String(row.name))
    )
    const additions: Record<string, string> = {
      rank: 'INTEGER',
      link_rating: 'INTEGER',
      link_arrows: "TEXT NOT NULL DEFAULT '[]'",
      spell_trap_icon: 'TEXT',
      pendulum_scale_left: 'INTEGER',
      pendulum_scale_right: 'INTEGER',
      pendulum_text: 'TEXT',
      source_name: 'TEXT',
      source_url: 'TEXT',
      localization_source_name: 'TEXT',
      localization_source_url: 'TEXT',
      localization_status: 'TEXT',
      release_region: 'TEXT',
      release_date: 'TEXT',
      ocg_release_date: 'TEXT',
      tcg_release_date: 'TEXT',
      is_unpopular: 'INTEGER NOT NULL DEFAULT 0',
      imported_at: 'TEXT'
    }
    Object.entries(additions).forEach(([column, definition]) => {
      if (!columns.has(column)) this.db.exec(`ALTER TABLE cards ADD COLUMN ${column} ${definition}`)
    })
    this.db.exec(`
      UPDATE cards
         SET ocg_release_date = release_date
       WHERE ocg_release_date IS NULL AND release_region = 'ocg' AND release_date IS NOT NULL;
      UPDATE cards
         SET tcg_release_date = release_date
       WHERE tcg_release_date IS NULL AND release_region = 'tcg' AND release_date IS NOT NULL;
    `)
  }

  private seed(): void {
    const seedVersion = '4'
    const currentVersion = this.db
      .prepare("SELECT value FROM app_meta WHERE key = 'seed_version'")
      .get() as DbRow | undefined
    if (currentVersion?.value === seedVersion) return

    const insertCard = this.db.prepare(
      `INSERT OR REPLACE INTO cards
        (id, passcode, konami_id, name_zh, name_ja, name_en, kind, frame, attribute, race,
         type_line, level, rank, link_rating, link_arrows, spell_trap_icon,
         pendulum_scale_left, pendulum_scale_right, pendulum_text, atk, def, accent, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertArtwork = this.db.prepare(
      `INSERT INTO artworks (id, card_id, variant_label, source_url, source_name, shard_key, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const insertRuleText = this.db.prepare(
      `INSERT INTO rule_texts (card_id, ruleset, label, text_zh, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    const insertEffectTag = this.db.prepare(
      'INSERT INTO effect_tags (slug, label) VALUES (?, ?) ON CONFLICT(label) DO NOTHING'
    )
    const findEffectTag = this.db.prepare('SELECT id FROM effect_tags WHERE label = ?')
    const insertCardEffect = this.db.prepare(
      'INSERT INTO card_effect_tags (card_id, tag_id, weight) VALUES (?, ?, ?)'
    )
    const insertRelation = this.db.prepare(
      'INSERT INTO card_relations (card_id, relation_key, label, weight) VALUES (?, ?, ?, ?)'
    )
    const insertCompatibility = this.db.prepare(
      'INSERT INTO compatibility_traits (card_id, trait_key, label, weight) VALUES (?, ?, ?, ?)'
    )

    this.db.exec('BEGIN IMMEDIATE')
    try {
      seedCards.forEach((card, cardIndex) => {
        insertCard.run(
          card.id,
          card.passcode,
          card.konamiId,
          card.nameZh,
          card.nameJa,
          card.nameEn,
          card.kind,
          card.frame,
          card.attribute,
          card.race,
          card.typeLine,
          card.level,
          card.rank,
          card.linkRating,
          JSON.stringify(card.linkArrows),
          card.spellTrapIcon,
          card.pendulumScaleLeft,
          card.pendulumScaleRight,
          card.pendulumText,
          card.atk,
          card.def,
          card.accent,
          cardIndex
        )

        card.artworks.forEach((artwork, index) => {
          insertArtwork.run(
            artwork.id,
            card.id,
            artwork.variantLabel,
            artwork.sourceUrl,
            artwork.sourceName,
            artwork.shardKey,
            index
          )
        })

        card.ruleTexts.forEach((variant, index) => {
          insertRuleText.run(
            card.id,
            variant.ruleset,
            variant.label,
            variant.textZh,
            variant.note,
            index
          )
        })

        card.effectTags.forEach((label, index) => {
          const slug = `effect-${Buffer.from(label).toString('hex')}`
          insertEffectTag.run(slug, label)
          const tag = findEffectTag.get(label) as DbRow
          insertCardEffect.run(card.id, Number(tag.id), 1 - index * 0.02)
        })

        card.relations.forEach((label, index) => {
          const relationKey = `relation-${Buffer.from(label).toString('hex')}`
          insertRelation.run(card.id, relationKey, label, 1 - index * 0.05)
        })

        card.compatibility.forEach((trait) => {
          insertCompatibility.run(card.id, trait.key, trait.label, trait.weight)
        })
      })

      this.db.prepare(
        "INSERT INTO app_meta (key, value) VALUES ('last_seeded_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(new Date().toISOString())
      this.db.prepare(
        "INSERT INTO app_meta (key, value) VALUES ('seed_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(seedVersion)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
