import type { VehicleState, VehicleTuning } from '@buggies/game'
import * as THREE from 'three'

const CABIN_COLOR = '#1f2933'
const WHEEL_COLOR = '#181818'

const CABIN_WIDTH = 0.78
const CABIN_LENGTH = 0.44
const CABIN_HEIGHT = 0.62
const CABIN_SETBACK = 0.12
const WHEEL_WIDTH = 0.34

/** Downward speed that fully compresses the springs, for the landing squat. */
const HARD_LANDING = 18

/**
 * A vehicle, drawn from its own tuning so the three profiles do not all look
 * the same. Its origin is the contact patch, which is where the simulation
 * puts the vehicle.
 */
export class CarView {
  readonly object = new THREE.Group()

  private readonly body = new THREE.Group()
  private readonly wheels: THREE.Mesh[] = []
  private readonly materials: THREE.Material[] = []
  private readonly tuning: VehicleTuning
  private readonly restingHeight: number

  constructor(tuning: VehicleTuning, color: string) {
    this.tuning = tuning
    this.object.rotation.order = 'YXZ'

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.25,
    })
    const cabinMaterial = new THREE.MeshStandardMaterial({
      color: CABIN_COLOR,
      roughness: 0.3,
      metalness: 0.2,
    })
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: WHEEL_COLOR, roughness: 0.85 })
    this.materials.push(bodyMaterial, cabinMaterial, wheelMaterial)

    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(tuning.width, tuning.height, tuning.length),
      bodyMaterial,
    )
    shell.position.y = tuning.height / 2
    this.body.add(shell)

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(
        tuning.width * CABIN_WIDTH,
        tuning.height * CABIN_HEIGHT,
        tuning.length * CABIN_LENGTH,
      ),
      cabinMaterial,
    )
    cabin.position.set(
      0,
      tuning.height * (1 + CABIN_HEIGHT / 2),
      -tuning.length * CABIN_SETBACK,
    )
    this.body.add(cabin)

    this.restingHeight = tuning.rideHeight
    this.body.position.y = this.restingHeight
    this.object.add(this.body)

    const wheel = new THREE.CylinderGeometry(
      tuning.wheelRadius,
      tuning.wheelRadius,
      tuning.wheelRadius * 2 * WHEEL_WIDTH,
      16,
    ).rotateZ(Math.PI / 2)
    for (const [x, z] of [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ] as const) {
      const mesh = new THREE.Mesh(wheel, wheelMaterial)
      mesh.rotation.order = 'YXZ'
      mesh.position.set(
        (x * tuning.trackWidth) / 2,
        tuning.wheelRadius,
        (z * tuning.wheelBase) / 2,
      )
      this.wheels.push(mesh)
      this.object.add(mesh)
    }
  }

  sync(state: VehicleState): void {
    const { position, pitch, heading, roll } = state
    this.object.position.set(position.x, position.y, position.z)
    this.object.rotation.set(pitch, heading, roll)

    // The springs only show themselves on the way down, which is the one time
    // a body that never moves on its wheels looks wrong.
    const squat = state.grounded
      ? Math.min(Math.max(-state.velocity.y / HARD_LANDING, 0), 1) * this.tuning.suspensionTravel
      : 0
    this.body.position.y = this.restingHeight - squat

    for (const [index, mesh] of this.wheels.entries()) {
      mesh.rotation.x = state.wheelSpin
      mesh.rotation.y = index < 2 ? state.steerAngle : 0
    }
  }

  dispose(): void {
    this.object.removeFromParent()
    this.object.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose()
    })
    for (const material of this.materials) material.dispose()
  }
}
