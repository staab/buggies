import { createVehicle, vehicleTuning, type VehicleState } from '@buggies/game'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { CarView } from './car-view.ts'
import { ChaseCamera } from './chase-camera.ts'

function placed(overrides: Partial<VehicleState> = {}): VehicleState {
  return { ...createVehicle({ x: 100, y: 20, z: 60 }), ...overrides }
}

describe('CarView', () => {
  it('draws a vehicle the size its tuning says, resting on the contact patch', () => {
    for (const profile of ['buggy', 'truck', 'racer'] as const) {
      const tuning = vehicleTuning(profile)
      const view = new CarView(tuning, '#ff0000')
      view.sync(placed())
      view.object.updateMatrixWorld(true)

      const box = new THREE.Box3().setFromObject(view.object)
      expect(box.max.x - box.min.x).toBeCloseTo(tuning.trackWidth + tuning.wheelRadius * 2 * 0.34, 5)
      expect(box.max.z - box.min.z).toBeGreaterThanOrEqual(tuning.length - 1e-6)
      // Nothing hangs below the wheels, which is where the simulation puts it.
      expect(box.min.y).toBeCloseTo(20, 5)
      view.dispose()
    }
  })

  it('turns the front wheels only, and rolls them all', () => {
    const view = new CarView(vehicleTuning('buggy'), '#ff0000')
    view.sync(placed({ steerAngle: 0.4, wheelSpin: 2.5 }))
    const wheels = view.object.children.filter((child) => child instanceof THREE.Mesh)
    expect(wheels).toHaveLength(4)
    expect(wheels.map((wheel) => wheel.rotation.y)).toEqual([0.4, 0.4, 0, 0])
    expect(wheels.every((wheel) => wheel.rotation.x === 2.5)).toBe(true)
    view.dispose()
  })

  it('points its front wheels the way the rack is turned', () => {
    const view = new CarView(vehicleTuning('buggy'), '#ff0000')
    // A rack angle the simulation produces for a right turn, which is negative
    // because the vehicle's right is local -X.
    view.sync(placed({ steerAngle: -0.4 }))
    view.object.updateMatrixWorld(true)

    const wheel = view.object.children.find(
      (child) => child instanceof THREE.Mesh && child.position.z > 0,
    )!
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(wheel.quaternion)
    expect(facing.x).toBeLessThan(0)
    view.dispose()
  })

  it('squats on its springs when it lands and not otherwise', () => {
    const tuning = vehicleTuning('buggy')
    const view = new CarView(tuning, '#ff0000')
    view.sync(placed())
    const resting = view.object.children[0]!.position.y

    view.sync(placed({ velocity: { x: 0, y: -18, z: 0 }, grounded: true }))
    expect(view.object.children[0]!.position.y).toBeCloseTo(resting - tuning.suspensionTravel, 5)

    view.sync(placed({ velocity: { x: 0, y: -18, z: 0 }, grounded: false }))
    expect(view.object.children[0]!.position.y).toBeCloseTo(resting, 5)
    view.dispose()
  })
})

describe('ChaseCamera', () => {
  const ground = () => 0

  it('sits behind the vehicle and looks at it', () => {
    const camera = new ChaseCamera(5000)
    const state = placed({ position: { x: 100, y: 0, z: 60 }, heading: 0 })
    camera.update(0, state, ground)

    // Heading zero points down +Z, so the camera belongs at lower z, and up.
    expect(camera.camera.position.z).toBeLessThan(state.position.z - 5)
    expect(camera.camera.position.x).toBeCloseTo(state.position.x, 5)
    expect(camera.camera.position.y).toBeGreaterThan(state.position.y + 1)

    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.camera.quaternion)
    expect(facing.z).toBeGreaterThan(0.5)
  })

  it('follows the vehicle around rather than staying put', () => {
    const camera = new ChaseCamera(5000)
    camera.update(0, placed({ position: { x: 0, y: 0, z: 0 }, heading: 0 }), ground)
    const start = camera.camera.position.clone()

    let state = placed({ position: { x: 0, y: 0, z: 0 }, heading: Math.PI / 2 })
    for (let i = 0; i < 180; i++) camera.update(1 / 60, state, ground)
    expect(camera.camera.position.distanceTo(start)).toBeGreaterThan(5)
    // Swung round to the far side: heading +X now, so the camera is at -x.
    expect(camera.camera.position.x).toBeLessThan(-5)

    state = placed({ position: { x: 400, y: 0, z: 400 }, heading: 0 })
    for (let i = 0; i < 300; i++) camera.update(1 / 60, state, ground)
    expect(camera.camera.position.distanceTo(new THREE.Vector3(400, 0, 400))).toBeLessThan(20)
  })

  it('never drops below the ground it is flying over', () => {
    const camera = new ChaseCamera(5000)
    const hill = (x: number) => (x > 50 ? 80 : 0)
    const state = placed({ position: { x: 100, y: 80, z: 60 }, heading: Math.PI / 2 })
    for (let i = 0; i < 120; i++) camera.update(1 / 60, state, hill)
    expect(camera.camera.position.y).toBeGreaterThan(hill(camera.camera.position.x))
  })
})
