import {
  DEFAULT_WORLD_TUNING,
  VEHICLE_PROFILE_IDS,
  createVehicleTuning,
  restingRideHeight,
  type VehicleProfileId,
  type VehicleTuning,
} from '@buggies/game'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** Who made a model, for the credits. */
export interface ModelCredit {
  title: string
  author: string
  url: string
  licence: string
  licenceUrl: string
}

/** A vehicle's model: which file, how big a unit of it is, and what in it is a wheel. */
export interface CarModelSpec {
  /** Where the file is, under the models directory. */
  file: string
  /** Metres per unit of the model. */
  scale: number
  /** Nodes left out: a rider, a trailer. */
  hidden: readonly string[]
  /** Which nodes are wheels. A node holding a whole axle is split into its two wheels. */
  wheels: RegExp
  credit: ModelCredit
}

const KENNEY: ModelCredit = {
  title: 'Car Kit',
  author: 'Kenney',
  url: 'https://kenney.nl/assets/car-kit',
  licence: 'CC0',
  licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
}

const KENNEY_WHEELS = /^wheel-/

/**
 * Every vehicle's model. All are drawn with their front toward the model's
 * +Z, their left toward +X and their wheels on the ground at y = 0, which is
 * how each of these files is built. The scales put the kit's chibi bodies at
 * something like the size of the real thing, and the vehicle tunings are
 * measured off the models at these scales.
 */
export const CAR_MODELS: Readonly<Record<VehicleProfileId, CarModelSpec>> = Object.freeze({
  raceCar: { file: 'kenney/race.glb', scale: 1.55, hidden: [], wheels: KENNEY_WHEELS, credit: KENNEY },
  police: { file: 'kenney/police.glb', scale: 1.45, hidden: [], wheels: KENNEY_WHEELS, credit: KENNEY },
  firetruck: { file: 'kenney/firetruck.glb', scale: 1.7, hidden: [], wheels: KENNEY_WHEELS, credit: KENNEY },
  pickup: { file: 'kenney/truck.glb', scale: 1.5, hidden: [], wheels: KENNEY_WHEELS, credit: KENNEY },
  sportsCar: { file: 'kenney/sedan-sports.glb', scale: 1.6, hidden: [], wheels: KENNEY_WHEELS, credit: KENNEY },
  smallCar: { file: 'kenney/hatchback-sports.glb', scale: 1.15, hidden: [], wheels: KENNEY_WHEELS, credit: KENNEY },
  tank: {
    file: 'quaternius-tank.glb',
    scale: 1.35,
    hidden: [],
    // Its wheels are part of the hull, and its tracks would not turn anyway.
    wheels: /^$/,
    credit: {
      title: 'Tank',
      author: 'Quaternius',
      url: 'https://poly.pizza/m/Dc4k4CooN3',
      licence: 'CC0',
      licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    },
  },
  ambulance: { file: 'kenney/ambulance.glb', scale: 1.6, hidden: [], wheels: KENNEY_WHEELS, credit: KENNEY },
  semi: {
    file: 'jtoastie-cargo-truck.glb',
    scale: 1.55,
    // The tractor unit alone: the trailer and its running gear stay behind.
    hidden: ['Cargo', 'CargoHoldThing', 'CargoTires01', 'CargoTires02'],
    wheels: /Tires/,
    credit: {
      title: 'Cargo Truck',
      author: 'J-Toastie',
      url: 'https://poly.pizza/m/Fy3WI3uXNQ',
      licence: 'CC BY 3.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
    },
  },
  goKart: { file: 'kenney/kart-oobi.glb', scale: 1.3, hidden: ['character'], wheels: KENNEY_WHEELS, credit: KENNEY },
})

/** One of a model's wheels, ready to be drawn where the simulation has it. */
export interface WheelTemplate {
  /** The wheel, centred on its hub, in the chassis frame's orientation and scale. */
  group: THREE.Group
  /** Where its hub is across the chassis. */
  x: number
  /** Where its hub is along the chassis. */
  z: number
  radius: number
  isFront: boolean
  isLeft: boolean
}

/** A model fitted to a vehicle: the body in the chassis frame, and its wheels apart from it. */
export interface CarModel {
  /** The body, less its wheels, placed so that the chassis frame's origin is the chassis's. */
  body: THREE.Group
  wheels: readonly WheelTemplate[]
  /** The body's extent in the chassis frame. */
  bounds: THREE.Box3
}

/** A wheel node this much wider than it is tall is a whole axle, both wheels in one. */
const AXLE_ASPECT = 2.2

const point = new THREE.Vector3()

/** The extent of every vertex of the meshes under `root` that `include` admits, in world space. */
function meshBounds(root: THREE.Object3D, include: (mesh: THREE.Mesh) => boolean): THREE.Box3 {
  const box = new THREE.Box3()
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !include(node)) return
    const position = (node.geometry as THREE.BufferGeometry).getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      box.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld))
    }
  })
  return box
}

function within(node: THREE.Object3D, ancestors: readonly THREE.Object3D[]): boolean {
  for (let up: THREE.Object3D | null = node; up !== null; up = up.parent) {
    if (ancestors.includes(up)) return true
  }
  return false
}

/** The nodes named, wherever they are in the tree. */
function nodesNamed(root: THREE.Object3D, matches: (name: string) => boolean): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  root.traverse((node) => {
    if (node !== root && matches(node.name)) found.push(node)
  })
  return found
}

/**
 * Two geometries from one, by which side of x = 0 each triangle is on: an
 * axle modelled as a single mesh becomes its left wheel and its right.
 */
function splitAcross(geometry: THREE.BufferGeometry): [left: THREE.BufferGeometry, right: THREE.BufferGeometry] {
  const source = geometry.index === null ? geometry : geometry.toNonIndexed()
  const position = source.getAttribute('position')
  const sides: number[][] = [[], []]
  for (let vertex = 0; vertex < position.count; vertex += 3) {
    const centre = position.getX(vertex) + position.getX(vertex + 1) + position.getX(vertex + 2)
    sides[centre < 0 ? 0 : 1]!.push(vertex, vertex + 1, vertex + 2)
  }
  const halves = sides.map((vertices) => {
    const half = new THREE.BufferGeometry()
    for (const [name, attribute] of Object.entries(source.attributes)) {
      const from = attribute as THREE.BufferAttribute
      const itemSize = from.itemSize
      const array = new Float32Array(vertices.length * itemSize)
      vertices.forEach((vertex, at) => {
        for (let component = 0; component < itemSize; component++) {
          array[at * itemSize + component] = from.array[vertex * itemSize + component]!
        }
      })
      half.setAttribute(name, new THREE.BufferAttribute(array, itemSize, from.normalized))
    }
    return half
  })
  return [halves[0]!, halves[1]!]
}

/** The meshes under a wheel node, their geometry baked into the chassis frame. */
function bakeWheelMeshes(node: THREE.Object3D, toChassis: THREE.Matrix4): THREE.Mesh[] {
  const baked: THREE.Mesh[] = []
  const bake = new THREE.Matrix4()
  node.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    bake.multiplyMatrices(toChassis, child.matrixWorld)
    const geometry = (child.geometry as THREE.BufferGeometry).clone().applyMatrix4(bake)
    baked.push(new THREE.Mesh(geometry, child.material))
  })
  return baked
}

/** A wheel from its baked meshes: the meshes centred on the hub, and where the hub was. */
function wheelFrom(meshes: THREE.Mesh[]): Omit<WheelTemplate, 'isFront' | 'isLeft'> {
  const box = new THREE.Box3()
  for (const mesh of meshes) {
    mesh.geometry.computeBoundingBox()
    box.union(mesh.geometry.boundingBox!)
  }
  const centre = box.getCenter(new THREE.Vector3())
  const group = new THREE.Group()
  for (const mesh of meshes) {
    mesh.geometry.translate(-centre.x, -centre.y, -centre.z)
    mesh.castShadow = true
    group.add(mesh)
  }
  return { group, x: centre.x, z: centre.z, radius: (box.max.y - box.min.y) / 2 }
}

/**
 * Fit a loaded model to a vehicle. The body is put in the chassis frame:
 * front toward -Z, left toward -X, the origin where the chassis's is, and
 * the ground under its wheels as far down as the chassis rests above the
 * road. The wheels are taken off it, each centred on its hub, to be drawn
 * where the simulation has them. The model is taken apart in place.
 */
export function fitCarModel(scene: THREE.Object3D, spec: CarModelSpec, tuning: VehicleTuning): CarModel {
  scene.updateMatrixWorld(true)
  for (const node of nodesNamed(scene, (name) => spec.hidden.includes(name))) node.removeFromParent()

  const wheelNodes = nodesNamed(scene, (name) => spec.wheels.test(name)).filter(
    (node, _, all) => !all.some((other) => other !== node && within(node, [other])),
  )
  const body = meshBounds(scene, (mesh) => !within(mesh, wheelNodes))
  const ground = Math.min(body.min.y, meshBounds(scene, (mesh) => within(mesh, wheelNodes)).min.y)
  const centre = body.getCenter(new THREE.Vector3())
  const rideHeight = restingRideHeight(tuning, DEFAULT_WORLD_TUNING.gravity)

  // Model to chassis frame: turned about, scaled, the body centred and the
  // ground put where the road is under a chassis at rest.
  const { scale } = spec
  const toChassis = new THREE.Matrix4().set(
    -scale, 0, 0, scale * centre.x,
    0, scale, 0, -scale * ground - rideHeight,
    0, 0, -scale, scale * centre.z,
    0, 0, 0, 1,
  )

  const loose: Omit<WheelTemplate, 'isFront' | 'isLeft'>[] = []
  for (const node of wheelNodes) {
    const meshes = bakeWheelMeshes(node, toChassis)
    const box = new THREE.Box3()
    for (const mesh of meshes) {
      mesh.geometry.computeBoundingBox()
      box.union(mesh.geometry.boundingBox!)
    }
    if (box.max.x - box.min.x > AXLE_ASPECT * (box.max.y - box.min.y)) {
      const sides = meshes.map((mesh) => splitAcross(mesh.geometry))
      loose.push(wheelFrom(sides.map(([left], at) => new THREE.Mesh(left, meshes[at]!.material))))
      loose.push(wheelFrom(sides.map(([, right], at) => new THREE.Mesh(right, meshes[at]!.material))))
      for (const mesh of meshes) mesh.geometry.dispose()
    } else {
      loose.push(wheelFrom(meshes))
    }
    node.removeFromParent()
  }
  const midZ = loose.reduce((sum, wheel) => sum + wheel.z, 0) / Math.max(loose.length, 1)
  const wheels = loose.map((wheel) => ({ ...wheel, isFront: wheel.z < midZ, isLeft: wheel.x < 0 }))

  const bodyGroup = new THREE.Group()
  bodyGroup.matrix.copy(toChassis)
  bodyGroup.matrix.decompose(bodyGroup.position, bodyGroup.quaternion, bodyGroup.scale)
  bodyGroup.add(scene)
  bodyGroup.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true
      node.receiveShadow = true
    }
  })
  return { body: bodyGroup, wheels, bounds: body.applyMatrix4(toChassis) }
}

const fitted = new Map<VehicleProfileId, CarModel>()

/** The model a vehicle is drawn with, once loaded; null, and it is drawn as boxes. */
export function carModelFor(profile: VehicleProfileId): CarModel | null {
  return fitted.get(profile) ?? null
}

/**
 * Load every vehicle's model from under `base` and fit it to its tuning. A
 * model that will not load is reported and left out, and that vehicle is
 * drawn as boxes instead: a missing file should not keep anyone off the road.
 */
export async function loadCarModels(base = '/models/'): Promise<void> {
  const loader = new GLTFLoader()
  await Promise.all(
    VEHICLE_PROFILE_IDS.map(async (profile) => {
      const spec = CAR_MODELS[profile]
      try {
        const gltf = await loader.loadAsync(base + spec.file)
        fitted.set(profile, fitCarModel(gltf.scene, spec, createVehicleTuning(profile)))
      } catch (error) {
        console.warn(`the ${profile} model did not load, so it is drawn as boxes:`, error)
      }
    }),
  )
}

/** The people whose models these are, each once, for the credits. */
export function modelCredits(): ModelCredit[] {
  const credits: ModelCredit[] = []
  for (const profile of VEHICLE_PROFILE_IDS) {
    const { credit } = CAR_MODELS[profile]
    if (!credits.includes(credit)) credits.push(credit)
  }
  return credits
}
