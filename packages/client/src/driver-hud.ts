import type { Vehicle } from '@buggies/game'
import {
  ROAD_SURFACE,
  boreClearance,
  boreFloorAt,
  deckSpans,
  lowestDeckOver,
  sampleHeight,
  tunnelSegments,
  type TerrainMap,
} from '@buggies/terrain'

import type { CameraBoundsAt } from './chase-camera.ts'

/** Slip angle past which the HUD starts calling it a slide, in radians. */

/**
 * Whether a point is inside one of a map's tunnels. Tunnels are the one place
 * a chase camera cannot work: the arm would sit inside the hill, and the
 * ground it holds itself above is the mountain overhead.
 */
export function tunnelTest(map: TerrainMap): (position: { x: number; y: number; z: number }) => boolean {
  const bores = tunnelSegments(map.roads)
  if (bores.length === 0) return () => false
  return ({ x, y, z }) => boreClearance(bores, x, z, y) < 0
}

/** A deck has to clear the car's centre by this much to count as over it rather than under it. */
const DECK_HEADROOM = 1.5
/** How far below a deck's surface its underside is taken to be. */
const DECK_UNDERSIDE = 0.4

/**
 * What the chase camera must stay between: the ground, or inside a tunnel
 * the road and the arch over it, or under a bridge the deck overhead. Read
 * from the map rather than the physics world so the camera never has to ask
 * the simulation anything.
 */
export function cameraBounds(map: TerrainMap): CameraBoundsAt {
  const bores = tunnelSegments(map.roads)
  const decks = deckSpans(map.roads)
  return (x, z, out, above) => {
    const floor = boreFloorAt(bores, x, z)
    if (floor === null) {
      out.floor = sampleHeight(map.heightfield, x, z)
      out.ceiling = Number.POSITIVE_INFINITY
    } else {
      out.floor = floor + ROAD_SURFACE
      out.ceiling = -boreClearance(bores, x, z, 0)
    }
    out.ceiling = Math.min(out.ceiling, lowestDeckOver(decks, x, z, above + DECK_HEADROOM) - DECK_UNDERSIDE)
    return out
  }
}
