import { vdistance } from '@buggies/physics'
import { ROAD_BRIDGE, ROAD_GRADE, generatePlanet, type WorldRoad } from '@buggies/terrain'
import {
  NEUTRAL_INPUT,
  VEHICLE_PROFILE_IDS,
  VEHICLE_PROFILE_LABELS,
  advance,
  createArena,
  initPhysics,
  respawn,
  spawnHere,
  takeSeat,
  type Seat,
} from '@buggies/game'

await initPhysics()

const LOOK_AHEAD = 22

/** Steer toward a point ahead, the way a driver following a road would. */
function pursue(seat: Seat, target: { x: number; y: number; z: number }): number {
  const { position, forward, right } = seat.vehicle.frame
  const toward = { x: target.x - position.x, y: target.y - position.y, z: target.z - position.z }
  const across = toward.x * right.x + toward.y * right.y + toward.z * right.z
  const ahead = toward.x * forward.x + toward.y * forward.y + toward.z * forward.z
  return Math.max(-1, Math.min(1, Math.atan2(across, ahead) * 2.5))
}

/** The longest stretch of a road that is on the ground: where it starts, and how many segments it runs. Spawning into a tunnel wedges a car in a hill. */
function longestGradeRun(road: WorldRoad): { start: number; length: number } {
  let best = { start: 0, length: 0 }
  let run = 0
  for (const [i, structure] of Array.from(road.structure).entries()) {
    run = structure === ROAD_GRADE ? run + 1 : 0
    if (run > best.length) best = { start: i - run + 1, length: run }
  }
  return best
}

/** The index `distance` further along a road from `start`. */
function advanceAlong(road: WorldRoad, start: number, distance: number): number {
  let traveled = 0
  let at = start
  while (at < road.points.length - 4 && traveled < distance) {
    traveled += vdistance(road.points[at + 1]!, road.points[at]!)
    at++
  }
  return at
}

console.log('seed  vehicle       built   step us   followed  grounded  airborne  in water  top km/h')
for (const seed of [3, 7, 21]) {
  const planet = generatePlanet(seed)
  const road = planet.roads
    .filter((candidate) => !candidate.closed && candidate.points.length > 40)
    .sort((a, b) => longestGradeRun(b).length - longestGradeRun(a).length)[0]!
  // Far enough into the run, in distance rather than points, that the car is not hanging off the end of the road.
  const from = advanceAlong(road, longestGradeRun(road).start, 12)

  for (const profile of VEHICLE_PROFILE_IDS) {
    const built = Date.now()
    const arena = createArena(planet, 1)
    const seat = takeSeat(arena, 0, profile)
    const start = road.points[from]!
    const ahead = road.points[from + 3]!
    respawn(seat, spawnHere(start, { x: ahead.x - start.x, y: ahead.y - start.y, z: ahead.z - start.z }))
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
      while (at < road.points.length - 1 && vdistance(road.points[at]!, position) <= LOOK_AHEAD) at++
      const throttle = seat.vehicle.speed < 25 ? 1 : 0
      advance(arena, () => ({ ...NEUTRAL_INPUT, throttle, steer: pursue(seat, road.points[at]!) }))
      if (seat.vehicle.groundedCount === 4) grounded++
      if (seat.vehicle.groundedCount === 0) airborne++
      if (seat.submersion > 0.2) wet++
      top = Math.max(top, seat.vehicle.speed)
    }
    const stepUs = ((Date.now() - started) * 1000) / steps

    const pct = (n: number): string => `${((n / steps) * 100).toFixed(1).padStart(5)}%`
    console.log(
      `${String(seed).padStart(4)}  ${VEHICLE_PROFILE_LABELS[profile].padEnd(12)} ${String(buildMs).padStart(5)}ms ` +
        `${stepUs.toFixed(0).padStart(6)}   ${String(at - from).padStart(5)} pts   ${pct(grounded)}   ${pct(airborne)}   ` +
        `${pct(wet)}   ${(top * 3.6).toFixed(0).padStart(6)}`,
    )
    arena.world.free()
  }
}

const bridges = generatePlanet(3).roads.flatMap((road) => Array.from(road.structure).filter((structure) => structure === ROAD_BRIDGE)).length
console.log(`\n(planet 3 has ${bridges} bridge spans)`)
