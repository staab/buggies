/**
 * What the protocol needs from whatever carries it. WebSockets in the app,
 * a pair of queues in a test: the server and client never know which.
 */

export interface TransportConnection {
  readonly id: number
  send(payload: Uint8Array): void
  close(reason: string): void
}

export interface TransportHandlers {
  onOpen(connection: TransportConnection): void
  onMessage(connection: TransportConnection, payload: Uint8Array): void
  onClose(connection: TransportConnection): void
}

export interface ClientTransportHandlers {
  onMessage(payload: Uint8Array): void
  onClose(reason: string): void
}

export interface ClientTransport {
  connect(handlers: ClientTransportHandlers): Promise<void>
  send(payload: Uint8Array): void
  close(reason: string): void
}

export interface ServerTransport {
  listen(handlers: TransportHandlers): Promise<{ host: string; port: number }>
  close(): Promise<void>
}
