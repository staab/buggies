import * as exact from '@buggies/physics'
import { FIXED_TIMESTEP, type Vec3 } from '@buggies/physics'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2 } = exact

/**
 * What a player may play on top of free play: a number of bananas
 * collected, a number of other players' cars wrecked by their weapons, a
 * race over a course picked on the island, or a number of robots brought
 * down. A count is a player's own; a race is the whole island's.
 */
export type GameKind = 'score' | 'kills' | 'race' | 'robots'
export const GAME_KINDS: readonly GameKind[] = ['score', 'kills', 'race', 'robots']
export const GAME_LABELS: Readonly<Record<GameKind, string>> = { score: 'Score', kills: 'Kills', race: 'Race', robots: 'Robots' }

/** The games played for a count, each a player's own. */
export type CountKind = Exclude<GameKind, 'race'>
export const COUNT_KINDS: readonly CountKind[] = ['score', 'kills', 'robots']

/** The most bananas or wrecks a game may ask for. */
export const GAME_TARGET_MOST = 999

/** How many bananas a game won is worth. */
export const GAME_PRIZE = 100

/** How near a mark of a race a car has to come, across the ground, to have passed it. */
export const GAME_REACH = 20

/** The fewest and most marks a race's course may have: a start, one checkpoint or more, and a finish. */
export const RACE_MARKS_LEAST = 3
export const RACE_MARKS_MOST = 10

/** How far apart, across the ground, each mark of a race must be from the one before it. */
export const RACE_LEG_LEAST = 200

/** How long a race may go on with nobody finishing before it is called off, in ticks. */
export const RACE_TICKS_MOST = Math.round((5 * 60) / FIXED_TIMESTEP)

/** A seat in no race. */
export const NOT_RACING = -1

/** A game as asked for: how many, for a count, or the course, for a race. */
export interface GameRequest {
  kind: GameKind
  /** How many bananas or wrecks; nothing, for a race. */
  target: number
  /** A race's marks in the order they are driven, start first and finish last, each the way out from the planet's middle through it; none, for a count. */
  course: Vec3[]
}

/** A count being played for, and what it stood at when it was set, for it to be counted from. */
export interface Game {
  kind: CountKind
  target: number
  from: number
}

/** A race on, over the island: its course, who set it going, and when. */
export interface Race {
  course: Vec3[]
  starter: number
  startTick: number
}

/** What a game is played by: a seat's count of bananas and of wrecks, how far along a race it is, and where its car is. */
export interface GameSeat {
  collected: number
  kills: number
  robotKills: number
  game: Game | null
  gamesWon: number
  /** How many of the race's marks it has passed, or `NOT_RACING`. */
  racePassed: number
  score: number
  readonly occupied: boolean
  readonly vehicle: { readonly wrecked: boolean; readonly frame: { readonly position: Vec3 } }
}

/** How far apart two places are across the ground of a planet this big, by the ways out through them. */
export function apartOnGround(a: Vec3, b: Vec3, radius: number): number {
  const la = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1
  const lb = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z) || 1
  const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb)
  const cx = a.y * b.z - a.z * b.y
  const cy = a.z * b.x - a.x * b.z
  const cz = a.x * b.y - a.y * b.x
  return atan2(Math.sqrt(cx * cx + cy * cy + cz * cz) / (la * lb), dot) * radius
}

/**
 * Why a race's course cannot be driven on a planet this big, or `null` if
 * it can: too few or too many marks, or a leg too short to be worth a prize.
 */
export function courseFault(course: readonly Vec3[], radius: number): string | null {
  if (course.length < RACE_MARKS_LEAST) return 'A race needs a start, a checkpoint and a finish.'
  if (course.length > RACE_MARKS_MOST) return `A race has at most ${RACE_MARKS_MOST} marks.`
  for (let k = 1; k < course.length; k++) {
    if (apartOnGround(course[k - 1]!, course[k]!, radius) < RACE_LEG_LEAST) return `Each mark must be at least ${RACE_LEG_LEAST} m from the one before it.`
  }
  return null
}

/** A game as asked for, if it is one that can be played on a planet this big; `null` otherwise. A race's marks are made of unit length. */
export function validGame(request: GameRequest, radius: number): GameRequest | null {
  if (!GAME_KINDS.includes(request.kind)) return null
  if (request.kind === 'race') {
    const course: Vec3[] = []
    for (const { x, y, z } of request.course) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
      const length = Math.sqrt(x * x + y * y + z * z)
      if (length < 1e-6) return null
      course.push({ x: x / length, y: y / length, z: z / length })
    }
    return courseFault(course, radius) === null ? { kind: 'race', target: 0, course } : null
  }
  const { target } = request
  if (!Number.isInteger(target) || target < 1 || target > GAME_TARGET_MOST) return null
  return { kind: request.kind, target, course: [] }
}

/** Play for this count from now, counted from where the seat stands, or for none. */
export function setGame(seat: GameSeat, request: { kind: CountKind; target: number } | null): void {
  seat.game = request === null ? null : { kind: request.kind, target: request.target, from: countOf(seat, request.kind) }
}

/** The count a game of this kind is played for by. */
function countOf(seat: GameSeat, kind: CountKind): number {
  return kind === 'score' ? seat.collected : kind === 'kills' ? seat.kills : seat.robotKills
}

/** How far a seat has come toward its count: bananas or wrecks since it was set. */
export function gameProgress(seat: GameSeat, game: Game): number {
  return countOf(seat, game.kind) - game.from
}

/** The mark of a race a seat is to drive to next, or `null` if it is in no race. */
export function nextMark(seat: GameSeat, race: Race): Vec3 | null {
  return seat.racePassed === NOT_RACING ? null : (race.course[seat.racePassed] ?? null)
}

/**
 * Pay out every count reached: its prize in bananas, and back to free play.
 * A wreck wins nothing. Done by whoever has the last word on the arena, so
 * a game is paid once; the seats paid are returned.
 */
export function awardGames<S extends GameSeat>(seats: readonly S[]): S[] {
  const paid: S[] = []
  for (const seat of seats) {
    const { game } = seat
    if (!seat.occupied || seat.vehicle.wrecked || game === null || gameProgress(seat, game) < game.target) continue
    seat.game = null
    pay(seat)
    paid.push(seat)
  }
  return paid
}

/**
 * A step of a race: every racer past its next mark is on to the one after,
 * in order, so a mark is only passed once those before it are, and a wreck
 * passes nothing. The first over the finish is paid and returned; `null`
 * while nobody has finished.
 */
export function runRace<S extends GameSeat>(seats: readonly S[], race: Race, radius: number): S | null {
  for (const seat of seats) {
    if (!seat.occupied || seat.vehicle.wrecked) continue
    const mark = nextMark(seat, race)
    if (mark === null || apartOnGround(seat.vehicle.frame.position, mark, radius) > GAME_REACH) continue
    seat.racePassed += 1
    if (seat.racePassed < race.course.length) continue
    pay(seat)
    return seat
  }
  return null
}

function pay(seat: GameSeat): void {
  seat.score += GAME_PRIZE
  seat.gamesWon = (seat.gamesWon + 1) & 0xff
}
