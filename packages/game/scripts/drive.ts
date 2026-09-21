import { ROAD_BRIDGE, ROAD_GRADE, ROAD_SURFACE, generateTerrain, type Road } from '@buggies/terrain'
import {
  NEUTRAL_INPUT,
  VEHICLE_PROFILE_IDS,
  VEHICLE_PROFILE_LABELS,
  advance,
  createArena,
  initPhysics,
  respawn,
  takeSeat,
  type Seat,
} from '@buggies/game'

await initPhysics()

const LOOK_AHEAD = 22

/** Steer toward a point ahead, the way a driver following a road would. */
function pursue(seat: Seat, target: { x: number; z: number }): number {
  const { position, forward } = seat.vehicle.frame
  const wanted = Math.atan2(target.x - position.x, target.z - position.z)
  const facing = Math.atan2(forward.x, forward.z)
  let error = wanted - facing
  while (error > Math.PI) error -= 2 * Math.PI
  while (error < -Math.PI) error += 2 * Math.PI
  return Math.max(-1, Math.min(1, error * 2.5))
}

/** The longest stretch of a road that is actually on the ground: where it
 * starts, and how long it runs. Spawning into a tunnel wedges the vehicle
 * inside a hill, which looks exactly like broken physics and is not. */
function longestGradeRun(road: Road): { start: number; length: number } {
  let best = { start: 0, length: 0 }
  let run = 0
  for (const [i, structure] of Array.from(road.structure).entries()) {
    run = structure === ROAD_GRADE ? run + 1 : 0
    if (run > best.length) best = { start: i - run + 1, length: run }
  }
  return best
}

/** The index `distance` further along a road from `start`. */
function advanceAlong(road: Road, start: number, distance: number): number {
  let travelled = 0
  let at = start
  while (at < road.points.length - 4 && travelled < distance) {
    travelled += Math.hypot(
      road.points[at + 1]!.x - road.points[at]!.x,
      road.points[at + 1]!.z - road.points[at]!.z,
    )
    at++
  }
  return at
}

console.log('seed  vehicle       built   step us   followed  grounded  airborne  in water  top km/h')
for (const seed of [3, 7, 21]) {
  const map = generateTerrain(seed)
  const road = map.roads
    .filter((candidate) => !candidate.closed && candidate.points.length > 40)
    .sort((a, b) => longestGradeRun(b).length - longestGradeRun(a).length)[0]!
  // Far enough into the run, in distance rather than points, that the vehicle
  // is not hanging off the end of the road mesh. Road points can be a few
  // centimetres apart, so counting them is no guide to how far along it is.
  const from = advanceAlong(road, longestGradeRun(road).start, 12)

  for (const profile of VEHICLE_PROFILE_IDS) {
    const built = Date.now()
    const arena = createArena(map, 1)
    const seat = takeSeat(arena, 0, profile)
    Object.assign(seat.spawn, {
      position: {
        x: road.points[from]!.x,
        y: road.points[from]!.y + ROAD_SURFACE,
        z: road.points[from]!.z,
      },
      yaw: Math.atan2(
        -(road.points[from + 3]!.x - road.points[from]!.x),
        -(road.points[from + 3]!.z - road.points[from]!.z),
      ),
    })
    respawn(seat)
    const buildMs = Date.now() - built

    let at = from
    let grounded = 0
    let airborne = 0
    let wet = 0
    let top = 0
    const steps = 45 * 60
    const started = Date.now()
    for (let i = 0; i < steps; i++) {
      const { position } = seat.vehicle.frame
      while (at < road.points.length - 1) {
        const point = road.points[at]!
        if (Math.hypot(point.x - position.x, point.z - position.z) > LOOK_AHEAD) break
        at++
      }
      const throttle = seat.vehicle.speed < 25 ? 1 : 0
      advance(arena, () => ({ ...NEUTRAL_INPUT, throttle, steer: pursue(seat, road.points[at]!) }))
      if (seat.vehicle.groundedCount === 4) grounded++
      if (seat.vehicle.groundedCount === 0) airborne++
      if (seat.submersion > 0.2) wet++
      top = Math.max(top, seat.vehicle.speed)
    }
    const stepUs = ((Date.now() - started) * 1000) / steps

    const pct = (n: number) => `${((n / steps) * 100).toFixed(1).padStart(5)}%`
    console.log(
      `${String(seed).padStart(4)}  ${VEHICLE_PROFILE_LABELS[profile].padEnd(12)} ${String(buildMs).padStart(5)}ms ` +
        `${stepUs.toFixed(0).padStart(6)}   ${String(at - from).padStart(5)} pts   ${pct(grounded)}   ${pct(airborne)}   ` +
        `${pct(wet)}   ${(top * 3.6).toFixed(0).padStart(6)}`,
    )
    arena.world.free()
  }
}

const bridges = generateTerrain(3).roads.flatMap((r) =>
  Array.from(r.structure).filter((s) => s === ROAD_BRIDGE),
).length
console.log(`\n(seed 3 has ${bridges} bridge spans)`)
