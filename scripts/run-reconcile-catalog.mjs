import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const outputDirectory = fileURLToPath(new URL('../.arcana-smoke/', import.meta.url))
const output = fileURLToPath(new URL('../.arcana-smoke/reconcile-catalog.cjs', import.meta.url))
mkdirSync(outputDirectory, { recursive: true })
await build({
  entryPoints: [fileURLToPath(new URL('./reconcile-catalog.ts', import.meta.url))],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  packages: 'external'
})
const result = spawnSync(process.execPath, [output, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })
process.exitCode = result.status ?? 1
