import { WebSocket } from 'ws'
import { describe, expect, it } from 'vitest'

import { WebSocketServerTransport } from './ws-transport.ts'

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

/** The code a socket is closed with, once it is. */
function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) resolve(1005)
    else socket.once('close', (code) => resolve(code))
  })
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

describe('the socket transport', () => {
  it('lets an address hold only so many connections at once, and frees the place of one that goes', async () => {
    const opened: number[] = []
    const transport = new WebSocketServerTransport({ host: '127.0.0.1', port: 0 }, { connectionsPerAddress: 2 })
    const address = await transport.listen({
      onOpen: (connection) => opened.push(connection.id),
      onMessage: () => {},
      onClose: () => {},
    })
    const url = `ws://127.0.0.1:${address.port}`
    const first = await open(url)
    const second = await open(url)
    // A third from the same address is turned away, and the server never hears of it.
    const third = await open(url)
    expect(await closed(third)).toBe(1008)
    await settle()
    expect(opened).toHaveLength(2)
    // One leaving makes room for another.
    first.close()
    await closed(first)
    await settle()
    const fourth = await open(url)
    await settle()
    expect(fourth.readyState).toBe(WebSocket.OPEN)
    expect(opened).toHaveLength(3)
    second.close()
    fourth.close()
    await transport.close()
  })
})
