import type { VehicleProfileId } from '@buggies/game'

import { SERVER_STANDINGS } from '../protocol.ts'
import { Reader, Writer, atMost, messageTypeOf, profileAt, profileCode } from './fields.ts'
import { nameBytes } from './text.ts'

/** How a race finished: how many rows, each with the length of its name and the name after it. */
export const STANDINGS_HEADER_BYTES = 2
export const STANDING_BYTES = 9

/** One row of a race's standings. */
export interface Standing {
  place: number
  name: string
  vehicle: VehicleProfileId
  /** How long it took to finish, in seconds; meaningless for a racer that did not. */
  seconds: number
  dnf: boolean
  /** Driven by a bot, not a person. */
  bot: boolean
}

/** How the race finished: places, names, vehicles and times. */
export function encodeStandings(standings: readonly Standing[]): Uint8Array {
  const rows = standings.slice(0, 0xff).map((standing) => ({ standing, name: nameBytes(standing.name) }))
  let length = STANDINGS_HEADER_BYTES
  for (const { name } of rows) length += STANDING_BYTES + name.length
  const writer = new Writer(length)
  writer.u8(SERVER_STANDINGS)
  writer.u8(rows.length)
  for (const { standing, name } of rows) {
    writer.u8(atMost(standing.place, 0xff))
    writer.u8(name.length)
    writer.raw(name)
    writer.u8(profileCode(standing.vehicle))
    writer.u32(Math.min(Math.max(Math.round(standing.seconds), 0), 0xffffffff) >>> 0)
    writer.u8(standing.dnf ? 1 : 0)
    writer.u8(standing.bot ? 1 : 0)
  }
  return writer.bytes
}

/** How a race finished, as it was told, or `null` if the message is not one. */
export function decodeStandings(payload: Uint8Array): Standing[] | null {
  if (payload.length < STANDINGS_HEADER_BYTES || messageTypeOf(payload) !== SERVER_STANDINGS) return null
  const reader = new Reader(payload)
  reader.u8()
  const count = reader.u8()
  const standings: Standing[] = []
  for (let k = 0; k < count; k++) {
    if (reader.left() < STANDING_BYTES) return null
    const place = reader.u8()
    const length = reader.u8()
    // The name, then its vehicle, its time, whether it finished and whether a bot drove it.
    if (reader.left() < length + 1 + 4 + 1 + 1) return null
    const name = reader.text(length)
    const vehicle = profileAt(reader.u8())
    const seconds = reader.u32()
    const dnf = reader.u8()
    const bot = reader.u8()
    if (name === null || vehicle === null || dnf > 1 || bot > 1) return null
    standings.push({ place, name, vehicle, seconds, dnf: dnf === 1, bot: bot === 1 })
  }
  return reader.left() === 0 ? standings : null
}
