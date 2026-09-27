import * as exact from '@buggies/physics'
import type { Vec3 } from '@buggies/physics'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { atan2 } = exact

/**
 * What a player may play for on top of free play: a number of bananas
 * collected, a number of cars wrecked by their weapons, a spot on the
 * island to drive to, or a number of robots brought down.
 */
export type GoalKind = 'score' | 'kills' | 'location' | 'robots'
export const GOAL_KINDS: readonly GoalKind[] = ['score', 'kills', 'location', 'robots']
export const GOAL_LABELS: Readonly<Record<GoalKind, string>> = { score: 'Score', kills: 'Kills', location: 'Location', robots: 'Robots' }

/** The most bananas or wrecks a goal may ask for. */
export const GOAL_TARGET_MOST = 999

/** How many bananas a goal reached is worth. */
export const GOAL_PRIZE = 100

/** How near a spot a car has to come, across the ground, to have reached it. */
export const GOAL_REACH = 20

/** A goal as asked for: how many, for a count, or where, for a spot. */
export interface GoalRequest {
  kind: GoalKind
  /** How many bananas or wrecks; nothing, for a spot. */
  target: number
  /** The way out from the planet's middle through the spot; nothing, for a count. */
  x: number
  y: number
  z: number
}

/** A goal being played for, and what its count stood at when it was set, for it to be counted from. */
export interface Goal extends GoalRequest {
  from: number
}

/** What a goal is played for by: a seat's count of bananas and of wrecks, and where its car is. */
export interface GoalSeat {
  collected: number
  kills: number
  robotKills: number
  goal: Goal | null
  goalsWon: number
  score: number
  readonly occupied: boolean
  readonly vehicle: { readonly wrecked: boolean; readonly frame: { readonly position: Vec3 } }
}

/** A goal as asked for, if it is one that can be played for; `null` otherwise. A spot's way out is made of unit length. */
export function validGoal(request: GoalRequest): GoalRequest | null {
  if (!GOAL_KINDS.includes(request.kind)) return null
  if (request.kind === 'location') {
    const { x, y, z } = request
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
    const length = Math.sqrt(x * x + y * y + z * z)
    if (length < 1e-6) return null
    return { kind: 'location', target: 0, x: x / length, y: y / length, z: z / length }
  }
  const { target } = request
  if (!Number.isInteger(target) || target < 1 || target > GOAL_TARGET_MOST) return null
  return { kind: request.kind, target, x: 0, y: 0, z: 0 }
}

/** Play for this goal from now, counted from where the seat stands, or for none. */
export function setGoal(seat: GoalSeat, request: GoalRequest | null): void {
  if (request === null) {
    seat.goal = null
    return
  }
  const from = request.kind === 'location' ? 0 : countOf(seat, request.kind)
  seat.goal = { ...request, from }
}

/** The count a goal of this kind is played for by. */
function countOf(seat: GoalSeat, kind: Exclude<GoalKind, 'location'>): number {
  return kind === 'score' ? seat.collected : kind === 'kills' ? seat.kills : seat.robotKills
}

/**
 * How far a seat has come toward its goal: bananas or wrecks since it was
 * set, or meters still to go to the spot, along the ground of a planet this big.
 */
export function goalProgress(seat: GoalSeat, goal: Goal, radius: number): number {
  if (goal.kind !== 'location') return countOf(seat, goal.kind) - goal.from
  const { x, y, z } = seat.vehicle.frame.position
  const length = Math.sqrt(x * x + y * y + z * z) || 1
  const dot = (x * goal.x + y * goal.y + z * goal.z) / length
  const cx = (y * goal.z - z * goal.y) / length
  const cy = (z * goal.x - x * goal.z) / length
  const cz = (x * goal.y - y * goal.x) / length
  return atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), dot) * radius
}

/** Whether a seat has reached its goal, on a planet this big. */
export function goalMet(seat: GoalSeat, radius: number): boolean {
  const { goal } = seat
  if (goal === null) return false
  const progress = goalProgress(seat, goal, radius)
  return goal.kind === 'location' ? progress <= GOAL_REACH : progress >= goal.target
}

/**
 * Pay out every goal reached: its prize in bananas, and the goal done with,
 * back to free play. A wreck reaches nothing. Done by whoever has the last
 * word on the arena, so a goal is paid once; the seats paid are returned.
 */
export function awardGoals<S extends GoalSeat>(seats: readonly S[], radius: number): S[] {
  const paid: S[] = []
  for (const seat of seats) {
    if (!seat.occupied || seat.vehicle.wrecked || !goalMet(seat, radius)) continue
    seat.score += GOAL_PRIZE
    seat.goal = null
    seat.goalsWon = (seat.goalsWon + 1) & 0xff
    paid.push(seat)
  }
  return paid
}
