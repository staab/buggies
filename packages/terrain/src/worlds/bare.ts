/**
 * A world with only what its maker gives it: everything a planet has that
 * it leaves out is there, and empty, so that every world is a `World`
 * whatever it is made of.
 */

import { DRY, type World, type WorldMesh } from '../world.ts'

/** What a maker must give: which world, its ground and its sea; and whatever else it has. */
export type WorldParts = Pick<World, 'seed' | 'kind' | 'radius' | 'seaLevel' | 'ground'> & Partial<World>

/** A mesh of nothing, its own, so that handing one world's buffers over to another thread takes nothing from the next. */
function noMesh(): WorldMesh {
  return { positions: new Float32Array(0), indices: new Uint32Array(0) }
}

/** A world of these parts, the rest of it empty: dry, unroofed, unbored, and with nothing standing on it. */
export function bareWorld(parts: WorldParts): World {
  const count = parts.ground.heights.length
  return {
    bored: Float32Array.from(parts.ground.heights),
    roof: new Float32Array(0),
    platforms: [],
    holes: new Uint8Array(count),
    water: new Float32Array(count).fill(DRY),
    districtOf: new Uint8Array(count),
    mountains: [],
    rivers: [],
    lakes: [],
    districts: [],
    roads: [],
    buildings: [],
    trees: [],
    rocks: [],
    props: [],
    ramps: [],
    sidewalks: [],
    fields: [],
    portals: [],
    decks: { ...noMesh(), surfaces: new Uint8Array(0) },
    paths: [],
    shells: [],
    rails: noMesh(),
    curbs: noMesh(),
    kickers: [],
    ...parts,
  }
}
