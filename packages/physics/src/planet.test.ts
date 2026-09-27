import { describe, expect, it } from 'vitest'

import { chartFrame, qrotate, quatFromYaw, uprightRotation, chartToWorld, createChartFrame, createPlanet, exp, log, upAt, v3, vcross, vdot, vlength, vsub, worldToChart } from './index.ts'

// A planet's chart, as the terrain lays it out: once round a 612 m planet across, and pole to pole down.
const planet = createPlanet(3843, 1923)

describe('the planet', () => {
  it('has exp and log that agree with the built-in ones to a rounding step or so', () => {
    for (let i = -400; i <= 400; i++) {
      const x = i * 0.0731
      expect(Math.abs(exp(x) - Math.exp(x)) / Math.exp(x)).toBeLessThan(4e-16)
      const y = Math.abs(x) + 1e-3
      expect(Math.abs(log(y) - Math.log(y))).toBeLessThan(4e-16 * Math.max(1, Math.abs(Math.log(y))))
    }
  })

  it('is once round its equator across the chart', () => {
    expect(planet.radius * 2 * Math.PI).toBeCloseTo(planet.chartX, 6)
  })

  it('takes a chart point to the world and back again', () => {
    const world = v3()
    const back = v3()
    for (const [x, h, z] of [
      [10, 0, 961.5],
      [1921, 35.5, 700],
      [3800, -8, 1300],
      [2500, 120, 961.5],
      [5, 3, 400],
    ] as const) {
      chartToWorld(planet, x, h, z, world)
      worldToChart(planet, world, back)
      expect(back.x).toBeCloseTo(x, 6)
      expect(back.y).toBeCloseTo(h, 6)
      expect(back.z).toBeCloseTo(z, 6)
    }
  })

  it('puts the chart ground on the sphere, the middle of the chart on the equator, north up the chart', () => {
    const world = v3()
    chartToWorld(planet, 1000, 0, 961.5, world)
    expect(vlength(world)).toBeCloseTo(planet.radius, 6)
    expect(world.y).toBeCloseTo(0, 6)
    chartToWorld(planet, 1000, 0, 500, world)
    expect(world.y).toBeGreaterThan(0)
  })

  it('keeps small shapes and scales them: a step on the chart is a step the chart scale times as long, along its frame', () => {
    const frame = createChartFrame()
    const a = v3()
    const b = v3()
    const step = v3()
    for (const [x, z] of [
      [100, 961.5],
      [2000, 700],
      [3000, 1250],
    ] as const) {
      chartFrame(planet, x, z, frame)
      chartToWorld(planet, x, 0, z, a)
      for (const [dx, dh, dz, axis] of [
        [0.01, 0, 0, frame.east],
        [0, 0.01, 0, frame.up],
        [0, 0, 0.01, frame.south],
      ] as const) {
        chartToWorld(planet, x + dx, dh, z + dz, b)
        vsub(step, b, a)
        expect(vlength(step) / 0.01).toBeCloseTo(frame.scale, 3)
        expect(vdot(step, axis) / vlength(step)).toBeCloseTo(1, 3)
      }
      // A right-handed frame, as the chart's own x, up and z are: east across up is south.
      const cross = vcross(v3(), frame.east, frame.up)
      expect(vdot(cross, frame.south)).toBeCloseTo(1, 6)
      expect(vdot(upAt(a, v3()), frame.up)).toBeCloseTo(1, 9)
    }
  })

  it('joins the chart where its east and west edges meet', () => {
    const west = chartToWorld(planet, 0.001, 0, 900, v3())
    const east = chartToWorld(planet, planet.chartX - 0.001, 0, 900, v3())
    expect(vlength(vsub(v3(), west, east))).toBeLessThan(0.01)
  })

  it('stands a car upright on any up, facing along the ground, and on the y axis just as a yaw would', () => {
    const forward = { x: 0.6, y: 0, z: -0.8 }
    expect(uprightRotation({ x: 0, y: 1, z: 0 }, forward)).toEqual(quatFromYaw(Math.atan2(-0.6, 0.8)))
    const frame = createChartFrame()
    chartFrame(planet, 2000, 700, frame)
    const heading = { x: frame.east.x * 0.6 + frame.south.x * -0.8, y: frame.east.y * 0.6 + frame.south.y * -0.8, z: frame.east.z * 0.6 + frame.south.z * -0.8 }
    const turn = uprightRotation(frame.up, heading)
    const carUp = qrotate(v3(), turn, { x: 0, y: 1, z: 0 })
    const carForward = qrotate(v3(), turn, { x: 0, y: 0, z: -1 })
    expect(vdot(carUp, frame.up)).toBeCloseTo(1, 9)
    expect(vdot(carForward, heading)).toBeCloseTo(1, 9)
  })
})
