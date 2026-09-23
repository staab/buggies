import type { ClientTransport } from './transport.ts'
import { decodeRooms, encodeRoomsRequest, type RoomSummary } from './wire.ts'

/**
 * Ask a server which islands have people on them, busiest first. One short
 * connection: the question, the answer, and the server hangs up. A server
 * that cannot be reached, or does not answer, leaves an empty list.
 */
export async function fetchRooms(transport: ClientTransport): Promise<RoomSummary[]> {
  return new Promise<RoomSummary[]>((resolve) => {
    let settled = false
    const finish = (rooms: RoomSummary[]): void => {
      if (settled) return
      settled = true
      resolve(rooms)
    }
    transport
      .connect({
        onMessage: (payload) => {
          const rooms = decodeRooms(payload)
          if (rooms !== null) {
            finish(rooms)
            transport.close('rooms')
          }
        },
        onClose: () => finish([]),
      })
      .then(
        () => transport.send(encodeRoomsRequest()),
        () => finish([]),
      )
  })
}
