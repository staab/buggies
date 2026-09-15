import { FIXED_TIMESTEP } from '@buggies/physics'
import { flatHeightfield } from '@buggies/terrain'
import {
  NEUTRAL_INPUT,
  VEHICLE_LABELS,
  VEHICLE_PROFILE_IDS,
  createVehicle,
  flatDriveSurface,
  stepVehicle,
  vehicleTuning,
  type VehicleInput,
  type VehicleProfileId,
  type VehicleState,
} from '@buggies/vehicle'

const dt = FIXED_TIMESTEP
const surface = flatDriveSurface(flatHeightfield(1024, 1024, 8))

function start(): VehicleState {
  return createVehicle({ x: 4000, y: 0, z: 200 })
}

/** Drive on for `seconds`, easing the throttle to hold `target` once reached. */
function drive(
  state: VehicleState,
  profile: VehicleProfileId,
  input: Partial<VehicleInput>,
  seconds: number,
  target = Infinity,
): VehicleState {
  const tuning = vehicleTuning(profile)
  for (let i = 0; i < seconds / dt; i++) {
    const throttle = state.forwardSpeed < target ? 1 : 0
    state = stepVehicle(state, { ...NEUTRAL_INPUT, throttle, ...input }, dt, surface, tuning)
  }
  return state
}

/** Get up to `speed`, or as near as this vehicle ever gets. */
function reach(profile: VehicleProfileId, speed: number): VehicleState {
  const tuning = vehicleTuning(profile)
  let state = start()
  for (let i = 0; i < 60 / dt && state.forwardSpeed < speed; i++) {
    state = stepVehicle(state, { ...NEUTRAL_INPUT, throttle: 1 }, dt, surface, tuning)
  }
  return state
}

const pad = (value: number, width: number, places = 1) => value.toFixed(places).padStart(width)

console.log('profile  top m/s  0-100km/h  brake m  turn@20m  slip@20  drift@20')
for (const profile of VEHICLE_PROFILE_IDS) {
  const tuning = vehicleTuning(profile)

  let flat = start()
  let sprint = 0
  let reached = NaN
  for (let i = 0; i < 40 / dt; i++) {
    flat = stepVehicle(flat, { ...NEUTRAL_INPUT, throttle: 1 }, dt, surface, tuning)
    if (Number.isNaN(reached) && flat.forwardSpeed >= 27.8) reached = i * dt
  }

  let stopping = flat
  const from = stopping.position.z
  while (stopping.forwardSpeed > 0.5) {
    stopping = stepVehicle(stopping, { ...NEUTRAL_INPUT, brake: 1 }, dt, surface, tuning)
  }
  sprint = stopping.position.z - from

  const turn = drive(reach(profile, 20), profile, { steer: 1 }, 4, 20)
  const radius = Math.abs(turn.forwardSpeed / turn.yawRate)
  const drift = Math.atan2(turn.slip, Math.abs(turn.forwardSpeed)) * (180 / Math.PI)

  console.log(
    `${profile.padEnd(7)} ${pad(flat.forwardSpeed, 8)} ${pad(reached, 10, 2)}s ${pad(sprint, 8)} ` +
      `${pad(radius, 9)} ${pad(turn.slip, 8, 2)} ${pad(drift, 8, 0)}deg`,
  )
}

console.log('\nhandbrake flick at 20 m/s, held one second:')
for (const profile of VEHICLE_PROFILE_IDS) {
  const state = drive(reach(profile, 20), profile, { steer: 1, handbrake: true }, 1, 0)
  const drift = Math.atan2(state.slip, Math.abs(state.forwardSpeed)) * (180 / Math.PI)
  console.log(
    `  ${VEHICLE_LABELS[profile].padEnd(6)} yaw ${pad(state.yawRate, 5, 2)} rad/s  slip ${pad(state.slip, 5)}  ` +
      `drift ${pad(drift, 3, 0)}deg  speed ${pad(state.forwardSpeed, 5)}`,
  )
}

console.log('\ncatching the slide: full lock one second, then counter-steer one second:')
for (const profile of VEHICLE_PROFILE_IDS) {
  const slid = drive(reach(profile, 25), profile, { steer: 1, handbrake: true }, 1, 25)
  const caught = drive(slid, profile, { steer: -1 }, 1, 25)
  console.log(
    `  ${VEHICLE_LABELS[profile].padEnd(6)} slip ${pad(slid.slip, 5)} -> ${pad(caught.slip, 5)}`,
  )
}

console.log('\nflicked left then right at 25 m/s, and braked mid-corner:')
for (const profile of VEHICLE_PROFILE_IDS) {
  const flicked = drive(drive(reach(profile, 25), profile, { steer: -1 }, 0.5, 25), profile, { steer: 1 }, 0.7, 25)
  const trailed = drive(drive(reach(profile, 25), profile, { steer: 1 }, 0.6, 25), profile, { steer: 1, brake: 1 }, 0.6, 0)
  console.log(
    `  ${VEHICLE_LABELS[profile].padEnd(6)} flick slip ${pad(flicked.slip, 5)}  trail-brake slip ${pad(trailed.slip, 5)}`,
  )
}
