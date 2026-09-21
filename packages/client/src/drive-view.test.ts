import { WHEEL_CORNERS, createVehicleTuning, wheelMountLocal, type WheelState } from '@buggies/game'
import { v3 } from '@buggies/physics'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { CarView } from './car-view.ts'
import { ChaseCamera, createCameraTuning, createChaseTarget } from './chase-camera.ts'

/** Wheels as the simulation hands them over, resting on their springs. */
function restingWheels(travel: number, steer = 0, spin = 0): WheelState[] {
  return WHEEL_CORNERS.map((corner) => ({
    ...corner,
    grounded: true,
    steerAngle: corner.isFront ? steer : 0,
    suspensionLength: travel,
    compression: 0,
    suspensionExtensionRate: 0,
    suspensionForce: 0,
    bumpStopDepth: 0,
    stickDepth: 0,
    rayOrigin: v3(),
    rayEnd: v3(),
    contactPoint: v3(),
    contactNormal: v3(0, 1, 0),
    wheelCenter: v3(),
    forward: v3(0, 0, 1),
    right: v3(1, 0, 0),
    slipSpeedLongitudinal: 0,
    slipSpeedLateral: 0,
    forceLongitudinal: 0,
    forceLateral: 0,
    spin,
  }))
}

describe('CarView', () => {
  it('draws a vehicle the size its tuning says', () => {
    for (const profile of ['pickup', 'mustang', 'raceCar'] as const) {
      const tuning = createVehicleTuning(profile)
      const view = new CarView(0xff0000)
      view.syncDimensions(tuning)
      view.applySimulatedWheels(restingWheels(tuning.suspensionRestLength), tuning)
      view.object.updateMatrixWorld(true)

      const box = new THREE.Box3().setFromObject(view.object)
      expect(box.max.z - box.min.z).toBeCloseTo(tuning.chassisHalfLength * 2, 5)
      expect(box.max.x - box.min.x).toBeGreaterThanOrEqual(tuning.chassisHalfWidth * 2 - 1e-6)
      view.dispose()
    }
  })

  it('hangs each wheel off its own mount, dropped by its suspension', () => {
    const tuning = createVehicleTuning('mustang')
    const view = new CarView(0xff0000)
    view.syncDimensions(tuning)
    view.applySimulatedWheels(restingWheels(0.2), tuning)

    const mount = v3()
    for (const [index, corner] of WHEEL_CORNERS.entries()) {
      wheelMountLocal(mount, corner, tuning)
      const wheel = view.object.children[index + 2]!
      expect(wheel.position.x).toBeCloseTo(mount.x, 5)
      expect(wheel.position.y).toBeCloseTo(mount.y - 0.2, 5)
      expect(wheel.position.z).toBeCloseTo(mount.z, 5)
    }
    view.dispose()
  })

  it('turns the front wheels only, and rolls them all', () => {
    const tuning = createVehicleTuning('mustang')
    const view = new CarView(0xff0000)
    view.syncDimensions(tuning)
    view.applySimulatedWheels(restingWheels(0.2, 0.4, 2.5), tuning)

    const wheels = WHEEL_CORNERS.map((_, index) => view.object.children[index + 2]!)
    expect(wheels.map((wheel) => wheel.rotation.y)).toEqual([-0.4, -0.4, -0, -0])
    expect(wheels.every((wheel) => wheel.rotation.x === -2.5)).toBe(true)
    view.dispose()
  })
})

describe('ChaseCamera', () => {
  const flat = () => 0

  it('sits behind the vehicle and looks at it', () => {
    const camera = new ChaseCamera(createCameraTuning())
    camera.setGroundAt(flat)
    const target = createChaseTarget()
    // A chassis faces its own -Z, so an unrotated vehicle looks down -Z and
    // the camera belongs on the +Z side of it.
    target.position = { x: 100, y: 0, z: 60 }
    camera.snapTo(target)

    expect(camera.camera.position.z).toBeGreaterThan(target.position.z + 5)
    expect(camera.camera.position.x).toBeCloseTo(target.position.x, 5)
    expect(camera.camera.position.y).toBeGreaterThan(target.position.y + 1)

    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.camera.quaternion)
    expect(facing.z).toBeLessThan(-0.5)
  })

  it('follows the vehicle around rather than staying put', () => {
    const camera = new ChaseCamera(createCameraTuning())
    camera.setGroundAt(flat)
    const target = createChaseTarget()
    target.position = { x: 0, y: 0, z: 0 }
    camera.snapTo(target)
    const start = camera.camera.position.clone()

    target.position = { x: 400, y: 0, z: 400 }
    for (let i = 0; i < 300; i++) camera.update(1 / 60, target)
    expect(camera.camera.position.distanceTo(start)).toBeGreaterThan(100)
    expect(camera.camera.position.distanceTo(new THREE.Vector3(400, 0, 400))).toBeLessThan(20)
  })

  it('never drops below the ground it is flying over', () => {
    const tuning = createCameraTuning()
    const camera = new ChaseCamera(tuning)
    const hill = (x: number) => (x > 50 ? 80 : 0)
    camera.setGroundAt(hill)
    const target = createChaseTarget()
    target.position = { x: 100, y: 80, z: 60 }
    camera.snapTo(target)
    for (let i = 0; i < 120; i++) camera.update(1 / 60, target)
    expect(camera.camera.position.y).toBeGreaterThan(hill(camera.camera.position.x))
  })

  it('stays under a tunnel roof, and comes back up once out of it', () => {
    const camera = new ChaseCamera(createCameraTuning())
    // A bore three metres high, then open sky.
    let roof = 3
    camera.setBoundsAt((_x, _z, out) => {
      out.floor = 0
      out.ceiling = roof
      return out
    })
    const target = createChaseTarget()
    target.position = { x: 0, y: 0, z: 0 }
    camera.snapTo(target)
    expect(camera.camera.position.y).toBeLessThan(roof)
    expect(camera.camera.position.y).toBeGreaterThan(0.5)

    roof = Number.POSITIVE_INFINITY
    for (let i = 0; i < 180; i++) camera.update(1 / 60, target)
    expect(camera.camera.position.y).toBeCloseTo(createCameraTuning().height, 0)
  })
})

describe('ChaseCamera under a deck', () => {
  it('drops to a low chase under a bridge, and rises again once out from under it', () => {
    const tuning = createCameraTuning()
    const camera = new ChaseCamera(tuning)
    // A deck five metres up that appears over the car, then goes away.
    let deck = Number.POSITIVE_INFINITY
    camera.setBoundsAt((_x, _z, out, above) => {
      out.floor = 0
      out.ceiling = deck > above + 1.5 ? deck - 0.4 : Number.POSITIVE_INFINITY
      return out
    })
    const target = createChaseTarget()
    target.position = { x: 0, y: 0.5, z: 0 }
    camera.snapTo(target)
    const open = camera.camera.position.y
    expect(open).toBeGreaterThan(4)

    deck = 5
    for (let i = 0; i < 180; i++) camera.update(1 / 60, target)
    expect(camera.camera.position.y).toBeLessThan(3)
    expect(camera.camera.position.y).toBeGreaterThan(1.5)

    deck = Number.POSITIVE_INFINITY
    for (let i = 0; i < 180; i++) camera.update(1 / 60, target)
    expect(camera.camera.position.y).toBeCloseTo(open, 1)
  })
})
