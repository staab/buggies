import { describe, expect, it } from 'vitest'

import { sphereHeight } from '../sphere.ts'
import { frameAt, fromFrame, toFrame } from '../globe/frame.ts'
import { unit } from '../globe/lines.ts'
import { groundOfSize, landOf } from './ground.ts'
import { digPit, pastScrew, screwRamp, type Pit, type Screw } from './spirals.ts'

const MIDDLE = unit({ x: 0.6, y: 0.48, z: 0.64 })

describe('the spirals', () => {
  it('wind a pit’s road down from its rim to its floor at its grade, flat across, with a cliff from each turn down to the next', () => {
    const ground = groundOfSize(1)
    const land = landOf(ground, -1000)
    const pit: Pit = { center: MIDDLE, rim: 68, floor: 14, pitch: 16, road: 10, grade: 0.1, start: 0.7, level: 0 }
    const depth = digPit(land, pit)
    expect(depth).toBeGreaterThan(50)
    expect(sphereHeight(ground, MIDDLE)).toBeCloseTo(-depth, 3)
    // Out past the rim, the ground as it was.
    const frame = frameAt(MIDDLE, ground.radius)
    expect(sphereHeight(ground, fromFrame(frame, pit.rim + 6, 0))).toBe(0)
    // Down the road's middle line, no steeper than it was dug, and down to the floor.
    const outer = pit.rim - pit.pitch / 2
    const sweep = ((outer - (pit.floor + pit.road / 2)) * 2 * Math.PI) / pit.pitch
    const lane = (turned: number, out = 0): number => {
      const r = outer - (pit.pitch * turned) / (2 * Math.PI) + out
      return sphereHeight(ground, fromFrame(frame, Math.cos(pit.start + turned) * r, Math.sin(pit.start + turned) * r))
    }
    let last = lane(0)
    for (let turned = 0.05; turned <= sweep; turned += 0.05) {
      const here = lane(turned)
      const run = (outer - (pit.pitch * turned) / (2 * Math.PI)) * 0.05
      expect((last - here) / run, `${turned.toFixed(2)} round`).toBeLessThan(pit.grade * 1.2)
      expect(here).toBeLessThanOrEqual(last + 0.05)
      last = here
    }
    expect(last).toBeCloseTo(-depth, 0)
    // Across the road, level; out past it the wall climbs to the turn above, a whole turn's fall higher.
    const halfway = sweep / 2
    for (const out of [-3, 0, 3]) expect(Math.abs(lane(halfway, out) - lane(halfway))).toBeLessThan(0.6)
    expect(lane(halfway, pit.pitch) - lane(halfway)).toBeGreaterThan(10)
  })

  it('wind a screw’s ramp up round its tower as close at its top as at its foot, at its grade, and straight on off its top, level', () => {
    const radius = groundOfSize(1).radius
    const screw: Screw = { center: MIDDLE, reach: 18, width: 10, foot: 0.2, top: 70.2, grade: 0.09, start: 1.1 }
    const ramp = screwRamp(screw, 42, radius)
    const frame = frameAt(MIDDLE, radius)
    const heightOf = (p: { x: number; y: number; z: number }): number => Math.hypot(p.x, p.y, p.z) - radius
    // Round its middle at the same distance, true, from the foot to the top.
    const turns = ramp.points.filter((p) => heightOf(p) < screw.top - 0.01)
    for (const p of turns) {
      const flat = toFrame(frame, p)
      const out = Math.hypot(flat.x, flat.z) * ((radius + heightOf(p)) / radius)
      expect(out).toBeCloseTo(screw.reach, 0)
    }
    expect(heightOf(ramp.points[0]!)).toBeCloseTo(screw.foot, 3)
    // Climbing at its grade: up a turn's length times the grade each time round.
    for (let i = 1; i < turns.length; i++) {
      const run = Math.hypot(ramp.points[i]!.x - ramp.points[i - 1]!.x, ramp.points[i]!.y - ramp.points[i - 1]!.y, ramp.points[i]!.z - ramp.points[i - 1]!.z)
      expect((heightOf(ramp.points[i]!) - heightOf(ramp.points[i - 1]!)) / run).toBeCloseTo(screw.grade, 1)
    }
    // And off the top level, straight on to where the platform beside it is.
    const off = ramp.points.slice(turns.length)
    expect(off.length).toBeGreaterThan(10)
    for (const p of off) expect(heightOf(p)).toBeCloseTo(screw.top, 3)
    const end = unit(off.at(-1)!)
    const past = pastScrew(screw, 42, radius)
    expect(Math.hypot(end.x - past.x, end.y - past.y, end.z - past.z)).toBeLessThan(1e-3)
    // Built and railed like a bridge all the way.
    expect(Array.from(ramp.structure).every((structure) => structure === ramp.structure[0])).toBe(true)
  })
})
