// Vectors and quaternions, without allocation: every operation writes into
// an `out` it is given.

import { cos, sin } from './transcendental.ts'

export { acos, atan2, cos, hypot, sin, tan } from './transcendental.ts'

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

export function quatFromYawPitch(yaw: number, pitch: number): Quat {
  const cosYaw = cos(yaw / 2)
  const sinYaw = sin(yaw / 2)
  const cosPitch = cos(pitch / 2)
  const sinPitch = sin(pitch / 2)

  return {
    x: cosYaw * sinPitch,
    y: sinYaw * cosPitch,
    z: -sinYaw * sinPitch,
    w: cosYaw * cosPitch,
  }
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
