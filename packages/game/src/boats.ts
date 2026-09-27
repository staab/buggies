import type * as RAPIER from '@dimforge/rapier3d-compat'
import { qrotate, quat, v3 } from '@buggies/physics'
import { worldBoatAt, type World, type WorldBuilding } from '@buggies/terrain'
import { addMover } from '@buggies/vehicle'

/** A boat on the water, meandering about where it lies at anchor, and the body a car meets it by. */
export interface Boat {
  readonly home: WorldBuilding
  readonly index: number
  readonly body: RAPIER.RigidBody
}

const pose = { at: v3(), turn: quat() }
const lift = v3()

/** Where a boat is at this tick, and its body put there, its middle half its height up: at once, or over the next step. */
export function moveBoat(boat: Boat, tick: number, now: boolean): void {
  const { home } = boat
  worldBoatAt(home, boat.index, tick / 60, pose)
  qrotate(lift, pose.turn, { x: 0, y: home.height / 2, z: 0 })
  const at = { x: pose.at.x + lift.x, y: pose.at.y + lift.y, z: pose.at.z + lift.z }
  if (now) {
    boat.body.setTranslation(at, true)
    boat.body.setRotation(pose.turn, true)
  } else {
    boat.body.setNextKinematicTranslation(at)
    boat.body.setNextKinematicRotation(pose.turn)
  }
}

/** The island's boats, each a body of its own where it is at the start. */
export function createBoats(map: World, world: RAPIER.World): Boat[] {
  return map.buildings
    .filter((building) => building.kind === 'boat')
    .map((home, index) => {
      const boat = { home, index, body: addMover(world, home.width / 2, home.height / 2, home.depth / 2, home.at) }
      moveBoat(boat, 0, true)
      return boat
    })
}
