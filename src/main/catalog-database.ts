import { DatabaseSync } from 'node:sqlite'
import type { CatalogCard, CatalogStats } from '../shared/catalog'
import { seedCards } from './seed'

type DbRow = Record<string, unknown>

const asRows = (value: unknown): DbRow[] => value as DbRow[]

export class CatalogDatabase {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5_000 })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
    this.migrate()
    this.seed()
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
                  atk, def, accent
             FROM cards
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
        accent: String(row.accent)
      }
    })
  }

  stats(): CatalogStats {
    const cards = this.db.prepare('SELECT COUNT(*) AS total FROM cards').get() as DbRow
    const artworks = this.db.prepare('SELECT COUNT(*) AS total FROM artworks').get() as DbRow
    const ruleVariants = this.db.prepare('SELECT COUNT(*) AS total FROM rule_texts').get() as DbRow
    const seededAt = this.db.prepare("SELECT value FROM app_meta WHERE key = 'last_seeded_at'").get() as DbRow
    return {
      cards: Number(cards.total),
      artworks: Number(artworks.total),
      ruleVariants: Number(ruleVariants.total),
      lastSeededAt: String(seededAt.value)
    }
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
        sort_order INTEGER NOT NULL DEFAULT 0
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
      CREATE INDEX IF NOT EXISTS artworks_card_idx ON artworks(card_id, sort_order);
      CREATE INDEX IF NOT EXISTS artworks_shard_idx ON artworks(shard_key);

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
      pendulum_text: 'TEXT'
    }
    Object.entries(additions).forEach(([column, definition]) => {
      if (!columns.has(column)) this.db.exec(`ALTER TABLE cards ADD COLUMN ${column} ${definition}`)
    })
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
