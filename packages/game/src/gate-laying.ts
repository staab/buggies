/**
 * The gates of a leg: one every few hundred metres of the way across it, each
 * standing where a car can drive through it, moved to the middle of the
 * corridor it stands in and facing along it where it runs down a tunnel; the
 * last of them the portal out of the world or the line that finishes it.
 */

import { clamp, v3, vdistance, vlength, type Vec3 } from '@buggies/physics'
import { WORLD_TRAITS, alongGround, atHeight, groundDistance, onLand, roofOver, upOf, type World } from '@buggies/terrain'

import { ROAD_REACH } from './road-graph.ts'
import { nearestRoadSpotTo } from './spawns.ts'
import { GATE_HEIGHT, boredHeight, unitOf } from './ground-walk.ts'
import { corridorAt } from './route-laying.ts'

/** A gate a car drives through: where it stands, the way through it, and how near a car must come to pass it. */
export interface Checkpoint {
  readonly at: Vec3
  readonly forward: Vec3
  readonly radius: number
}

/** How many gates a leg runs through, from the fewest to the most the wire carries, and how near a car must come to pass one. */
export const CHECKPOINT_LEAST = 3
export const CHECKPOINT_MOST = 8
export const CHECKPOINT_REACH = 14

/** How far apart, round the ground, the gates of one leg must stand. */
export const CHECKPOINT_APART = 40

/** How far along a run a gate stands from the one before it, on average. */
const CHECKPOINT_SPACING = 220

/** A gate, moved to the middle of the corridor it stands in and facing along it; or left where it was, in the open. */
function centeredGate(world: World, at: Vec3, forward: Vec3): Checkpoint {
  const corridor = corridorAt(world, at, forward)
  if (corridor === null) return { at, forward, radius: CHECKPOINT_REACH }
  return { at: corridor.center, forward, radius: CHECKPOINT_REACH }
}

/**
 * The gates of a leg: one every few hundred metres of the way across it, the
 * first of them a gate's distance past `firstAhead` where the leg's field
 * lines up on it, and the gate that ends it.
 */
export function layGates(world: World, route: readonly Vec3[], forward: Vec3, firstAhead = 0): Checkpoint[] {
  const reached: number[] = [0]
  for (let i = 1; i < route.length; i++) reached.push(reached[i - 1]! + vdistance(route[i - 1]!, route[i]!))
  const total = reached[reached.length - 1]!
  const count = clamp(Math.round(total / CHECKPOINT_SPACING), CHECKPOINT_LEAST, CHECKPOINT_MOST)
  // The run of gates starts far enough along the route to stand clear of the pole of the grid, as far as a gate's
  // distance from the one before it allows: a run too short to have both sets them as evenly as it can.
  const start = Math.min(Math.max(firstAhead, 0), Math.max(total - count * CHECKPOINT_APART, 0))
  const spacing = (total - start) / count
  if (spacing < CHECKPOINT_APART) throw new Error(`a run of ${Math.round(total)} m over ${world.kind} is too short for ${CHECKPOINT_LEAST} gates`)
  const pointAt = (distance: number): Vec3 => {
    const along = Math.min(Math.max(distance, 0), total)
    let piece = 0
    while (piece < route.length - 2 && reached[piece + 1]! < along) piece++
    const run = reached[piece + 1]! - reached[piece]!
    const t = run > 0 ? (along - reached[piece]!) / run : 0
    const a = route[piece]!
    const b = route[piece + 1]!
    // The points of a route are close enough that the line between two of them is on what is driven on just as they are.
    return v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
  }
  const gates: Checkpoint[] = []
  for (let index = 1; index < count; index++) {
    const at = pointAt(start + spacing * index)
    const next = pointAt(start + spacing * (index + 1))
    const way = alongGround(v3(next.x - at.x, next.y - at.y, next.z - at.z), upOf(at))
    if (vlength(way) < 1e-6) throw new Error(`two gates of ${world.kind} stand on top of one another`)
    gates.push(centeredGate(world, at, unitOf(way)))
  }
  // The last gate is the way out, which stands where its portal does, or the line the leg finishes at: neither moves.
  const end = route[route.length - 1]!
  gates.push({ at: { ...end }, forward: unitOf(forward), radius: CHECKPOINT_REACH })
  for (const [index, gate] of gates.entries()) {
    const fault = gateFault(world, gate.at, index === 0 ? null : gates[index - 1]!)
    if (fault !== null) throw new Error(`gate ${index + 1} of ${gates.length} of ${world.kind} ${fault}`)
  }
  return gates
}

/** Why a gate does not stand where a car can drive through it, or nothing where it does: it must be on what is driven on there, under any roof, and clear of the gate before it. */
function gateFault(world: World, at: Vec3, before: Checkpoint | null): string | null {
  if (!drivesOn(world, at)) return `at ${at.x.toFixed(0)},${at.y.toFixed(0)},${at.z.toFixed(0)} is off the land`
  const room = roofOver(world, at) - boredHeight(world, upOf(at))
  if (room < GATE_HEIGHT) return `stands with only ${room.toFixed(1)} m of room under the roof`
  if (before !== null) {
    const apart = groundDistance(before.at, at)
    if (apart < CHECKPOINT_APART) return `stands ${apart.toFixed(0)} m from the one before it`
  }
  return null
}

/** Whether a car drives on what a gate stands on: its road, where it has one, the ground of a world it is out over, or the top of a platform in a world of nothing but platforms. */
function drivesOn(world: World, at: Vec3): boolean {
  if (onRoad(world, at)) return true
  if (WORLD_TRAITS[world.kind].platformsOnly) {
    for (const platform of world.platforms) if (groundDistance(atHeight(world, platform.center, 0), at) <= platform.radius) return true
    return false
  }
  return onLand(world, upOf(at))
}

/** Whether a gate stands on a road, which is driven on wherever it runs: over the water on a bridge, or over the air between Jupiter's platforms. */
function onRoad(world: World, at: Vec3): boolean {
  const spot = nearestRoadSpotTo(world, at)
  return spot !== null && vdistance(spot.point, at) <= ROAD_REACH
}
