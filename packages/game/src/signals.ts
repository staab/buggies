import type { Vehicle, VehicleProfileId } from '@buggies/vehicle'

/** The vehicles with a siren and roof lights on the signal key; every other blows its horn. */
export const SIREN_VEHICLES: readonly VehicleProfileId[] = ['police', 'ambulance', 'firetruck']

/** How long a horn sounds, in ticks, from the press. */
export const HORN_TICKS = 60

/** What of a seat its signal reads and writes. */
export interface Signaller {
  readonly occupied: boolean
  readonly profile: VehicleProfileId
  readonly vehicle: Vehicle
  /** Whether its siren is on, and how much longer its horn sounds, in ticks. */
  lightsOn: boolean
  hornTicks: number
  /** Whether the signal key was down last tick, so that a press is told from a hold. */
  signalHeld: boolean
}

/** Whether a vehicle's signal key works its siren, rather than its horn. */
export function hasSiren(profile: VehicleProfileId): boolean {
  return SIREN_VEHICLES.includes(profile)
}

/**
 * The signal key, for show: a press turns a siren on or off, or blows a
 * horn for a second. Nothing on the island takes any notice of either. A
 * wreck has its siren off and its horn quiet.
 */
export function signal(seats: readonly Signaller[]): void {
  for (const seat of seats) {
    if (!seat.occupied) continue
    const held = seat.vehicle.command.signal
    const pressed = held && !seat.signalHeld
    seat.signalHeld = held
    if (seat.hornTicks > 0) seat.hornTicks -= 1
    if (seat.vehicle.wrecked) {
      seat.lightsOn = false
      seat.hornTicks = 0
      continue
    }
    if (!pressed) continue
    if (hasSiren(seat.profile)) seat.lightsOn = !seat.lightsOn
    else seat.hornTicks = HORN_TICKS
  }
}

/** Put a seat's siren off and its horn quiet. */
export function quiet(seat: Signaller): void {
  seat.lightsOn = false
  seat.hornTicks = 0
  seat.signalHeld = false
}
