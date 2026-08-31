import { createReadStream, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve('out/renderer')
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
}

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
  const relative = normalize(pathname === '/' ? 'index.html' : pathname.slice(1))
  const candidate = resolve(join(root, relative))
  const target = candidate.startsWith(root) && existsSync(candidate) ? candidate : join(root, 'index.html')
  response.setHeader('Content-Type', mimeTypes[extname(target)] ?? 'application/octet-stream')
  response.setHeader('Cache-Control', 'no-store')
  createReadStream(target).pipe(response)
}).listen(4173, '127.0.0.1', () => {
  console.log('Arcana Archive static preview: http://127.0.0.1:4173')
})

