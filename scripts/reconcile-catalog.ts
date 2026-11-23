import { resolve } from 'node:path'
import { CatalogDatabase } from '../src/main/catalog-database'
import { CatalogUpdateService } from '../src/main/catalog-update-service'
import { YgocdbSource } from '../src/main/ygocdb-source'
import { YgoprodeckSource } from '../src/main/ygoprodeck-source'
import { YgoresourcesSource } from '../src/main/ygoresources-source'

const main = async (): Promise<void> => {
  const databaseArgument = process.argv.find((argument) => argument.startsWith('--database='))
  const databasePath = resolve(databaseArgument?.slice('--database='.length) || 'data/catalog.sqlite')
  const now = new Date()
  const database = new CatalogDatabase(databasePath)
  const metadataSource = new YgoprodeckSource()
  const chineseSource = new YgocdbSource()
  const artworkSource = new YgoresourcesSource()
  const service = new CatalogUpdateService(database, metadataSource, chineseSource, artworkSource)
  const regionsArgument = process.argv.find((argument) => argument.startsWith('--regions='))
  const requestedRegions = regionsArgument?.slice('--regions='.length).split(',') ?? ['ocg', 'tcg']
  const regions = requestedRegions.filter((region): region is 'ocg' | 'tcg' => region === 'ocg' || region === 'tcg')
  if (regions.length === 0) throw new Error('請以 --regions=ocg、--regions=tcg 或 --regions=ocg,tcg 指定區域。')

  try {
    for (const region of regions) {
      console.log(`[catalog-reconcile] ${region.toUpperCase()} inventory audit started`)
      const result = await service.reconcileInventory({
        mode: 'through', region, year: now.getFullYear(), month: now.getMonth() + 1
      }, {
        onProgress: (progress) => console.log(
          `[catalog-reconcile] ${region.toUpperCase()} ${progress.fetched} candidates, ` +
          `${progress.inserted} inserted, ${progress.updated} updated, ${progress.deferred} deferred`
        )
      }, true)
      if (!result) throw new Error('完整性服務未啟用。')
      console.log(`[catalog-reconcile] ${region.toUpperCase()} complete: ${JSON.stringify({
        fetched: result.fetched,
        inserted: result.inserted,
        updated: result.updated,
        pendingCards: result.pendingCards
      })}`)
    }
    const stats = database.stats()
    console.log(`[catalog-reconcile] database=${databasePath}`)
    console.log(`[catalog-reconcile] cards=${stats.cards} artworks=${stats.artworks} pending=${stats.coverage.reduce((sum, item) => sum + item.pendingCards, 0)}`)
  } finally {
    database.close()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
