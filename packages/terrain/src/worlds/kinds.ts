/**
 * The worlds a planet's portals lead to, and what each is like to drive
 * on. A world's id is its planet's seed with its kind in the top bits, so
 * every world of a planet is made from the same seed.
 */

/** What a world is: the planet itself, its moon, or one of the planets the portals reach. */
export type WorldKind = 'planet' | 'moon' | 'mars' | 'neptune' | 'jupiter' | 'venus' | 'mercury'

/** Every kind of world, in the order their ids number them. */
export const WORLD_KINDS: readonly WorldKind[] = ['planet', 'moon', 'mars', 'neptune', 'jupiter', 'venus', 'mercury']

/** Where a world's kind is kept in its id, over the seed's bits. */
const KIND_SHIFT = 28
const SEED_MASK = (1 << KIND_SHIFT) - 1

/** The id of a planet's world of this kind. */
export function worldId(seed: number, kind: WorldKind): number {
  return ((seed & SEED_MASK) | (WORLD_KINDS.indexOf(kind) << KIND_SHIFT)) >>> 0
}

/** Which kind of world an id is of. */
export function worldKindOf(id: number): WorldKind {
  return WORLD_KINDS[id >>> KIND_SHIFT] ?? 'planet'
}

/** The seed of the planet a world belongs to. */
export function planetSeedOf(id: number): number {
  return (id & SEED_MASK) >>> 0
}

/** The id of a planet's moon. */
export function moonOf(seed: number): number {
  return worldId(seed, 'moon')
}

/** Whether a world's id is a moon's. */
export function isMoon(id: number): boolean {
  return worldKindOf(id) === 'moon'
}

/** What driving on a kind of world is like. */
export interface WorldTraits {
  /** What it is called, after "the portal to". */
  readonly name: string
  /** How hard it pulls a car down, as a share of a planet's pull. */
  readonly gravity: number
  /**
   * How hard a car is held to whatever its wheels are on, wall and roof
   * as much as floor, as a share of a planet's pull; or 0 where it is
   * pulled down toward the middle like anything else.
   */
  readonly cling: number
  /** Whether it has a sky to fly in, for the saucers. */
  readonly openSky: boolean
}

export const WORLD_TRAITS: Readonly<Record<WorldKind, WorldTraits>> = {
  planet: { name: 'the island', gravity: 1, cling: 0, openSky: true },
  moon: { name: 'the moon', gravity: 1, cling: 0, openSky: true },
  mars: { name: 'Mars', gravity: 0.7, cling: 0, openSky: true },
  neptune: { name: 'Neptune', gravity: 1, cling: 0, openSky: false },
  jupiter: { name: 'Jupiter', gravity: 1, cling: 0, openSky: true },
  venus: { name: 'Venus', gravity: 0.9, cling: 0, openSky: true },
  mercury: { name: 'Mercury', gravity: 0.4, cling: 1.1, openSky: false },
}
