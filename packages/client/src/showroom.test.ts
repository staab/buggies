import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { START_YAW, TURN_RATE, createShowroomMode, frameShowroom } from './showroom-mode.ts'

describe('showroom', () => {
  it('stands far enough back to see the whole vehicle turn, and to its right', () => {
    const size = new THREE.Vector3(2, 1.5, 4.5)
    const centre = new THREE.Vector3(0, 1, 0)
    const framing = frameShowroom(size, centre, 16 / 9)
    const distance = framing.position.distanceTo(centre)
    // Its diagonal has to fit across the frame at half the width, and the
    // camera is above it, looking down.
    expect(distance).toBeGreaterThan(Math.hypot(2, 4.5))
    expect(framing.position.y).toBeGreaterThan(centre.y)
    expect(framing.target.x).toBeLessThan(centre.x)
    expect(framing.target.y).toBe(centre.y)
    // A wider frame lets it stand nearer.
    expect(frameShowroom(size, centre, 21 / 9).position.distanceTo(centre)).toBeLessThan(distance)
  })

  it('turns whatever is on the turntable, and swaps it for another', () => {
    const showroom = createShowroomMode()
    showroom.resize(16 / 9)
    expect(showroom.vehicle).toBeNull()
    showroom.show('tank')
    expect(showroom.vehicle).toBe('tank')
    const before = showroom.camera.position.clone()
    // It starts side on, nose to the left of the camera, and turns from there.
    const turntable = showroom.scene!.children.find((child) => child instanceof THREE.Group)!
    expect(turntable.rotation.y).toBeCloseTo(START_YAW, 5)
    showroom.update(1, false)
    expect(turntable.rotation.y).toBeCloseTo(START_YAW + TURN_RATE, 5)
    const box = new THREE.Box3().setFromObject(showroom.scene!, true)
    // Something is there, on a floor at ground level, and the camera looks at it.
    expect(box.max.y).toBeGreaterThan(1)
    expect(box.min.y).toBeLessThanOrEqual(0)
    expect(showroom.camera.position.equals(before)).toBe(true)
    showroom.show('goKart')
    expect(showroom.vehicle).toBe('goKart')
    expect(turntable.rotation.y).toBeCloseTo(START_YAW, 5)
    // A smaller vehicle is looked at from nearer.
    expect(showroom.camera.position.length()).toBeLessThan(before.length())
    showroom.dispose()
  })

  it('turns at the rate it says', () => {
    expect(TURN_RATE).toBeGreaterThan(0)
    expect(TURN_RATE).toBeLessThan(1)
  })
})
