import { FIXED_TIMESTEP, clamp, v3, vcopy, vcross, vdistance, vdot, vlength, vnormalize, type Vec3 } from '@buggies/physics'
import { alongGround, upOf } from '@buggies/terrain'
import type { VehicleInput, VehicleSpawn } from '@buggies/vehicle'

import { corridorAt } from './course.ts'
import type { Arena, Seat } from './index.ts'
import { spawnHere } from './spawns.ts'

/** How fast the quickest bot drives and the slowest, as a share of its car's top speed. */
const PACE_MOST = 1
const PACE_LEAST = 0.86
/** How many bots' paces are spread across that range before a slot's comes round to the quickest again. */
const PACE_STEPS = 8

/** How far ahead of the point it has reached, in points of the route, a bot looks for itself on it. */
const SEARCH_AHEAD = 24
/** How far off its route a bot may be before it looks for itself all over again, in meters. */
const LOST = 30
/** How far back down the route it looks for itself then: put back at a gate behind it, rather than ahead. */
const SEARCH_BACK = 64

/** How far down the route a bot aims, and how much further for every meter a second it is going. */
const LOOKAHEAD = 12
const LOOK_SPEED = 0.7
/** How hard it steers for the point it aims at, as the lock a meter off it to the side is worth, and how hard back toward the way. */
const STEER = 2.2
const STEER_BACK = 1.2
/** How far off the way a bot still steers back onto it: further off than this it has lost the way, and follows the point it aims at instead. */
const BESIDE = 10

/** How far ahead of it, and how much further for every meter a second it is going, a bot looks for a car in its way. */
const CAR_AHEAD = 15
const CAR_AHEAD_SPEED = 0.6
/** How far to the side of its own line a car may stand and still be in a bot's way, in meters. */
const CAR_ACROSS = 2.5
/** How much slower than it a car has to be going for a bot to go round it rather than follow it, in meters a second. */
const CAR_SLOWER = 1
/** How close a car is too close to go round: it is followed instead, as there is no room left to pull out. */
const CAR_CLEAR = 6
/** How far to the side of a car a bot passes it: a car's width and a half, and never more than this off the route. */
const PASS_ASIDE = 3
/** How wide a corridor, in meters, has to be for a bot to pass a car in it: narrower than this there is no room abreast. */
const PASS_CORRIDOR = 8
/** How far behind a car it cannot get past a bot is off the throttle, in meters, and how much room it keeps per meter a second. */
const FOLLOW_GAP = 6
const FOLLOW_EASE = 1.5

/** The turn off its heading, in radians, at which a bot starts easing off, and the one at which it is off the throttle. */
const EASE = 0.35
const SHARP = 1.1
/** How much of its throttle it gives up by the time it is turning as sharply as that. */
const EASE_OFF = 0.4
/** How far past its pace a bot may be going before it brakes as hard as it can, in meters a second. */
const OVER = 8

/** How much sideways a bot dares in a bend, in meters a second squared, and how far down the route it reads the bends at the least. */
const CORNER_GRIP = 12
const CORNER_REACH = 40

/** How slow a bot has to be going to count as blocked, in meters a second, and for how long before it backs out of it. */
const STUCK_SPEED = 2
const BACK_OUT_TICKS = Math.round(1 / FIXED_TIMESTEP)
/** How long it backs out for, in ticks, before it tries its way on again. */
const REVERSE_TICKS = Math.round(1 / FIXED_TIMESTEP)
/** How many points of the route further on than it was blocked a bot must get before it is going again, rather than still blocked. */
const GOING_ON = 2
/** How long in all, blocked and backing out, a bot has to be getting nowhere before it says it is stuck: two tries at backing out. */
const STUCK_TICKS = Math.round(5 / FIXED_TIMESTEP)

/** How far back down the route, in points, a stuck bot is put, and how many points either side of that are tried. */
const PUT_BACK = 3
const PUT_BACK_TRIES = 2
/** How far to either side of the route a bot may be put back, in meters. */
const PUT_BACK_ASIDE = 2.5
/** How close another car may stand to a spot for a bot to be put back at, in meters. */
const PUT_BACK_CLEAR = 4

/**
 * What drives a car whose place in a race nobody has taken: how fast it dares
 * go, how far along its leg's route it has got, and how it stands with the
 * cars and the walls in its way. It follows the route from gate to gate, goes
 * round a car stopped on it, backs out when it cannot get by, and never fires
 * a weapon.
 */
export interface RacerBot {
  /** How fast it drives, as a share of its car's top speed: the quickest bot's 1, the slowest's 0.86. */
  readonly pace: number
  /** The point of the route it has reached so far: an index into it. */
  along: number
  /** The point of the route it had reached when it last got going: getting a couple of points further on is going again. */
  reached: number
  /** How long in all it has been blocked, in ticks: under a walking pace, and backing out of what stopped it. */
  stuckFor: number
  /** How long it has been blocked since it last backed out, in ticks, which is what makes it back out again. */
  blockedFor: number
  /** How much backing out it has still to do, in ticks; while it has, its foot is on the brake. */
  reverseFor: number
  /** Which way it turns its wheel as it backs out: the other way from the one it was turning. */
  reverseSteer: number
}

/** The share of its car's top speed a bot in this slot drives at: a pace a bot, round the range, so that they spread out. */
export function botPace(slot: number): number {
  const step = ((slot % PACE_STEPS) + PACE_STEPS) % PACE_STEPS
  return PACE_MOST - ((PACE_MOST - PACE_LEAST) * step) / (PACE_STEPS - 1)
}

/** A bot for this slot, at the off of its route. */
export function createRacerBot(slot: number): RacerBot {
  return { pace: botPace(slot), along: 0, reached: 0, stuckFor: 0, blockedFor: 0, reverseFor: 0, reverseSteer: 0 }
}

/** A bot put back on its route, at a point of it, with nothing counted against it any more. */
export function botSetBack(bot: RacerBot, along: number): void {
  bot.along = along
  bot.reached = along
  bot.stuckFor = 0
  bot.blockedFor = 0
  bot.reverseFor = 0
  bot.reverseSteer = 0
}

/**
 * A route as a bot drives it: its points, and what they say about the way at
 * them, which is the same for every bot on a leg and does not change as they
 * drive. It is worked out once from the route and kept, so a route must not be
 * altered while a bot follows it.
 */
interface RouteShape {
  /** The points of the route, in the order they are passed. */
  readonly points: readonly Vec3[]
  /** How far each point stands from the next one along the route, in meters. */
  readonly runs: Float64Array
  /** How sharply the route turns at each point, in radians a meter, or `NO_BEND` where there is no bend to read there. */
  readonly bends: Float64Array
  /** The way across the route at each point, along the ground, three numbers a point: the way it runs, turned to the left. */
  readonly sides: Float64Array
  /** Whether a point has a way across it at all, which it has not where the ones either side of it stand on top of one another. */
  readonly hasSide: Uint8Array
}

/** The shape of every route a bot has followed, worked out the first time it drives one. */
const shapes = new WeakMap<readonly Vec3[], RouteShape>()

/** What a point of a route's bend is where there is none to read: no turn to slow for, and no run counted toward the bends read. */
const NO_BEND = -1

/** What a route says about its points, worked out the first time a bot drives it. */
function shapeOf(points: readonly Vec3[]): RouteShape {
  const known = shapes.get(points)
  if (known !== undefined) return known
  const count = points.length
  const shape: RouteShape = {
    points,
    runs: new Float64Array(count),
    bends: new Float64Array(count).fill(NO_BEND),
    sides: new Float64Array(count * 3),
    hasSide: new Uint8Array(count),
  }
  const up = v3()
  const run = v3()
  const ground = v3()
  const across = v3()
  const into = v3()
  const outOf = v3()
  for (let index = 0; index < count; index++) {
    const point = points[index]!
    const before = points[Math.max(index - 1, 0)]!
    const after = points[Math.min(index + 1, count - 1)]!
    upOf(point, up)
    if (index < count - 1) shape.runs[index] = vdistance(point, points[index + 1]!)
    // The way across it, from the point before to the point after, along the ground and turned to the left.
    run.x = after.x - before.x
    run.y = after.y - before.y
    run.z = after.z - before.z
    alongGround(run, up, ground)
    if (vlength(ground) >= 1e-6) {
      vcross(across, up, ground)
      vnormalize(across, across)
      shape.hasSide[index] = 1
      shape.sides[index * 3] = across.x
      shape.sides[index * 3 + 1] = across.y
      shape.sides[index * 3 + 2] = across.z
    }
    if (index === 0 || index === count - 1) continue
    // The bend at it: the turn from the way in to the way out, over the run to the point after it.
    const step = shape.runs[index]!
    if (step < 1e-6) continue
    run.x = point.x - before.x
    run.y = point.y - before.y
    run.z = point.z - before.z
    alongGround(run, up, into)
    run.x = after.x - point.x
    run.y = after.y - point.y
    run.z = after.z - point.z
    alongGround(run, up, outOf)
    const inLength = vlength(into)
    const outLength = vlength(outOf)
    if (inLength < 1e-6 || outLength < 1e-6) continue
    shape.bends[index] = Math.acos(clamp(vdot(into, outOf) / (inLength * outLength), -1, 1)) / step
  }
  shapes.set(points, shape)
  return shape
}

/** Points and ways the tick's arithmetic is done in, so that driving a bot costs no memory. */
const aimed = v3()
const beside = v3()
const side = v3()
const carSide = v3()
const ownSide = v3()

/** The way across the route at a point of it, written into `out`: whether the route has one there at all. */
function sideAt(shape: RouteShape, index: number, out: Vec3): boolean {
  if (shape.hasSide[index] === 0) return false
  const at = index * 3
  out.x = shape.sides[at]!
  out.y = shape.sides[at + 1]!
  out.z = shape.sides[at + 2]!
  return true
}

/** A point of the route, moved across it and written into `out`: a positive number of meters to its left. */
function acrossPoint(shape: RouteShape, index: number, metres: number, out: Vec3): void {
  const point = shape.points[index]!
  if (metres === 0 || !sideAt(shape, index, side)) {
    vcopy(out, point)
    return
  }
  out.x = point.x + side.x * metres
  out.y = point.y + side.y * metres
  out.z = point.z + side.z * metres
}

/** The point of the route between two of them that is nearest to a car, which is the one it is beside. */
function nearestBetween(shape: RouteShape, from: number, to: number, at: Vec3): number {
  const { points } = shape
  let best = from
  let nearest = vdistance(points[from]!, at)
  for (let point = from + 1; point <= to; point++) {
    const distance = vdistance(points[point]!, at)
    if (distance >= nearest) continue
    nearest = distance
    best = point
  }
  return best
}

/**
 * The point of the route a bot is nearest to, from the one it had got to
 * onward: it looks for itself a window of the route at a time, so that a
 * route that doubles back does not send it off down the other way. One put
 * back at a gate behind it, further off the route than that window reaches,
 * looks back down the route for itself as well.
 */
function nearestPoint(bot: RacerBot, shape: RouteShape, at: Vec3): number {
  const last = shape.points.length - 1
  const from = clamp(Math.floor(bot.along), 0, last)
  const ahead = nearestBetween(shape, from, Math.min(from + SEARCH_AHEAD, last), at)
  const nearest = vdistance(shape.points[ahead]!, at)
  if (nearest <= LOST) return ahead
  const behind = nearestBetween(shape, Math.max(from - SEARCH_BACK, 0), from - 1, at)
  return vdistance(shape.points[behind]!, at) < nearest ? behind : ahead
}

/** The point of the route a bot aims at this tick: as far down it as the bot will have gone by the time it gets there. */
function aimPoint(shape: RouteShape, from: number, speed: number): number {
  const last = shape.points.length - 1
  let aim = from
  let reach = LOOKAHEAD + LOOK_SPEED * speed
  while (aim < last && reach > 0) {
    reach -= shape.runs[aim]!
    aim++
  }
  return aim
}

/**
 * The fastest a bot may go and still take the bends ahead of it: the turn of
 * the sharpest of them it will have to take before it could stop for it, at
 * the grip its car has sideways. `CORNER_REACH` of the route is read at the
 * least, however slowly it is going.
 */
function cornerSpeed(shape: RouteShape, from: number, speed: number): number {
  const last = shape.points.length - 1
  const reach = Math.max(CORNER_REACH, (speed * speed) / (2 * CORNER_GRIP))
  let sharpest = 0
  let traveled = 0
  for (let index = Math.max(from, 1); index < last && traveled < reach; index++) {
    const bend = shape.bends[index]!
    if (bend === NO_BEND) continue
    if (bend > sharpest) sharpest = bend
    traveled += shape.runs[index]!
  }
  return Math.sqrt(CORNER_GRIP / Math.max(sharpest, 1e-4))
}

/** What a bot makes of the nearest car in its way. */
interface InTheWay {
  /** How far ahead of the bot it is, in meters. */
  readonly ahead: number
  /** How fast it is going, in meters a second. */
  readonly speed: number
  /**
   * How far to the side of the route the bot means to pass it, in meters, its
   * left positive; nought where it cannot get by and has to follow instead.
   */
  readonly pass: number
}

/**
 * The car nearest in a bot's way, if one is: slower than the bot, a short way
 * ahead of it, and near its line. Where there is room beside it, the bot goes
 * by on the side of the route away from the one the car stands on, a car's
 * width and a half over; where there is not, in a corridor too narrow for two
 * cars abreast, or with the car already too close to pull out round, it does
 * not try, and follows it instead.
 */
function carInTheWay(seat: Seat, shape: RouteShape, from: number, to: number, arena: Arena): InTheWay | null {
  const { position, forward, right } = seat.vehicle.frame
  const speed = seat.vehicle.speed
  const reach = CAR_AHEAD + CAR_AHEAD_SPEED * speed
  let at: Vec3 | null = null
  let nearest = Infinity
  let theirSpeed = 0
  for (const other of arena.seats) {
    if (other === seat || !other.occupied || other.coasting) continue
    const place = other.vehicle.frame.position
    const dx = place.x - position.x
    const dy = place.y - position.y
    const dz = place.z - position.z
    const ahead = dx * forward.x + dy * forward.y + dz * forward.z
    if (ahead <= 0 || ahead > reach || ahead >= nearest) continue
    if (Math.abs(dx * right.x + dy * right.y + dz * right.z) > CAR_ACROSS) continue
    if (other.vehicle.speed > speed - CAR_SLOWER) continue
    at = place
    nearest = ahead
    theirSpeed = other.vehicle.speed
  }
  if (at === null) return null
  if (nearest < CAR_CLEAR) return { ahead: nearest, speed: theirSpeed, pass: 0 }
  const near = nearestBetween(shape, from, to, at)
  const point = shape.points[near]!
  if (!sideAt(shape, near, carSide)) return { ahead: nearest, speed: theirSpeed, pass: 0 }
  const offset = (at.x - point.x) * carSide.x + (at.y - point.y) * carSide.y + (at.z - point.z) * carSide.z
  // Away from the side of the route the car stands on; and standing on the middle of it, away from the side the bot is on.
  const own = shape.points[from]!
  const myOffset = sideAt(shape, from, ownSide)
    ? (position.x - own.x) * ownSide.x + (position.y - own.y) * ownSide.y + (position.z - own.z) * ownSide.z
    : 0
  const away = -Math.sign(offset) || -Math.sign(myOffset) || 1
  const corridor = corridorAt(arena.planet, position, forward)
  if (corridor !== null && corridor.width < PASS_CORRIDOR) return { ahead: nearest, speed: theirSpeed, pass: 0 }
  return { ahead: nearest, speed: theirSpeed, pass: clamp(offset + away * PASS_ASIDE, -PASS_ASIDE, PASS_ASIDE) }
}

/**
 * How hard a bot steers back onto its way, -1 to 1: as far as the point of the
 * route beside it lies to its right, so that a way with water or a tree close
 * beside it is driven down its middle. Beyond `BESIDE` off the way it does not
 * steer back at all, having lost the way, and follows the point it aims at.
 */
function steerBack(seat: Seat, own: Vec3): number {
  const { position, right } = seat.vehicle.frame
  const bx = own.x - position.x
  const by = own.y - position.y
  const bz = own.z - position.z
  const off = Math.sqrt(bx * bx + by * by + bz * bz) || 1
  if (off > BESIDE) return 0
  return ((bx * right.x + by * right.y + bz * right.z) / off) * STEER_BACK
}

/**
 * What a bot does about a car or a wall it cannot get by, written into `out`:
 * under a walking pace with its foot down for a second, it backs out, braking
 * at a standstill to drive a car in reverse, the wheel turned the other way
 * from the one it was turning so that backing out takes it clear. It keeps
 * count of how long it has been getting nowhere, and of how much of a reverse
 * it has left to do.
 */
function backOut(bot: RacerBot, speed: number, steer: number, out: VehicleInput): void {
  if (bot.reverseFor === 0 && speed < STUCK_SPEED) {
    bot.stuckFor += 1
    bot.blockedFor += 1
    if (bot.blockedFor >= BACK_OUT_TICKS) {
      bot.blockedFor = 0
      bot.reverseFor = REVERSE_TICKS
      bot.reverseSteer = -Math.sign(steer || 1)
    }
  } else if (bot.reverseFor > 0) {
    bot.stuckFor += 1
  } else {
    bot.blockedFor = 0
  }
  if (bot.reverseFor === 0) return
  // This tick is one of the reverse's, whether it is the first of them or another.
  bot.reverseFor -= 1
  out.steer = bot.reverseSteer
  out.throttle = 0
  out.brake = 1
}

/**
 * What a bot asks of its car this tick, written into `out`: keep to the route,
 * steering for a point a little way down it and holding a pace of its own,
 * easing off and braking for the bends: the one it is in, and the sharper ones
 * it is coming to, which it slows to the speed a car can take them at. A car
 * slower than it in its way is gone round, on the side with more room, or
 * followed where there is none; and a bot blocked for a second with its foot
 * down backs out, the wheel turned the other way, before trying again. It never
 * selects nor fires a weapon. The arena is what the other cars in its way are
 * read from, and what lies over the road it is on. The route is read as it was
 * the first time a bot drove it, so it must not be altered while one follows it.
 */
export function botInput(bot: RacerBot, seat: Seat, route: readonly Vec3[], out: VehicleInput, arena: Arena): VehicleInput {
  // Nothing it asked for last tick is left in what it asks for now, and a car with no route to follow asks for nothing at all.
  out.steer = 0
  out.throttle = 0
  out.brake = 0
  out.handbrake = false
  out.weapon = 0
  out.fire = false
  out.signal = false
  if (route.length < 2 || seat.vehicle.wrecked) return out
  const shape = shapeOf(route)
  const { position, forward, right } = seat.vehicle.frame
  const speed = seat.vehicle.speed
  bot.along = nearestPoint(bot, shape, position)

  // A couple of points further on than it was blocked at is getting going: whatever was counted against it is forgotten.
  if (bot.along >= bot.reached + GOING_ON) {
    bot.reached = bot.along
    bot.stuckFor = 0
    bot.blockedFor = 0
  }

  // A car in its way is gone round on the side of the route with more room, which is where it aims and where it steers back to.
  const aim = aimPoint(shape, bot.along, speed)
  const car = carInTheWay(seat, shape, bot.along, Math.min(aim + 1, shape.points.length - 1), arena)
  const pass = car === null ? 0 : car.pass
  acrossPoint(shape, aim, pass, aimed)
  acrossPoint(shape, bot.along, pass, beside)

  // Steer for the aimed point: hard round if it is behind, as much as the way bends if ahead, and back onto the line if off it.
  const dx = aimed.x - position.x
  const dy = aimed.y - position.y
  const dz = aimed.z - position.z
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
  const across = (dx * right.x + dy * right.y + dz * right.z) / distance
  const facing = (dx * forward.x + dy * forward.y + dz * forward.z) / distance
  const turn = facing < 0 ? Math.sign(across || 1) : across * STEER
  out.steer = clamp(turn + steerBack(seat, beside), -1, 1)

  // Flat out where the way runs straight on, easing off as it bends, and braking
  // when the bend is taken faster than its own pace would have it; and never so
  // fast that a bend ahead cannot be taken at that speed. A car it cannot get
  // past is followed, off the throttle by the time it is a gap behind it.
  const bend = Math.acos(clamp(facing, -1, 1))
  const easing = clamp((bend - EASE) / (SHARP - EASE), 0, 1)
  const follow = car === null || car.pass !== 0 ? Infinity : Math.max(car.speed, (car.ahead - FOLLOW_GAP) * FOLLOW_EASE)
  const wanted = Math.min(bot.pace * seat.tuning.maxSpeed, cornerSpeed(shape, bot.along, speed), follow)
  out.throttle = speed < wanted ? 1 - EASE_OFF * easing : 0
  out.brake = speed > wanted ? Math.min(1, easing + (speed - wanted) / OVER) : 0
  backOut(bot, speed, out.steer, out)
  return out
}

/**
 * Whether a bot has been blocked long enough to be put back on its route: five
 * seconds of getting nowhere, in which it has backed out twice. Its clock runs
 * whether or not the car is being driven, so whoever holds the cars at the grid
 * must not ask until the hold is up, and must put the clock back to nought when
 * it lets them go.
 */
export function botStuck(bot: RacerBot): boolean {
  return bot.stuckFor > STUCK_TICKS
}

/** Which way down the route it goes at a point of it: from the point before to the point after, or to its one neighbour at an end. */
function alongRoute(shape: RouteShape, index: number): Vec3 {
  const { points } = shape
  const point = points[index]!
  const other = points[index < points.length - 1 ? index + 1 : Math.max(index - 1, 0)]!
  return v3(other.x - point.x, other.y - point.y, other.z - point.z)
}

/**
 * Where to put a bot back that has been stuck: on its route a few points back
 * from where it got to, facing along it, and clear of every other car by a few
 * meters. The point and its neighbours are tried, and either side of each; and
 * nothing where every one of them has a car on it.
 */
export function botPutBackSpot(
  route: readonly Vec3[],
  along: number,
  cars: readonly Vec3[],
): { spawn: VehicleSpawn; along: number } | null {
  if (route.length < 2) return null
  const shape = shapeOf(route)
  const last = route.length - 1
  const base = clamp(Math.floor(along) - PUT_BACK, 0, last)
  const points = [base]
  for (let step = 1; step <= PUT_BACK_TRIES; step++) {
    if (base - step >= 0) points.push(base - step)
    if (base + step <= last) points.push(base + step)
  }
  for (const point of points) {
    for (const metres of [0, PUT_BACK_ASIDE, -PUT_BACK_ASIDE]) {
      acrossPoint(shape, point, metres, beside)
      if (cars.some((car) => vdistance(car, beside) < PUT_BACK_CLEAR)) continue
      return { spawn: spawnHere(beside, alongRoute(shape, point)), along: point }
    }
  }
  return null
}
