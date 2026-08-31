import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

type DbRow = Record<string, unknown>

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

export class ArtworkStore {
  private readonly mediaDirectory: string
  private readonly databases = new Map<string, DatabaseSync>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(userDataPath: string) {
    this.mediaDirectory = join(userDataPath, 'media-shards')
  }

  async initialize(): Promise<void> {
    await mkdir(this.mediaDirectory, { recursive: true })
  }

  close(): void {
    this.databases.forEach((database) => database.close())
    this.databases.clear()
  }

  async resolve(
    artwork: { id: string; sourceUrl: string | null; shardKey: string } | null
  ): Promise<string | null> {
    if (!artwork?.sourceUrl) return null
    const database = this.getDatabase(artwork.shardKey)
    const cached = database
      .prepare('SELECT mime, bytes FROM media_assets WHERE artwork_id = ?')
      .get(artwork.id) as DbRow | undefined

    if (cached) return this.toDataUrl(String(cached.mime), cached.bytes)

    const task = this.queue.then(async () => {
      const rechecked = database
        .prepare('SELECT mime, bytes FROM media_assets WHERE artwork_id = ?')
        .get(artwork.id) as DbRow | undefined
      if (rechecked) return this.toDataUrl(String(rechecked.mime), rechecked.bytes)
      const result = await this.download(artwork.sourceUrl as string)
      if (!result) return null
      database
        .prepare(
          `INSERT OR REPLACE INTO media_assets
            (artwork_id, source_url, mime, sha256, bytes, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          artwork.id,
          artwork.sourceUrl,
          result.mime,
          createHash('sha256').update(result.bytes).digest('hex'),
          result.bytes,
          new Date().toISOString()
        )
      return this.toDataUrl(result.mime, result.bytes)
    })

    this.queue = task.finally(() => wait(750))
    return task
  }

  private getDatabase(shardKey: string): DatabaseSync {
    const safeKey = shardKey.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
    const existing = this.databases.get(safeKey)
    if (existing) return existing
    const database = new DatabaseSync(join(this.mediaDirectory, `media-${safeKey}.sqlite`), {
      timeout: 5_000
    })
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS media_assets (
        artwork_id TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        mime TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes BLOB NOT NULL,
        fetched_at TEXT NOT NULL
      );
    `)
    this.databases.set(safeKey, database)
    return database
  }

  private async download(urlText: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
    const url = new URL(urlText)
    if (url.protocol !== 'https:' || url.hostname !== 'images.ygoprodeck.com') return null

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'ArcanaArchive/0.1 personal-local-prototype (single-fetch image cache)'
        },
        signal: controller.signal
      })
      if (!response.ok) return null
      const length = Number(response.headers.get('content-length') ?? 0)
      if (length > 8 * 1024 * 1024) return null
      const mime = response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg'
      if (!mime.startsWith('image/')) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > 8 * 1024 * 1024) return null
      return { mime, bytes }
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }

  private toDataUrl(mime: string, value: unknown): string {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer)
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
  }
}

