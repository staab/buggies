import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { serveClient } from './static.ts'
import { WebSocketServerTransport } from './ws-transport.ts'

describe('the client, served beside the sockets', () => {
  let root: string
  let transport: WebSocketServerTransport
  let base: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'buggies-client-'))
    await mkdir(join(root, 'assets'))
    await writeFile(join(root, 'index.html'), '<!doctype html><title>buggies</title>')
    await writeFile(join(root, 'assets', 'main-abc123.js'), 'console.log(1)')
    transport = new WebSocketServerTransport({ host: '127.0.0.1', port: 0 }, { onRequest: serveClient(root) })
    const address = await transport.listen({ onOpen: () => {}, onMessage: () => {}, onClose: () => {} })
    base = `127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await transport.close()
    await rm(root, { recursive: true, force: true })
  })

  it('serves the page at the root and at any island, such as /{seed}', async () => {
    for (const path of ['/', '/12345', '/12345?x=1']) {
      const response = await fetch(`http://${base}${path}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(await response.text()).toContain('<title>buggies</title>')
    }
  })

  it('serves files by their type, caching hashed assets for good', async () => {
    const response = await fetch(`http://${base}/assets/main-abc123.js`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/javascript')
    expect(response.headers.get('cache-control')).toContain('immutable')
  })

  it('answers a missing file, or one outside the root, with 404 rather than the page', async () => {
    expect((await fetch(`http://${base}/assets/missing.js`)).status).toBe(404)
    expect((await fetch(`http://${base}/..%2f..%2fetc%2fpasswd`)).status).toBe(404)
  })

  it('still takes sockets on the same port', async () => {
    const socket = new WebSocket(`ws://${base}/12345`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    socket.close()
  })
})
