import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { WeaponMount } from './weapon-mount.ts'

/** Which way the gun's barrel points in the world. */
function barrel(mount: WeaponMount, car: THREE.Group): THREE.Vector3 {
  car.updateMatrixWorld(true)
  const gun = mount.object.children.find((child) => child.visible)!
  return gun.getWorldDirection(new THREE.Vector3())
}

describe('the weapon mount', () => {
  it('rests the gun the way the car faces, and swings it onto what it is trained on', () => {
    // A car turned part way around, somewhere off the origin.
    const car = new THREE.Group()
    car.position.set(10, 0, 5)
    car.rotation.y = 0.7
    const mount = new WeaponMount(1.8)
    car.add(mount.object)
    mount.show('machineGun')
    mount.aim(null, 1)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(car.quaternion)
    expect(barrel(mount, car).dot(forward)).toBeCloseTo(1, 5)

    // Trained on a point ahead and to one side, it comes around to it over a few frames.
    const target = { x: 30, y: 2, z: -20 }
    for (let i = 0; i < 60; i++) mount.aim(target, 1 / 60)
    const gunAt = mount.object.children.find((child) => child.visible)!.getWorldPosition(new THREE.Vector3())
    const toward = new THREE.Vector3(target.x, target.y, target.z).sub(gunAt).normalize()
    expect(barrel(mount, car).dot(toward)).toBeCloseTo(1, 3)

    // And back to dead ahead when there is nothing.
    for (let i = 0; i < 60; i++) mount.aim(null, 1 / 60)
    expect(barrel(mount, car).dot(forward)).toBeCloseTo(1, 3)
    mount.dispose()
  })

  it('mounts neither the rocket nor the gun over a car with a gun of its own, but the rest', () => {
    const mount = new WeaponMount(1.8, true)
    mount.show('machineGun')
    expect(mount.object.children.some((child) => child.visible)).toBe(false)
    mount.show('rocket')
    expect(mount.object.children.some((child) => child.visible)).toBe(false)
    mount.show('bomb')
    expect(mount.object.children.filter((child) => child.visible)).toHaveLength(1)
    mount.show('repair')
    expect(mount.object.children.filter((child) => child.visible)).toHaveLength(1)
    mount.dispose()
  })

  it('stands the siren still on the roof while the rest hovers', () => {
    const car = new THREE.Group()
    const mount = new WeaponMount(1.8, false, 1.2)
    car.add(mount.object)
    mount.show('siren')
    const horn = mount.object.children.find((child) => child.visible)!
    for (let i = 0; i < 30; i++) {
      mount.update(1 / 10)
      car.updateMatrixWorld(true)
      expect(horn.getWorldPosition(new THREE.Vector3()).y).toBeCloseTo(1.2, 5)
    }
    expect(mount.object.position.y).not.toBeCloseTo(1.8, 5)
    mount.dispose()
  })
})
