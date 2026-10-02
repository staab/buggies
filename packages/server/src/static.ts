import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
}

/** Vite names everything under here by its hash, so it never changes under its name. */
const HASHED_PREFIX = '/assets/'

async function fileAt(path: string): Promise<{ path: string; size: number } | null> {
  try {
    const stats = await stat(path)
    return stats.isFile() ? { path, size: stats.size } : null
  } catch {
    return null
  }
}

function send(request: IncomingMessage, response: ServerResponse, file: { path: string; size: number }, cache: string): void {
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': file.size,
    'Cache-Control': cache,
  })
  if (request.method === 'HEAD') response.end()
  else createReadStream(file.path).pipe(response)
}

function refuse(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(message)
}

/**
 * The built client, served from `root`. A path naming no file and with no
 * extension is one of the page's own, such as `/{seed}`, and gets `index.html`.
 */
export function serveClient(root: string): RequestListener {
  const base = resolve(root)
  return (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return refuse(response, 405, 'method not allowed')
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname)
    } catch {
      return refuse(response, 400, 'bad request')
    }
    const wanted = resolve(join(base, pathname))
    if (wanted !== base && !wanted.startsWith(base + sep)) return refuse(response, 404, 'not found')
    void (async () => {
      const file = await fileAt(wanted)
      if (file !== null) {
        const cache = pathname.startsWith(HASHED_PREFIX) ? 'public, max-age=31536000, immutable' : 'no-cache'
        return send(request, response, file, cache)
      }
      if (extname(pathname) !== '') return refuse(response, 404, 'not found')
      const index = await fileAt(join(base, 'index.html'))
      if (index === null) return refuse(response, 404, 'the client is not built')
      send(request, response, index, 'no-cache')
    })().catch(() => {
      if (!response.headersSent) refuse(response, 500, 'internal error')
      else response.destroy()
    })
  }
}
