import type { ClientTransport, ClientTransportHandlers } from '@buggies/net'

const NORMAL_CLOSE_CODE = 1000

export class WebSocketClientTransport implements ClientTransport {
  private socket: WebSocket | null = null

  constructor(private readonly url: string) {}

  connect(handlers: ClientTransportHandlers): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url)
      socket.binaryType = 'arraybuffer'
      this.socket = socket

      let opened = false
      socket.addEventListener('open', () => {
        opened = true
        resolve()
      })
      socket.addEventListener('error', () => {
        if (!opened) reject(new Error(`could not reach ${this.url}`))
      })
      socket.addEventListener('close', (event) => {
        if (!opened) reject(new Error(`could not reach ${this.url}`))
        else handlers.onClose(event.reason === '' ? 'connection closed' : event.reason)
      })
      socket.addEventListener('message', (event) => {
        handlers.onMessage(new Uint8Array(event.data as ArrayBuffer))
      })
    })
  }

  send(payload: Uint8Array): void {
    // Copied onto a plain ArrayBuffer, which is what a socket will take.
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(new Uint8Array(payload))
  }

  close(reason: string): void {
    this.socket?.close(NORMAL_CLOSE_CODE, reason)
  }
}
