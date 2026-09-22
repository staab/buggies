import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_WORLD_TUNING,
  VEHICLE_PROFILE_IDS,
  WHEEL_CORNERS,
  createVehicleTuning,
  restingRideHeight,
  wheelMountLocal,
} from '@buggies/game'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { describe, expect, it } from 'vitest'

import { CAR_MODELS, fitCarModel, modelCredits, type CarModel } from './car-model.ts'
import { CarView } from './car-view.ts'

const MODELS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models')

/** Read a model off disk. There are no images in Node, so its textures are left out. */
async function loadModel(file: string): Promise<THREE.Group> {
  const loader = new GLTFLoader()
  loader.register(() => ({ name: 'no-textures', loadTexture: async () => null }) as never)
  const buffer = readFileSync(join(MODELS_DIR, file))
  const gltf = await loader.parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    '',
  )
  return gltf.scene
}

const fits = new Map<string, Promise<CarModel>>()

function fitted(profile: (typeof VEHICLE_PROFILE_IDS)[number]): Promise<CarModel> {
  let fit = fits.get(profile)
  if (fit === undefined) {
    fit = loadModel(CAR_MODELS[profile].file).then((scene) =>
      fitCarModel(scene, CAR_MODELS[profile], createVehicleTuning(profile)),
    )
    fits.set(profile, fit)
  }
  return fit
}

describe('car models', () => {
  for (const profile of VEHICLE_PROFILE_IDS) {
    describe(profile, () => {
      it('is a body about the size of the chassis, standing on the road', async () => {
        const tuning = createVehicleTuning(profile)
        const { bounds } = await fitted(profile)
        const size = bounds.getSize(new THREE.Vector3())
        expect(size.x).toBeCloseTo(tuning.chassisHalfWidth * 2, 1)
        expect(size.z).toBeCloseTo(tuning.chassisHalfLength * 2, 1)
        // At least as tall as the chassis box, which stops short of a roof or a turret.
        expect(size.y).toBeGreaterThanOrEqual(tuning.chassisHalfHeight * 2 - 0.01)
        // Its underside is above the road, and the road is as far down as the chassis rests.
        const rideHeight = restingRideHeight(tuning, DEFAULT_WORLD_TUNING.gravity)
        expect(bounds.min.y).toBeGreaterThanOrEqual(-rideHeight - 0.01)
        expect(bounds.min.y).toBeLessThan(0)
      })

      it('has its wheels on the axles, as big as the tuning says', async () => {
        const tuning = createVehicleTuning(profile)
        const { wheels } = await fitted(profile)
        if (profile === 'tank') {
          expect(wheels).toHaveLength(0)
          return
        }
        expect(wheels.length).toBeGreaterThanOrEqual(4)
        const mount = { x: 0, y: 0, z: 0 }
        for (const corner of WHEEL_CORNERS) {
          const matching = wheels.filter((wheel) => wheel.isFront === corner.isFront && wheel.isLeft === corner.isLeft)
          expect(matching.length).toBeGreaterThanOrEqual(1)
          wheelMountLocal(mount, corner, tuning)
          for (const wheel of matching) {
            expect(wheel.radius).toBeCloseTo(tuning.wheelRadius, 1)
            expect(Math.sign(wheel.x)).toBe(Math.sign(mount.x))
            // The tyres may stand wider than the wheels are drawn, but not the other way about.
            expect(Math.abs(wheel.x)).toBeLessThanOrEqual(Math.abs(mount.x) + 0.05)
            expect(Math.abs(wheel.x)).toBeGreaterThan(Math.abs(mount.x) * 0.6)
            // A tandem axle's two wheels sit either side of the one axle the simulation has.
            expect(Math.abs(wheel.z - mount.z)).toBeLessThan(profile === 'semi' && !corner.isFront ? 0.7 : 0.05)
          }
          // The wheel is centred on its hub, so it spins and steers about it.
          const box = new THREE.Box3().setFromObject(matching[0]!.group)
          const centre = box.getCenter(new THREE.Vector3())
          expect(centre.length()).toBeLessThan(0.01)
        }
        const left = wheels.filter((wheel) => wheel.isLeft).length
        expect(left).toBe(wheels.length - left)
      })

      it('draws with the model and follows the simulated wheels', async () => {
        const tuning = createVehicleTuning(profile)
        const model = await fitted(profile)
        const view = new CarView(profile, 0xff0000, model)
        expect(view.object.children.length).toBe(1 + model.wheels.length)
        view.applyRollingWheels(tuning, 1)
        view.object.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(view.object, true)
        const rideHeight = restingRideHeight(tuning, DEFAULT_WORLD_TUNING.gravity)
        // Wheels drawn at a loaded suspension length sit a little into the road; the body is above it.
        expect(box.min.y).toBeGreaterThan(-rideHeight - tuning.suspensionRestLength)
        expect(box.max.y).toBeGreaterThan(0)
        view.dispose()
      })
    })
  }

  it('leaves nothing of a model out that is not a rider or a trailer', async () => {
    const kart = await fitted('goKart')
    expect(kart.body.getObjectByName('character')).toBeUndefined()
    const semi = await fitted('semi')
    expect(semi.body.getObjectByName('Cargo')).toBeUndefined()
    expect(semi.body.getObjectByName('Truck')).toBeDefined()
    // The trailer's axles were not made into wheels either.
    expect(semi.wheels).toHaveLength(6)
  })

  it('credits every maker once, with a licence', () => {
    const credits = modelCredits()
    expect(credits.map((credit) => credit.author)).toEqual(['Kenney', 'Quaternius', 'J-Toastie'])
    for (const credit of credits) {
      expect(credit.licenceUrl).toMatch(/^https:\/\/creativecommons\.org\//)
      expect(credit.url).toMatch(/^https:\/\//)
    }
  })
})
