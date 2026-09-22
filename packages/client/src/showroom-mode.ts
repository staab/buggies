import { DEFAULT_WORLD_TUNING, createVehicleTuning, restingRideHeight, type VehicleProfileId } from '@buggies/game'
import * as THREE from 'three'

import type { EngineVoice, Sound } from './audio.ts'
import { CarView, profileColor } from './car-view.ts'
import type { ModeView } from './mode.ts'

/** How fast the vehicle turns on the spot, in radians a second. */
export const TURN_RATE = 0.45

/**
 * Where a vehicle starts its turn: side on, nose to the left, so that it is
 * seen in profile first and swings round to face the player next.
 */
export const START_YAW = Math.PI / 2

const FOV = 40
/** How far above level the camera looks down from. */
const ELEVATION = 0.34
/** How much of the frame the vehicle spans at its widest, as it turns. */
const FILL = 0.5
/** How far right of centre the vehicle sits, as a fraction of the frame's width: the panel is on the left. */
const ASIDE = 0.15
/** How hard the engine works on the turntable: idling, with a blip now and then. */
const IDLE_REV = 0.08
const BLIP_REV = 0.5
const BLIP_EVERY = 4.2
const BLIP_LENGTH = 0.45

export interface Framing {
  position: THREE.Vector3
  target: THREE.Vector3
}

/**
 * Where to stand to see something this big, centred on `centre`, turning on
 * the spot: far enough back that its diagonal fits across the frame, above
 * it a little, and looking a little to its left so that it sits clear of
 * the panel.
 */
export function frameShowroom(
  size: THREE.Vector3,
  centre: THREE.Vector3,
  aspect: number,
  out: Framing = { position: new THREE.Vector3(), target: new THREE.Vector3() },
): Framing {
  const across = Math.hypot(size.x, size.z)
  const halfVertical = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
  const halfHorizontal = halfVertical * aspect
  const distance = Math.max(across / (2 * halfHorizontal * FILL), size.y / (2 * halfVertical * FILL))
  out.position.set(centre.x, centre.y + Math.sin(ELEVATION) * distance, centre.z + Math.cos(ELEVATION) * distance)
  // The camera stands toward +Z looking back at the centre, so its right is
  // +X: a target to the left of the vehicle puts the vehicle to the right.
  out.target.set(centre.x - 2 * distance * halfHorizontal * ASIDE, centre.y, centre.z)
  return out
}

export interface ShowroomView extends ModeView {
  /** Put this vehicle on the turntable. */
  show(vehicle: VehicleProfileId): void
  /** What is on the turntable. */
  readonly vehicle: VehicleProfileId | null
}

/**
 * A vehicle on a turntable, in a room of its own: no island behind it, just
 * a floor, a plinth and the sky. It keeps turning whether or not the menu
 * is up, since the menu is what it is there for.
 */
export function createShowroomMode(sound: Sound | null = null): ShowroomView {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#a9cbe6')
  scene.add(new THREE.HemisphereLight('#cfe6ff', '#4a5a3a', 0.9))
  const sun = new THREE.DirectionalLight('#fff4e0', 1.6)
  sun.position.set(-30, 50, 20)
  scene.add(sun)

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(80, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#7a8a62', roughness: 1 }),
  )
  floor.position.y = -0.02
  scene.add(floor)
  const plinthMaterial = new THREE.MeshStandardMaterial({ color: '#2b3440', roughness: 0.8 })
  let plinth: THREE.Mesh | null = null

  const turntable = new THREE.Group()
  scene.add(turntable)
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400)
  const framing: Framing = { position: new THREE.Vector3(), target: new THREE.Vector3() }
  const bounds = new THREE.Box3()
  const size = new THREE.Vector3()
  const centre = new THREE.Vector3()
  let aspect = 1
  let car: CarView | null = null
  let vehicle: VehicleProfileId | null = null
  let voice: EngineVoice | null = null
  let running = 0

  const frame = (): void => {
    if (car === null) return
    // Its extent as it stands, square on: the framing allows for the turn.
    const yaw = turntable.rotation.y
    turntable.rotation.y = 0
    turntable.updateMatrixWorld(true)
    bounds.setFromObject(car.object, true)
    bounds.getSize(size)
    bounds.getCenter(centre)
    turntable.rotation.y = yaw
    frameShowroom(size, centre, aspect, framing)
    camera.position.copy(framing.position)
    camera.lookAt(framing.target)
  }

  return {
    camera,
    scene,
    get vehicle() {
      return vehicle
    },
    show(next) {
      if (next === vehicle) return
      vehicle = next
      voice?.stop()
      voice = sound?.engine(next) ?? null
      running = 0
      car?.dispose()
      plinth?.removeFromParent()
      plinth?.geometry.dispose()
      const tuning = createVehicleTuning(next)
      car = new CarView(next, profileColor(next))
      car.syncDimensions(tuning)
      car.applyRollingWheels(tuning, 0)
      // The chassis frame's origin is the chassis's, which rests above the
      // road by its ride height; the turntable's top is the road.
      car.object.position.y = restingRideHeight(tuning, DEFAULT_WORLD_TUNING.gravity)
      turntable.add(car.object)
      const radius = Math.hypot(tuning.chassisHalfWidth, tuning.chassisHalfLength) + 0.6
      plinth = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.3, 64), plinthMaterial)
      plinth.position.y = -0.15
      scene.add(plinth)
      turntable.rotation.y = START_YAW
      frame()
    },
    resize(next) {
      aspect = next
      camera.aspect = next
      camera.updateProjectionMatrix()
      frame()
    },
    update(dt) {
      turntable.rotation.y += TURN_RATE * dt
      running += dt
      const sinceBlip = running % BLIP_EVERY
      voice?.set(sinceBlip < BLIP_LENGTH ? BLIP_REV * Math.sin((Math.PI * sinceBlip) / BLIP_LENGTH) : IDLE_REV)
    },
    hud() {
      return []
    },
    dispose() {
      voice?.stop()
      car?.dispose()
      plinth?.geometry.dispose()
      plinthMaterial.dispose()
      floor.geometry.dispose()
      ;(floor.material as THREE.Material).dispose()
      scene.clear()
    },
  }
}
