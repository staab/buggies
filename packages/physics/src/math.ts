// Vectors and quaternions, without allocation: every operation writes into
// an `out` it is given.

import { atan2, cos, sin } from './transcendental.ts'

export { acos, atan2, cos, exp, hypot, log, sin, tan } from './transcendental.ts'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Quat {
  x: number
  y: number
  z: number
  w: number
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })

export const quat = (x = 0, y = 0, z = 0, w = 1): Quat => ({ x, y, z, w })

export function vset(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x
  out.y = y
  out.z = z

  return out
}

export function vcopy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x
  out.y = a.y
  out.z = a.z

  return out
}

export function vadd(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  return vset(out, a.x + b.x, a.y + b.y, a.z + b.z)
}

export function vsub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  return vset(out, a.x - b.x, a.y - b.y, a.z - b.z)
}

export function vscale(out: Vec3, a: Vec3, scalar: number): Vec3 {
  return vset(out, a.x * scalar, a.y * scalar, a.z * scalar)
}

export function vaddScaled(out: Vec3, a: Vec3, b: Vec3, scalar: number): Vec3 {
  return vset(out, a.x + b.x * scalar, a.y + b.y * scalar, a.z + b.z * scalar)
}

export function vdot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function vcross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y
  const y = a.z * b.x - a.x * b.z
  const z = a.x * b.y - a.y * b.x

  return vset(out, x, y, z)
}

export function vlengthSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z
}

export function vlength(a: Vec3): number {
  return Math.sqrt(vlengthSq(a))
}

/** How far apart two points are. */
export function vdistance(a: Vec3, b: Vec3): number {
  const x = a.x - b.x
  const y = a.y - b.y
  const z = a.z - b.z
  return Math.sqrt(x * x + y * y + z * z)
}

export function vnormalize(out: Vec3, a: Vec3): Vec3 {
  const length = vlength(a)

  return length > 1e-9 ? vscale(out, a, 1 / length) : vset(out, 0, 0, 0)
}

export function vprojectOntoPlane(out: Vec3, a: Vec3, unitNormal: Vec3): Vec3 {
  return vaddScaled(out, a, unitNormal, -vdot(a, unitNormal))
}

export function qrotate(out: Vec3, q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)

  return vset(
    out,
    v.x + q.w * tx + q.y * tz - q.z * ty,
    v.y + q.w * ty + q.z * tx - q.x * tz,
    v.z + q.w * tz + q.x * ty - q.y * tx,
  )
}

export const clamp = (x: number, min: number, max: number): number => (x < min ? min : x > max ? max : x)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export function inverseLerpClamped(x: number, inMin: number, inMax: number): number {
  if (inMax - inMin < 1e-9) return x >= inMax ? 1 : 0

  return clamp((x - inMin) / (inMax - inMin), 0, 1)
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  const delta = target - current

  if (Math.abs(delta) <= maxDelta) return target

  return current + Math.sign(delta) * maxDelta
}

export function rotateAboutAxis(out: Vec3, v: Vec3, unitAxis: Vec3, angle: number): Vec3 {
  const cosAngle = cos(angle)
  const sinAngle = sin(angle)
  const alongAxis = vdot(unitAxis, v)
  const crossX = unitAxis.y * v.z - unitAxis.z * v.y
  const crossY = unitAxis.z * v.x - unitAxis.x * v.z
  const crossZ = unitAxis.x * v.y - unitAxis.y * v.x

  return vset(
    out,
    v.x * cosAngle + crossX * sinAngle + unitAxis.x * alongAxis * (1 - cosAngle),
    v.y * cosAngle + crossY * sinAngle + unitAxis.y * alongAxis * (1 - cosAngle),
    v.z * cosAngle + crossZ * sinAngle + unitAxis.z * alongAxis * (1 - cosAngle),
  )
}

export function quatFromYaw(yaw: number): Quat {
  return { x: 0, y: sin(yaw / 2), z: 0, w: cos(yaw / 2) }
}

export function qnlerp(out: Quat, a: Quat, b: Quat, t: number): Quat {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
  const sign = dot < 0 ? -1 : 1
  const x = a.x + (b.x * sign - a.x) * t
  const y = a.y + (b.y * sign - a.y) * t
  const z = a.z + (b.z * sign - a.z) * t
  const w = a.w + (b.w * sign - a.w) * t
  const length = Math.sqrt(x * x + y * y + z * z + w * w)

  if (length === 0) {
    out.x = a.x
    out.y = a.y
    out.z = a.z
    out.w = a.w

    return out
  }

  out.x = x / length
  out.y = y / length
  out.z = z / length
  out.w = w / length

  return out
}

/**
 * The rotation that stands a car upright on `up`, facing as near `forward`
 * as it can along the ground: its own right, up and back axes, the car
 * facing down its -Z as every car does. With up the y axis itself, it is
 * the turn about it, the same to the last bit as `quatFromYaw`.
 */
export function uprightRotation(up: Vec3, forward: Vec3): Quat {
  if (up.x === 0 && up.y === 1 && up.z === 0) return quatFromYaw(atan2(-forward.x, -forward.z))
  // Forward along the ground: its part along the up taken out, or any way along the ground if it points straight up or down.
  const along = forward.x * up.x + forward.y * up.y + forward.z * up.z
  let fx = forward.x - up.x * along
  let fy = forward.y - up.y * along
  let fz = forward.z - up.z * along
  let length = Math.sqrt(fx * fx + fy * fy + fz * fz)
  if (length < 1e-9) {
    // Across the up from whichever world axis it is least along.
    const helper = Math.abs(up.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
    fx = helper.y * up.z - helper.z * up.y
    fy = helper.z * up.x - helper.x * up.z
    fz = helper.x * up.y - helper.y * up.x
    length = Math.sqrt(fx * fx + fy * fy + fz * fz)
  }
  fx /= length
  fy /= length
  fz /= length
  // Right is forward across up; back is forward reversed.
  const rx = fy * up.z - fz * up.y
  const ry = fz * up.x - fx * up.z
  const rz = fx * up.y - fy * up.x
  return quatFromBasis(rx, ry, rz, up.x, up.y, up.z, -fx, -fy, -fz)
}

/** The rotation taking the x, y and z axes to these three orthonormal columns. */
export function quatFromBasis(
  m00: number,
  m10: number,
  m20: number,
  m01: number,
  m11: number,
  m21: number,
  m02: number,
  m12: number,
  m22: number,
): Quat {
  const trace = m00 + m11 + m22
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    return { w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s }
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    return { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s }
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    return { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s }
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2
  return { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s }
}

/** The rotation `a` after `b`: `b` first, then `a`. */
export function qmultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}
