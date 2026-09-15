import { clamp, damp, moveTowards, unlerp, vec3, type Vec3 } from '@buggies/physics'

import { groundAt, waterAt, type DriveSurface } from './surface.ts'
import type { VehicleTuning } from './tuning.ts'

/** Player intent for a single simulation step. */
export interface VehicleInput {
  /** Forward pedal, 0..1. */
  throttle: number
  /** Brake pedal, 0..1. It becomes reverse once the vehicle has stopped. */
  brake: number
  /** Steering, -1 (left) to 1 (right). */
  steer: number
  handbrake: boolean
}

export const NEUTRAL_INPUT: Readonly<VehicleInput> = Object.freeze({
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
})

/**
 * Full simulation state of one vehicle. Plain data so it can be snapshotted,
 * sent and replayed.
 */
export interface VehicleState {
  /** The contact patch: where the wheels meet whatever is under them. */
  position: Vec3
  velocity: Vec3
  /** Yaw in radians. Zero points the nose down +Z, matching the map's roads. */
  heading: number
  yawRate: number
  /** Where the steering rack has actually got to, which trails the input. */
  steerAngle: number
  /** Attitude the ground under the four wheels puts the body in. */
  pitch: number
  roll: number
  wheelSpin: number
  grounded: boolean
  submerged: boolean
  /** Read by the view and the HUD; the step recomputes them from scratch. */
  speed: number
  forwardSpeed: number
  /** Sideways speed across the tyres. Past `slipTolerance` this is a slide. */
  slip: number
}

/**
 * Heavier than life. Real gravity leaves an arcade car floating through jumps
 * and vague on its springs; this lands it quickly and keeps it planted.
 */
const GRAVITY = 14

/** Ramps cannot throw a vehicle faster than this, so bumps stay bumps. */
const MAX_LAUNCH_SPEED = 12

/** How quickly the wheels take up the ground's own rise and fall. */
const SUSPENSION_RATE = 15

/** How quickly a vehicle in the air comes back to level, ready to land. */
const AIR_LEVEL_RATE = 2.5

/** How quickly the body settles onto the slope it is standing on. */
const ATTITUDE_RATE = 14

/** Forward speed below which the brake pedal means reverse. */
const REVERSE_THRESHOLD = 0.6

/** What the handbrake does lengthways, as a share of the brakes. */
const HANDBRAKE_BRAKING = 0.3

/** How much of a tyre's grip full throttle or full braking spends. */
const LOAD_SHARE = 0.35

/**
 * What the nose can do once the back has gone, as a multiple of the grip it
 * would have had. Losing the rear has to buy yaw rather than cost it, and the
 * arithmetic will not do that on its own: less grip means a lower cap on every
 * term the yaw is built from.
 */
const OVERSTEER_GAIN = 1.4

/**
 * Steepest ground the wheels can still find drive on, as the upward part of
 * its normal. Anything steeper is a cliff: it is climbed by nothing and
 * stops whatever drives into it.
 */
const MIN_CLIMB_NORMAL = 0.64

/** How deep the contact patch goes before the vehicle counts as swimming. */
const WADE_DEPTH = 0.6

/** Water slows everything in it and holds it up; the lift has to beat gravity. */
const WATER_DRAG = 1.4
const WATER_LIFT = 22
const WATER_DRIVE = 0.12

/** How fast a floating vehicle can swing its nose round, in radians a second. */
const SWIM_TURN = 0.7

/** What the four wheels find under them, and the attitude that puts the body in. */
interface Contact {
  support: number
  pitch: number
  roll: number
  nx: number
  ny: number
  nz: number
}

/**
 * Read the ground under all four wheels rather than under the middle: a
 * vehicle straddling a rut rides over it, and the slope across the wheels is
 * what leans the body.
 */
function readContact(
  surface: DriveSurface,
  position: Vec3,
  tuning: VehicleTuning,
  fx: number,
  fz: number,
  rx: number,
  rz: number,
): Contact {
  const base = tuning.wheelBase / 2
  const track = tuning.trackWidth / 2
  const { x, y, z } = position
  const frontLeft = groundAt(surface, x + fx * base - rx * track, z + fz * base - rz * track, y)
  const frontRight = groundAt(surface, x + fx * base + rx * track, z + fz * base + rz * track, y)
  const rearLeft = groundAt(surface, x - fx * base - rx * track, z - fz * base - rz * track, y)
  const rearRight = groundAt(surface, x - fx * base + rx * track, z - fz * base + rz * track, y)

  const alongSlope = (frontLeft + frontRight - rearLeft - rearRight) / (2 * tuning.wheelBase)
  const acrossSlope = (frontRight + rearRight - frontLeft - rearLeft) / (2 * tuning.trackWidth)
  const nx = -fx * alongSlope - rx * acrossSlope
  const nz = -fz * alongSlope - rz * acrossSlope
  const scale = 1 / Math.hypot(nx, 1, nz)

  return {
    support: (frontLeft + frontRight + rearLeft + rearRight) / 4,
    pitch: -Math.atan(alongSlope),
    roll: Math.atan(acrossSlope),
    nx: nx * scale,
    ny: scale,
    nz: nz * scale,
  }
}

/**
 * Sideways grip against how fast the tyres are already sliding. Full grip up
 * to `slipTolerance`, then a fade to `driftGrip` — the fade is what lets a
 * slide start, and the tail it settles on is what lets one be held.
 */
export function lateralGrip(slip: number, tuning: VehicleTuning): number {
  const over = Math.abs(slip) - tuning.slipTolerance
  if (over <= 0) return tuning.gripLimit
  const fade = Math.min(over / Math.max(tuning.slipRange, 1e-6), 1)
  return tuning.gripLimit + (tuning.driftGrip - tuning.gripLimit) * fade
}

export function createVehicle(position: Vec3 = vec3(), heading = 0): VehicleState {
  return {
    position,
    velocity: vec3(),
    heading,
    yawRate: 0,
    steerAngle: 0,
    pitch: 0,
    roll: 0,
    wheelSpin: 0,
    grounded: true,
    submerged: false,
    speed: 0,
    forwardSpeed: 0,
    slip: 0,
  }
}

/**
 * Advance one vehicle by a fixed step. Pure and free of wall-clock time, so
 * the same inputs always produce the same state on every peer.
 */
export function stepVehicle(
  state: VehicleState,
  input: VehicleInput,
  dt: number,
  surface: DriveSurface,
  tuning: VehicleTuning,
): VehicleState {
  const throttle = clamp(input.throttle, 0, 1)
  const brake = clamp(input.brake, 0, 1)
  // The nose is local +Z and up is +Y, which puts the vehicle's own right at
  // local -X: a rising heading swings the nose to its left. Steering input is
  // the player's, where right is positive, so it is turned round once here and
  // every angle after it — the rack, the yaw, the wheels that get drawn —
  // stays in that one frame.
  const steer = -clamp(input.steer, -1, 1)

  const fx = Math.sin(state.heading)
  const fz = Math.cos(state.heading)
  const rx = fz
  const rz = -fx

  const contact = readContact(surface, state.position, tuning, fx, fz, rx, rz)
  const climbable = contact.ny >= MIN_CLIMB_NORMAL

  let forwardSpeed = state.velocity.x * fx + state.velocity.z * fz
  let lateralSpeed = state.velocity.x * rx + state.velocity.z * rz
  let vy = state.velocity.y

  const planarSpeed = Math.hypot(forwardSpeed, lateralSpeed)
  const lock =
    tuning.maxSteerAngle *
    (1 - (1 - tuning.steerAtMaxSpeed) * unlerp(planarSpeed, 0, tuning.steerFalloffSpeed))
  const steerAngle = moveTowards(state.steerAngle, steer * lock, tuning.steerRate * dt)

  let yawRate = state.yawRate
  let pitch = state.pitch
  let roll = state.roll
  let lean = 0

  if (state.grounded) {
    const drive = state.submerged ? WATER_DRIVE : 1
    let along = 0
    if (climbable) {
      if (throttle > 0) {
        const headroom = Math.max(0, 1 - Math.max(forwardSpeed, 0) / tuning.maxSpeed)
        along += throttle * tuning.enginePower * headroom * drive
      }
      if (brake > 0) {
        if (forwardSpeed > REVERSE_THRESHOLD) {
          along -= brake * tuning.brakePower
        } else {
          const headroom = Math.max(0, 1 - Math.max(-forwardSpeed, 0) / tuning.reverseMaxSpeed)
          along -= brake * tuning.enginePower * tuning.reversePower * headroom * drive
        }
      }
      if (input.handbrake) along -= Math.sign(forwardSpeed) * tuning.brakePower * HANDBRAKE_BRAKING
    }

    // Tyres only have so much to give, and what goes into driving or stopping
    // is not there for holding a line. This is the whole of why lifting off or
    // trailing the brake rotates a vehicle into a corner.
    const lengthways = clamp(
      Math.abs(along) / Math.max(tuning.enginePower, tuning.brakePower),
      0,
      1,
    )
    // How hard the tyres can still hold, and how far from planted that leaves
    // them. A steady corner is bounded by the first; every slide is the second
    // feeding back into the yaw.
    const holdGrip =
      lateralGrip(lateralSpeed, tuning) *
      (1 - LOAD_SHARE * lengthways) *
      (input.handbrake ? tuning.handbrakeGrip : 1)
    const bite = holdGrip / tuning.gripLimit
    const loose = clamp(1 - bite, 0, 1)

    // Sliding tyres drive and stop less well, but what the circle spends
    // sideways is not taken off them twice.
    along *= lateralGrip(lateralSpeed, tuning) / tuning.gripLimit
    along -= tuning.rollingResistance * forwardSpeed
    along -= tuning.dragCoefficient * forwardSpeed * Math.abs(forwardSpeed)

    const stopping = brake > 0 && forwardSpeed > REVERSE_THRESHOLD
    const rolled = forwardSpeed + along * dt
    forwardSpeed = stopping && rolled < 0 ? 0 : rolled

    // Never pull harder than it takes to stop the slide this step, or the
    // tyres overshoot and the car wobbles where it should sit still.
    const hold = Math.min(holdGrip, Math.abs(lateralSpeed) / dt)
    lateralSpeed -= Math.sign(lateralSpeed) * hold * dt

    // A steered wheel asks for far more yaw than the tyres can deliver at
    // speed, so the geometry is capped — at full lock, at exactly the edge of
    // grip. Anything short of full lock is settled and stays settled; at the
    // stop, whatever the throttle or the handbrake has taken off the tyres is
    // enough to start the slide, and from there the cap runs away with it.
    const geometric = (forwardSpeed / tuning.wheelBase) * Math.tan(steerAngle)
    const carrying = Math.max(Math.abs(forwardSpeed), 1)
    const edge = tuning.gripLimit / carrying
    const sliding = (tuning.gripLimit * OVERSTEER_GAIN) / carrying
    const yawLimit = edge + (sliding - edge) * loose
    const target = climbable ? clamp(geometric, -yawLimit, yawLimit) : 0
    yawRate = damp(yawRate, target, tuning.yawResponse, dt)

    // The body leans on the corner it is actually carrying, out of the turn.
    lean = clamp((forwardSpeed * yawRate) / tuning.gripLimit, -1, 1)

    pitch = damp(pitch, contact.pitch, ATTITUDE_RATE, dt)
    roll = damp(roll, contact.roll, ATTITUDE_RATE, dt)
  } else if (state.submerged) {
    // Afloat, with the wheels off the bottom. Barely any of the engine reaches
    // the water, but enough to paddle back to a shore: a vehicle that drops in
    // and can never get out again is a vehicle the map has swallowed.
    vy -= GRAVITY * dt
    forwardSpeed += (throttle - brake) * tuning.enginePower * WATER_DRIVE * dt
    yawRate = damp(yawRate, steer * SWIM_TURN, tuning.yawResponse, dt)
    pitch = damp(pitch, 0, AIR_LEVEL_RATE, dt)
    roll = damp(roll, 0, AIR_LEVEL_RATE, dt)
  } else {
    vy -= GRAVITY * dt
    yawRate = damp(yawRate, steer * tuning.airSteer, tuning.yawResponse, dt)
    forwardSpeed -= tuning.dragCoefficient * forwardSpeed * Math.abs(forwardSpeed) * dt
    lateralSpeed -= tuning.dragCoefficient * lateralSpeed * Math.abs(lateralSpeed) * dt
    pitch = damp(pitch, 0, AIR_LEVEL_RATE, dt)
    roll = damp(roll, 0, AIR_LEVEL_RATE, dt)
  }

  const heading = state.heading + yawRate * dt

  let vx = forwardSpeed * fx + lateralSpeed * rx
  let vz = forwardSpeed * fz + lateralSpeed * rz
  if (state.grounded) {
    // Gravity along the slope, which is what makes a hill worth pointing down.
    vx += GRAVITY * contact.ny * contact.nx * dt
    vz += GRAVITY * contact.ny * contact.nz * dt
  }

  const position = vec3(
    state.position.x + vx * dt,
    state.position.y + vy * dt,
    state.position.z + vz * dt,
  )

  const hx = Math.sin(heading)
  const hz = Math.cos(heading)
  const landed = readContact(surface, position, tuning, hx, hz, hz, -hx)

  // Vertical motion is the ground's, for as long as the wheels can keep up
  // with it. Taking it from how fast the ground itself is climbing along the
  // path travelled — rather than from how far the wheels had to be pushed back
  // out this step — is what keeps a steady climb steady: the second figure is
  // zero on every other frame, and a vehicle reading it drops in and out of
  // contact all the way up the hill.
  const climbRate = (landed.support - contact.support) / dt
  const gap = position.y - landed.support
  const grounded = gap <= tuning.groundStick
  if (gap <= 0) {
    // Standing on it. Vertical motion follows the ground's own — but eased
    // into, not matched outright. The ground is a grid of flat cells, so its
    // slope jumps at every boundary; a vehicle taking those jumps as its own
    // gets flung off each one, and spends a fifth of an ordinary drive down a
    // road in the air. Easing is what a spring does, and it leaves a real
    // ramp, which climbs the same way for many steps together, still throwing.
    position.y = landed.support
    vy = state.grounded
      ? damp(vy, clamp(climbRate, -MAX_LAUNCH_SPEED, MAX_LAUNCH_SPEED), SUSPENSION_RATE, dt)
      : 0
  } else if (grounded) {
    // Off it, but not yet clear of it: the springs are still reaching, and
    // weight is still pulling the vehicle back down onto them. Anything that
    // out-pulls gravity from here — a ramp, or water — takes the wheels with
    // it rather than being quietly clamped back to the ground.
    vy -= GRAVITY * dt
  }

  if (grounded && landed.ny < MIN_CLIMB_NORMAL) {
    // A cliff is a wall: whatever drives at it stops going that way.
    const slopeLength = Math.hypot(landed.nx, landed.nz)
    if (slopeLength > 1e-6) {
      const ux = landed.nx / slopeLength
      const uz = landed.nz / slopeLength
      const uphill = vx * ux + vz * uz
      if (uphill < 0) {
        vx -= ux * uphill
        vz -= uz * uphill
      }
    }
  }

  const water = waterAt(surface, position.x, position.z)
  const depth = water - position.y
  const submerged = depth > WADE_DEPTH
  if (depth > 0) {
    const remaining = Math.exp(-WATER_DRAG * dt)
    vx *= remaining
    vz *= remaining
    vy *= remaining
    vy += clamp(depth - WADE_DEPTH, 0, 1) * WATER_LIFT * dt
  }

  return {
    position,
    velocity: vec3(vx, vy, vz),
    heading,
    yawRate,
    steerAngle,
    pitch,
    roll: roll + tuning.bodyLean * lean,
    wheelSpin: state.wheelSpin + (forwardSpeed / tuning.wheelRadius) * dt,
    grounded,
    submerged,
    speed: Math.hypot(vx, vy, vz),
    forwardSpeed,
    slip: Math.abs(lateralSpeed),
  }
}

export {
  createDriveSurface,
  flatDriveSurface,
  groundAt,
  waterAt,
  type DriveSurface,
} from './surface.ts'
export {
  DEFAULT_VEHICLE,
  VEHICLE_LABELS,
  VEHICLE_PROFILES,
  VEHICLE_PROFILE_IDS,
  vehicleTuning,
  type VehicleProfileId,
  type VehicleTuning,
} from './tuning.ts'
