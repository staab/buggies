import type { Vehicle } from '@buggies/game'
import { boreClearance, tunnelSegments, type TerrainMap } from '@buggies/terrain'

const TO_KPH = 3.6

/** Slip angle past which the HUD starts calling it a slide, in radians. */
const SLIDE_ANGLE = 0.35

/**
 * Whether a point is inside one of a map's tunnels. Tunnels are the one place
 * a chase camera cannot work: the arm would sit inside the hill, and the
 * ground it holds itself above is the mountain overhead.
 */
export function tunnelTest(map: TerrainMap): (position: { x: number; y: number; z: number }) => boolean {
  const bores = tunnelSegments(map.roads)
  if (bores.length === 0) return () => false
  return ({ x, y, z }) => boreClearance(bores, x, z, y) < 0
}

/** The speed line of the HUD: how fast, and what the car is up to. */
export function driverLine(vehicle: Vehicle, submersion: number, inTunnel: boolean): string {
  const speed = Math.round(vehicle.speed * TO_KPH)
  const state =
    submersion > 0.2
      ? 'in the water'
      : vehicle.selfRighting
        ? 'righting itself'
        : inTunnel
          ? 'in a tunnel'
          : vehicle.groundedCount === 0
            ? 'airborne'
            : Math.abs(vehicle.slipAngle) > SLIDE_ANGLE
              ? 'sliding'
              : 'on the road'
  return `${String(speed).padStart(3)} km/h  ${state}`
}
