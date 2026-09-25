/**
 * Collision groups, packed the way Rapier reads them: the groups a collider
 * is in, and the groups it meets. Walls are the one kind singled out. Tires
 * ride the ground under the chassis, never a guardrail or a tunnel wall, so
 * the wheel rays pass through walls and only the chassis meets them. Left
 * to hit a wall, a wheel hanging past the chassis lands its ray on top of
 * the rail the moment the car leans on it, and the suspension catapults the
 * car over.
 */
const ALL = 0xffff
const GROUND = 0x0001
const WALL = 0x0002

function groups(membership: number, filter: number): number {
  return ((membership << 16) | filter) >>> 0
}

/** A wall: met by everything, and only ever as a wall. */
export const WALL_GROUPS = groups(WALL, ALL)

/**
 * The ground: the land, road decks and whatever else a car drives on. Met
 * by everything, and the one thing a chassis may scrape without it being a
 * crash.
 */
export const GROUND_GROUPS = groups(GROUND, ALL)

export function isGround(collider: {collisionGroups(): number}): boolean {
  return collider.collisionGroups() >>> 16 === GROUND
}

/** What a wheel ray may land on: anything but a wall. */
export const WHEEL_RAY_GROUPS = groups(ALL, ALL & ~WALL)
