import { ROBOT_EYES, ROBOT_SIZE, type Robot } from '@buggies/game'
import * as THREE from 'three'

/** Where the robots are: an arena, or a mirror of one. */
export interface RobotSource {
  readonly robots: readonly Robot[]
}

/** How bright a robot's eyes are, idle and burning. */
const EYES_IDLE = 0.6
const EYES_BURNING = 3

function paint(color: string, options: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.5, ...options })
}

/**
 * A robot: a boxy gray body on two treads, a head on a short neck with two
 * red eyes glowing in it, and an antenna. It stands on the ground at y = 0,
 * its face toward -Z, the way the cars face, and its eyes at `ROBOT_EYES`.
 */
export function buildRobot(): { model: THREE.Group; eyes: THREE.MeshStandardMaterial } {
  const model = new THREE.Group()
  const { halfWidth, halfHeight, halfDepth } = ROBOT_SIZE
  const steel = paint('#8c949c')
  const dark = paint('#3a3f45', { roughness: 0.8 })
  const eyes = new THREE.MeshStandardMaterial({ color: '#ff2020', emissive: '#ff2020', emissiveIntensity: EYES_IDLE })
  const box = (size: [number, number, number], at: [number, number, number], material: THREE.Material): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
    mesh.position.set(...at)
    mesh.castShadow = true
    model.add(mesh)
  }
  // Two treads, the body over them, and its shoulders.
  for (const side of [-1, 1]) box([0.7, 1.1, halfDepth * 2], [side * (halfWidth - 0.35), 0.55, 0], dark)
  box([halfWidth * 1.7, halfHeight * 0.9, halfDepth * 1.6], [0, 1.1 + halfHeight * 0.45, 0], steel)
  for (const side of [-1, 1]) box([0.5, 1.6, 0.5], [side * (halfWidth * 0.95), 2.4, 0], dark)
  // The neck and the head, with the eyes in its face.
  box([0.5, 0.4, 0.5], [0, 2 * halfHeight - 1.2, 0], dark)
  const head = 2 * halfHeight - 0.5
  box([1.6, 1.1, 1.3], [0, head, 0], steel)
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), eyes)
    eye.position.set(side * 0.38, ROBOT_EYES, -0.66)
    model.add(eye)
  }
  box([0.06, 0.8, 0.06], [0.5, head + 0.95, 0], dark)
  return { model, eyes }
}

interface Shown {
  model: THREE.Group
  eyes: THREE.MeshStandardMaterial
}

/** The robots, each drawn where the simulation has it, its eyes blazing while it burns a car. */
export class RobotsView {
  readonly object = new THREE.Group()

  private readonly source: RobotSource
  private readonly shown = new Map<number, Shown>()

  constructor(source: RobotSource) {
    this.source = source
    this.update()
  }

  update(): void {
    for (const robot of this.source.robots) {
      let view = this.shown.get(robot.id)
      if (view === undefined) {
        view = buildRobot()
        this.shown.set(robot.id, view)
        this.object.add(view.model)
      }
      view.model.position.set(robot.position.x, robot.position.y, robot.position.z)
      view.model.rotation.set(0, robot.heading, 0)
      view.eyes.emissiveIntensity = robot.beamTicks > 0 ? EYES_BURNING : EYES_IDLE
    }
  }

  dispose(): void {
    this.object.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose()
        ;(node.material as THREE.Material).dispose()
      }
    })
    this.object.removeFromParent()
    this.object.clear()
    this.shown.clear()
  }
}
