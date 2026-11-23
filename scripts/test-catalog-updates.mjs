import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
await build({
  entryPoints: [fileURLToPath(new URL('../tests/catalog-updates.test.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../.arcana-smoke/catalog-updates.test.cjs', import.meta.url)),
  bundle: true, platform: 'node', format: 'cjs', target: 'node24', packages: 'external'
})
const result = spawnSync(process.execPath, ['--test', '.arcana-smoke/catalog-updates.test.cjs'], { cwd: root, stdio: 'inherit' })
process.exitCode = result.status ?? 1
