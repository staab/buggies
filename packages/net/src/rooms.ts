import type { ClientTransport } from './transport.ts'
import { decodePeek, decodeRooms, encodePeekRequest, encodeRoomsRequest, type IslandMark, type RoomSummary } from './wire.ts'

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

/**
 * Ask a server where every car on one island is, driven or not. One short
 * connection, like the rooms;
 * an island nobody is on, or a server that does not answer, has nothing.
 */
export async function fetchPeek(transport: ClientTransport, seed: number): Promise<IslandMark[]> {
  return new Promise<IslandMark[]>((resolve) => {
    let settled = false
    const finish = (marks: IslandMark[]): void => {
      if (settled) return
      settled = true
      resolve(marks)
    }
    transport
      .connect({
        onMessage: (payload) => {
          const marks = decodePeek(payload)
          if (marks !== null) {
            finish(marks)
            transport.close('peeked')
          }
        },
        onClose: () => finish([]),
      })
      .then(
        () => transport.send(encodePeekRequest(seed)),
        () => finish([]),
      )
  })
}
