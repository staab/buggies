import { corridorAt } from '@buggies/game'
import { DRY, createSphereGround, gridDirection, groundIndex, roofOver, type World } from '@buggies/terrain'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { RaceView, gateLabels } from './race-view.ts'

const RADIUS = 1000

/** A world with no roads and no roof over it: a gate stands in the open there, as wide as a road and as tall as it gets. */
const openWorld = { roads: [], roof: new Float32Array(0) } as unknown as World

/** How high the roof of the tunnel these tests lay down stands over the planet's radius. */
const TUNNEL_ROOF = 40

/**
 * A world of one tunnel: ground level with the planet's radius, a roof over
 * a strip this far either side of the pole, and the rock come down onto the
 * ground beyond it. The tunnel runs north and south, so a gate across it
 * faces east or west.
 */
function tunnelWorld(halfWidth: number): World {
  const n = 256
  const side = n + 1
  const ground = createSphereGround(n, RADIUS)
  const roof = new Float32Array(6 * side * side)
  const water = new Float32Array(6 * side * side).fill(DRY)
  const direction = { x: 0, y: 0, z: 0 }
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      gridDirection(n, 2, i, j, direction)
      if (Math.abs(direction.x) * RADIUS <= halfWidth) roof[groundIndex(ground, 2, i, j)] = TUNNEL_ROOF
    }
  }
  const level = new Float32Array(6 * side * side)
  return { radius: RADIUS, seaLevel: 0, ground, bored: level, roof, water, roads: [] } as unknown as World
}

/** How far along the ground the tunnel has a gate's height of room left, one way across it, to the nearest half metre. */
function wallFrom(world: World, at: { x: number; y: number; z: number }, sign: 1 | -1): number {
  const length = Math.hypot(at.x, at.y, at.z)
  for (let distance = 0.5; distance <= 30; distance += 0.5) {
    const across = { x: at.x + sign * distance, y: at.y, z: at.z }
    const scale = length / Math.hypot(across.x, across.y, across.z)
    const point = { x: across.x * scale, y: across.y * scale, z: across.z * scale }
    if (roofOver(world, point) - (length - RADIUS) < 9) return distance
  }
  return Number.NaN
}

/** A point on the planet's surface this far up one way, and the way it stands. */
function place(x: number, y: number, z: number): { at: { x: number; y: number; z: number }; up: THREE.Vector3 } {
  const up = new THREE.Vector3(x, y, z).normalize()
  const at = up.clone().multiplyScalar(RADIUS)
  return { at: { x: at.x, y: at.y, z: at.z }, up }
}

const east = { x: 1, y: 0, z: 0 }

/** The gates' own groups, in the order of the course. */
function gatesOf(view: RaceView): THREE.Group[] {
  return view.object.children as THREE.Group[]
}

/** Whether each gate is drawn. */
function drawn(view: RaceView): boolean[] {
  return gatesOf(view).map((gate) => gate.visible)
}

/** How wide a gate spans, from the sheet of light between its pillars. */
function spanOf(gate: THREE.Group): number {
  const sheet = gate.children[3] as THREE.Mesh
  return (sheet.geometry as THREE.PlaneGeometry).parameters.width
}

describe("a race's gates", () => {
  const first = place(0, 1, 0)
  const second = place(0, 1, 0.2)
  const third = place(0.2, 1, 0)

  it('stands one over the road at every checkpoint, upright and facing along it', () => {
    const view = new RaceView(openWorld, [
      { at: first.at, forward: east, radius: 14 },
      { at: second.at, forward: east, radius: 14 },
      { at: third.at, forward: east, radius: 14 },
    ])
    const gates = gatesOf(view)
    expect(gates).toHaveLength(3)
    const gate = gates[0]!
    expect(gate.position.distanceTo(new THREE.Vector3(first.at.x, first.at.y, first.at.z))).toBeLessThan(1e-6)
    // The way up there is its own up, and it faces the way the course goes: its own -z.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(gate.quaternion)
    expect(up.dot(first.up)).toBeCloseTo(1, 5)
    const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(gate.quaternion)
    expect(nose.dot(new THREE.Vector3(east.x, east.y, east.z))).toBeCloseTo(1, 5)
    // Its pillars stand either side of its own x, as wide as a road at least, and its lintel a gate high.
    const [left, right, lintel] = gate.children as THREE.Mesh[]
    expect(right!.position.x - left!.position.x).toBeGreaterThan(12)
    expect(lintel!.position.y).toBeGreaterThan(9)
    view.dispose()
  })

  it('stands a gate in the middle of the tunnel it is in, and fits it to the walls', () => {
    const world = tunnelWorld(15)
    // A checkpoint set down off the middle of the tunnel: the gate it draws still stands in the middle of it.
    const offset = { x: 6, y: Math.sqrt(RADIUS * RADIUS - 36), z: 0 }
    const forward = { x: 0, y: 0, z: 1 }
    const view = new RaceView(world, [{ at: offset, forward, radius: 14 }])
    const gate = gatesOf(view)[0]!
    const tunnel = corridorAt(world, offset, forward)
    expect(tunnel).not.toBeNull()
    expect(gate.position.x).toBeCloseTo(tunnel!.center.x, 3)
    expect(Math.abs(gate.position.x)).toBeLessThan(1)
    // It spans the tunnel less a metre, and its posts stand inside the room the tunnel has under its roof.
    const [left, right] = gate.children as THREE.Mesh[]
    const post = (left!.geometry as THREE.BoxGeometry).parameters.width / 2
    expect(spanOf(gate)).toBeCloseTo(tunnel!.width - 1, 1)
    const walls = Math.min(wallFrom(world, { x: 0, y: RADIUS, z: 0 }, 1), wallFrom(world, { x: 0, y: RADIUS, z: 0 }, -1))
    expect(right!.position.x + post).toBeLessThan(walls)
    expect(-left!.position.x + post).toBeLessThan(walls)
    // And stands its full height where the roof is high enough for it.
    const lintel = gate.children[2] as THREE.Mesh
    expect(lintel.position.y).toBeGreaterThan(9)
    view.dispose()
  })

  it('draws the next gate and the one after it, and nothing else', () => {
    const view = new RaceView(openWorld, [
      { at: first.at, forward: east, radius: 14 },
      { at: second.at, forward: east, radius: 14 },
      { at: third.at, forward: east, radius: 14 },
    ])
    expect(drawn(view)).toEqual([true, true, false])
    view.show(1)
    expect(drawn(view)).toEqual([false, true, true])
    view.show(0)
    expect(drawn(view)).toEqual([true, true, false])
    // A racer past the last gate of the world has nothing left to head for here.
    view.show(3)
    expect(drawn(view)).toEqual([false, false, false])
    view.dispose()
  })

  it('lights the next gate brighter than the one after it, and relights them as they come up', () => {
    const view = new RaceView(openWorld, [
      { at: first.at, forward: east, radius: 14 },
      { at: second.at, forward: east, radius: 14 },
      { at: third.at, forward: east, radius: 14 },
    ])
    const sheetOf = (index: number): THREE.Material => (gatesOf(view)[index]!.children[3] as THREE.Mesh).material as THREE.Material
    const bright = sheetOf(0)
    const faint = sheetOf(1)
    expect(bright).not.toBe(faint)
    expect((bright as THREE.MeshBasicMaterial).opacity).toBeGreaterThan((faint as THREE.MeshBasicMaterial).opacity ?? 0)
    // Come up to the second gate, it is lit as the first one was, and the third takes the faint light.
    view.show(1)
    expect(sheetOf(1)).toBe(bright)
    expect(sheetOf(2)).toBe(faint)
    view.dispose()
  })

  it('takes its gates out of the world when the mode is done with it', () => {
    const view = new RaceView(openWorld, [{ at: first.at, forward: east, radius: 14 }])
    expect(view.object.children).toHaveLength(1)
    view.dispose()
    expect(view.object.children).toHaveLength(0)
  })

  it('numbers its gates, and names the last the portal on or the finish', () => {
    expect(gateLabels(4, false)).toEqual(['1', '2', '3', 'PORTAL'])
    expect(gateLabels(3, true)).toEqual(['1', '2', 'FINISH'])
  })
})
