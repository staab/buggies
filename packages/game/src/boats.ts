import type * as RAPIER from '@dimforge/rapier3d-compat'
import * as exact from '@buggies/physics'
import { boatAt, type Building, type TerrainMap } from '@buggies/terrain'
import { addMover } from '@buggies/vehicle'

// The exact trigonometry, copied into this module: called through the import binding it
// is several times slower under the test runner's module loader, and these run hot.
const { cos, sin } = exact

/** A boat on the water, meandering about where it lies at anchor, and the body a car meets it by. */
export interface Boat {
  readonly home: Building
  readonly index: number
  readonly body: RAPIER.RigidBody
}

const pose = { x: 0, z: 0, yaw: 0 }

/** Where a boat is at this tick, and its body put there: at once, or over the next step. */
export function moveBoat(boat: Boat, tick: number, now: boolean): void {
  const { home } = boat
  boatAt(home, boat.index, tick / 60, pose)
  const at = { x: pose.x, y: (home.top + home.bottom) / 2, z: pose.z }
  const turn = { x: 0, y: sin(pose.yaw / 2), z: 0, w: cos(pose.yaw / 2) }
  if (now) {
    boat.body.setTranslation(at, true)
    boat.body.setRotation(turn, true)
  } else {
    boat.body.setNextKinematicTranslation(at)
    boat.body.setNextKinematicRotation(turn)
  }
}

/** The island's boats, each a body of its own where it is at the start. */
export function createBoats(map: TerrainMap, world: RAPIER.World): Boat[] {
  return map.buildings
    .filter((building) => building.kind === 'boat')
    .map((home, index) => {
      const boat = { home, index, body: addMover(world, home.width / 2, (home.top - home.bottom) / 2, home.depth / 2, { x: home.x, y: home.bottom, z: home.z }) }
      moveBoat(boat, 0, true)
      return boat
    })
}
