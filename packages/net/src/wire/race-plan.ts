import type { Vec3 } from '@buggies/physics'

import { CHECKPOINTS_LISTED, KEEP_LISTED, NO_ARRIVAL, SERVER_RACE_PLAN } from '../protocol.ts'
import { Reader, Writer, atMost, messageTypeOf } from './fields.ts'

/** A race plan up to its keep list, which follows; then its gates, and where the leg leads. */
export const RACE_PLAN_HEADER_BYTES = 8
export const RACE_PLAN_TAIL_BYTES = 9
/** Each world of the course, after the tail, as many as it says; and the most a plan lists. */
export const COURSE_WORLD_BYTES = 4
export const COURSE_WORLDS_LISTED = 8
export const KEEP_PORTAL_BYTES = 1
/** A gate: where it stands, which way it is driven through, and how near counts as through. */
export const CHECKPOINT_BYTES = 25

/** A gate to drive through, as the client draws it: across the road, facing the way it is driven. */
export interface CheckpointView {
  at: Vec3
  forward: Vec3
  /** How near its middle counts as through, in metres. */
  radius: number
}

/** One leg of a race's course, as the client is told it: the gates to pass, and the portal on out. */
export interface RacePlan {
  game: number
  /** 1-based index of this world in the course. */
  world: number
  ofWorlds: number
  /** The portals this world keeps for the race, as indices into it as generated: everything else is gone. */
  keep: readonly number[]
  checkpoints: readonly CheckpointView[]
  /** The leg's exit portal, as an index into the kept portals, or `null` on the last leg. */
  exit: number | null
  /** Where the exit portal leads: null on the last leg. */
  next: { world: number; arrival: number } | null
  /** Every world of the course, in the order it is raced. */
  worlds: readonly number[]
}

/** The leg of a race's course this world is, with its gates and where it leads. */
export function encodeRacePlan(plan: RacePlan): Uint8Array {
  const keep = plan.keep.slice(0, KEEP_LISTED)
  const checkpoints = plan.checkpoints.slice(0, CHECKPOINTS_LISTED)
  const worlds = plan.worlds.slice(0, COURSE_WORLDS_LISTED)
  const writer = new Writer(
    RACE_PLAN_HEADER_BYTES + keep.length * KEEP_PORTAL_BYTES + checkpoints.length * CHECKPOINT_BYTES + RACE_PLAN_TAIL_BYTES + worlds.length * COURSE_WORLD_BYTES,
  )
  writer.u8(SERVER_RACE_PLAN)
  writer.u32(plan.game >>> 0)
  writer.u8(plan.world)
  writer.u8(plan.ofWorlds)
  writer.u8(keep.length)
  for (const portal of keep) writer.u8(portal)
  writer.u8(checkpoints.length)
  for (const checkpoint of checkpoints) {
    writer.vec3(checkpoint.at)
    writer.vec3(checkpoint.forward)
    writer.u8(atMost(checkpoint.radius, 0xff))
  }
  writer.u8(plan.next === null ? 0 : 1)
  writer.u32(plan.next?.world ?? 0)
  writer.u8(plan.next?.arrival ?? NO_ARRIVAL)
  writer.u8(plan.exit ?? NO_ARRIVAL)
  writer.u8(worlds.length)
  for (const world of worlds) writer.u32(world >>> 0)
  return writer.bytes
}

/** What a leg of a race's course says, or `null` if the message is not one. */
export function decodeRacePlan(payload: Uint8Array): RacePlan | null {
  if (payload.length < RACE_PLAN_HEADER_BYTES || messageTypeOf(payload) !== SERVER_RACE_PLAN) return null
  const reader = new Reader(payload)
  reader.u8()
  const game = reader.u32()
  const world = reader.u8()
  const ofWorlds = reader.u8()
  const keepCount = reader.u8()
  if (keepCount > KEEP_LISTED || reader.left() < keepCount * KEEP_PORTAL_BYTES + RACE_PLAN_TAIL_BYTES) return null
  const keep: number[] = []
  for (let k = 0; k < keepCount; k++) keep.push(reader.u8())
  const checkpointCount = reader.u8()
  if (checkpointCount > CHECKPOINTS_LISTED || reader.left() < checkpointCount * CHECKPOINT_BYTES + RACE_PLAN_TAIL_BYTES - 1) return null
  const checkpoints: CheckpointView[] = []
  for (let k = 0; k < checkpointCount; k++) {
    checkpoints.push({ at: reader.vec3(), forward: reader.vec3(), radius: reader.u8() })
  }
  const nextFlag = reader.u8()
  const nextWorld = reader.u32()
  const nextArrival = reader.u8()
  const exit = reader.u8()
  if (nextFlag > 1) return null
  const worldCount = reader.u8()
  if (worldCount > COURSE_WORLDS_LISTED || reader.left() !== worldCount * COURSE_WORLD_BYTES) return null
  const worlds: number[] = []
  for (let k = 0; k < worldCount; k++) worlds.push(reader.u32())
  return {
    game,
    world,
    ofWorlds,
    keep,
    checkpoints,
    exit: exit === NO_ARRIVAL ? null : exit,
    next: nextFlag === 0 ? null : { world: nextWorld, arrival: nextArrival },
    worlds,
  }
}
