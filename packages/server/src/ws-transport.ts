import { createServer, type IncomingMessage, type RequestListener, type Server } from 'node:http'

import type { ServerTransport, TransportConnection, TransportHandlers } from '@buggies/net'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'

const POLICY_VIOLATION_CLOSE_CODE = 1008

/** Larger than any message the protocol has; anything bigger is not ours. */
const MAX_PAYLOAD_BYTES = 4096

/** How many connections one address may hold at once: a household behind one router, not a flood. */
const DEFAULT_CONNECTIONS_PER_ADDRESS = 8

export interface TransportOptions {
  /**
   * Take the address from `X-Forwarded-For`, as a reverse proxy in front
   * sets it. Only a proxy is to be trusted with it, since anyone can send
   * the header.
   */
  trustProxy?: boolean
  connectionsPerAddress?: number
  /** What answers a plain HTTP request on the same port, such as the client's page; left out, it is refused. */
  onRequest?: RequestListener
}

function addressOf(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for']
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
    if (first !== undefined && first !== '') return first
  }
  return request.socket.remoteAddress ?? 'unknown'
}

function toBytes(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function connectionFor(id: number, socket: WebSocket): TransportConnection {
  return {
    id,
    send(payload) {
      if (socket.readyState === socket.OPEN) socket.send(payload, { binary: true })
    },
    close(reason) {
      socket.close(POLICY_VIOLATION_CLOSE_CODE, reason)
    },
  }
}

export interface ListenAddress {
  host: string
  port: number
}

export class WebSocketServerTransport implements ServerTransport {
  private server: WebSocketServer | null = null
  private http: Server | null = null
  private nextConnectionId = 1
  private readonly trustProxy: boolean
  private readonly connectionsPerAddress: number
  private readonly onRequest: RequestListener
  /** How many connections each address holds just now. */
  private readonly perAddress = new Map<string, number>()

  constructor(
    private readonly address: ListenAddress,
    options: TransportOptions = {},
  ) {
    this.trustProxy = options.trustProxy ?? false
    this.connectionsPerAddress = options.connectionsPerAddress ?? DEFAULT_CONNECTIONS_PER_ADDRESS
    this.onRequest =
      options.onRequest ??
      ((_request, response) => {
        response.writeHead(426, { 'Content-Type': 'text/plain' })
        response.end('Upgrade Required')
      })
  }

  listen(handlers: TransportHandlers): Promise<ListenAddress> {
    return new Promise((resolve, reject) => {
      const http = createServer(this.onRequest)
      const server = new WebSocketServer({ server: http, perMessageDeflate: false, maxPayload: MAX_PAYLOAD_BYTES })
      this.http = http
      this.server = server

      http.once('error', reject)
      http.listen(this.address.port, this.address.host, () => {
        const bound = http.address()
        const port = bound !== null && typeof bound !== 'string' ? bound.port : this.address.port
        resolve({ host: this.address.host, port })
      })
      server.on('connection', (socket, request) => {
        // One address only gets so many at once; the rest are turned away at the door.
        const address = addressOf(request, this.trustProxy)
        const held = this.perAddress.get(address) ?? 0
        if (held >= this.connectionsPerAddress) {
          socket.close(POLICY_VIOLATION_CLOSE_CODE, 'too many connections from your address')
          return
        }
        this.perAddress.set(address, held + 1)
        const connection = connectionFor(this.nextConnectionId++, socket)
        socket.on('message', (data) => handlers.onMessage(connection, toBytes(data)))
        socket.on('close', () => {
          this.release(address)
          handlers.onClose(connection)
        })
        socket.on('error', () => socket.terminate())
        handlers.onOpen(connection)
      })
    })
  }

  private release(address: string): void {
    const held = (this.perAddress.get(address) ?? 1) - 1
    if (held > 0) this.perAddress.set(address, held)
    else this.perAddress.delete(address)
  }

  close(): Promise<void> {
    const server = this.server
    const http = this.http
    if (server === null || http === null) return Promise.resolve()
    this.server = null
    this.http = null
    return new Promise((resolve) => {
      for (const client of server.clients) client.terminate()
      server.close(() => {
        http.close(() => resolve())
        http.closeAllConnections()
      })
    })
  }
}
