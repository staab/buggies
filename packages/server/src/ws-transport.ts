import type { ServerTransport, TransportConnection, TransportHandlers } from '@buggies/net'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'

const POLICY_VIOLATION_CLOSE_CODE = 1008

/** Larger than any message the protocol has; anything bigger is not ours. */
const MAX_PAYLOAD_BYTES = 4096

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
  private nextConnectionId = 1

  constructor(private readonly address: ListenAddress) {}

  listen(handlers: TransportHandlers): Promise<ListenAddress> {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host: this.address.host,
        port: this.address.port,
        perMessageDeflate: false,
        maxPayload: MAX_PAYLOAD_BYTES,
      })
      this.server = server

      server.on('error', reject)
      server.on('listening', () => {
        const bound = server.address()
        const port = bound !== null && typeof bound !== 'string' ? bound.port : this.address.port
        resolve({ host: this.address.host, port })
      })
      server.on('connection', (socket) => {
        const connection = connectionFor(this.nextConnectionId++, socket)
        socket.on('message', (data) => handlers.onMessage(connection, toBytes(data)))
        socket.on('close', () => handlers.onClose(connection))
        socket.on('error', () => socket.terminate())
        handlers.onOpen(connection)
      })
    })
  }

  close(): Promise<void> {
    const server = this.server
    if (server === null) return Promise.resolve()
    this.server = null
    return new Promise((resolve) => {
      for (const client of server.clients) client.terminate()
      server.close(() => resolve())
    })
  }
}
