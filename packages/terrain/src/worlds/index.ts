/**
 * Every world a planet has, made by its kind: the planet itself, its moon,
 * and the planets its portals reach.
 */

import type { World } from '../world.ts'
import { generatePlanet } from '../globe/planet.ts'
import { planetSeedOf, worldKindOf, type WorldKind } from './kinds.ts'
import { generateJupiter } from './jupiter.ts'
import { generateMars } from './mars.ts'
import { generateMercury } from './mercury.ts'
import { generateMoon } from './moon.ts'
import { generateNeptune } from './neptune.ts'
import { generateVenus } from './venus.ts'

/** What makes each kind of world, from its planet's seed. */
const MAKERS: Readonly<Record<WorldKind, (seed: number) => World>> = {
  planet: generatePlanet,
  moon: generateMoon,
  mars: generateMars,
  neptune: generateNeptune,
  jupiter: generateJupiter,
  venus: generateVenus,
  mercury: generateMercury,
}

/** Make a world by its id. */
export function generateWorld(id: number): World {
  return MAKERS[worldKindOf(id)](planetSeedOf(id))
}
