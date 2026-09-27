import type * as RAPIER from '@dimforge/rapier3d-compat'
import { FLAT, type WorldShape } from '@buggies/physics'
import { boatAt, type Building, type TerrainMap } from '@buggies/terrain'
import { addMover, placeOnShape } from '@buggies/vehicle'

/** A boat on the water, meandering about where it lies at anchor, and the body a car meets it by. */
export interface Boat {
  readonly home: Building
  readonly index: number
  readonly body: RAPIER.RigidBody
  /** The shape of the world its body is in. */
  readonly shape: WorldShape
}

const pose = { x: 0, z: 0, yaw: 0 }

/** Where a boat is at this tick, and its body put there: at once, or over the next step. */
export function moveBoat(boat: Boat, tick: number, now: boolean): void {
  const { home } = boat
  boatAt(home, boat.index, tick / 60, pose)
  const { position: at, rotation: turn } = placeOnShape(boat.shape, pose.x, (home.top + home.bottom) / 2, pose.z, pose.yaw)
  if (now) {
    boat.body.setTranslation(at, true)
    boat.body.setRotation(turn, true)
  } else {
    boat.body.setNextKinematicTranslation(at)
    boat.body.setNextKinematicRotation(turn)
  }
}

/** The island's boats, each a body of its own where it is at the start. */
export function createBoats(map: TerrainMap, world: RAPIER.World, shape: WorldShape = FLAT): Boat[] {
  return map.buildings
    .filter((building) => building.kind === 'boat')
    .map((home, index) => {
      const boat = { home, index, body: addMover(world, home.width / 2, (home.top - home.bottom) / 2, home.depth / 2, { x: home.x, y: home.bottom, z: home.z }), shape }
      moveBoat(boat, 0, true)
      return boat
    })
}
