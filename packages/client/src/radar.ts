import { element, setClass, svg, writeAttribute, writeText } from './dom.ts'
import type { RadarGate, RadarState } from './mode.ts'

// What the mini-map is drawn from belongs to the shell's contract with a mode: mode.ts has it.
export type { RadarBlip, RadarGate, RadarState } from './mode.ts'

/** How far the mini-map sees, in meters from the car to its rim. */
export const RADAR_RANGE = 300

/** How far in from the edge of the drawing the rim is, so a blip held on it is drawn whole. */
const RIM = 0.9

/** How big a gate's numbered marker on the mini-map is, and how much bigger the one to head for is. */
export const GATE_MARKER = 0.07
export const NEXT_GATE_MARKER = 0.11

/** How big the dot for someone else is. */
const BLIP_MARKER = 0.06

/** A point as the mini-map lays it out: `x` to the right and `y` down, with the rim at 1. */
export interface RadarPoint {
  x: number
  y: number
  /** Whether it is past the rim, and so held on it, pointing the way to it. */
  beyond: boolean
}

/** Where a point falls on the mini-map, turned so the car always faces up, laid out in `out` rather than anew each frame. */
function placePoint(
  position: { x: number; z: number },
  forward: { x: number; z: number },
  other: { x: number; z: number },
  out: RadarPoint,
  range = RADAR_RANGE,
): void {
  // Flat on the ground: a car on its nose or roof still faces somewhere.
  const length = Math.hypot(forward.x, forward.z)
  const fx = length > 1e-6 ? forward.x / length : 0
  const fz = length > 1e-6 ? forward.z / length : -1
  const dx = other.x - position.x
  const dz = other.z - position.z
  // The car's right is its forward turned a quarter clockwise, seen from above.
  const across = (dz * fx - dx * fz) / range
  const ahead = (dx * fx + dz * fz) / range
  const distance = Math.hypot(across, ahead)
  if (distance <= 1) {
    out.x = across
    out.y = -ahead
    out.beyond = false
    return
  }
  out.x = across / distance
  out.y = -ahead / distance
  out.beyond = true
}

/** Where a point falls on the mini-map, turned so the car always faces up: `x` to the right and `y` down, as on the screen, with the rim at 1. Anyone past the rim is held on it, pointing the way to them. */
export function radarPoint(
  position: { x: number; z: number },
  forward: { x: number; z: number },
  other: { x: number; z: number },
  range = RADAR_RANGE,
): RadarPoint {
  const out: RadarPoint = { x: 0, y: 0, beyond: false }
  placePoint(position, forward, other, out, range)
  return out
}

/** Where a gate's marker goes on the mini-map, how big it is, and whether it is held on the rim, past the range: laid out as `radarPoint` lays everything out, before the rim is drawn in from the edge. */
export interface GateMark {
  x: number
  y: number
  radius: number
  beyond: boolean
}

/** A gate's marker on the mini-map, in the rim's units, laid out as every other thing on it is. */
export function gateMarker(state: Pick<RadarState, 'position' | 'forward'>, gate: RadarGate): GateMark {
  const { x, y, beyond } = radarPoint(state.position, state.forward, gate)
  return { x, y, radius: gate.next ? NEXT_GATE_MARKER : GATE_MARKER, beyond }
}

/** A dot on the mini-map, and where and how it was last drawn, to a thousandth of the rim. */
interface BlipDot {
  readonly dot: SVGCircleElement
  /** Where the dot is drawn, to a thousandth of the rim, `NaN` until it has been. */
  x: number
  y: number
  fill: string
  beyond: boolean
  drawn: boolean
}

/** A gate's marker: its circle, its number, and what they were last drawn as. */
interface GateMarkDot {
  readonly group: SVGGElement
  readonly circle: SVGCircleElement
  readonly label: SVGTextElement
  x: number
  y: number
  radius: number
  number: string
  next: boolean
  beyond: boolean
  drawn: boolean
}

/** The color a dot is filled with, by the color's number: made once for each color seen, never in a frame. */
const FILLS = new Map<number, string>()

/** The string a color's dot is filled with. */
function fillOf(color: number): string {
  const known = FILLS.get(color)
  if (known !== undefined) return known
  const fill = `#${color.toString(16).padStart(6, '0')}`
  FILLS.set(color, fill)
  return fill
}

/** Where something on the mini-map is, to a thousandth of the rim: what is drawn is only written when this changes. */
function toRim(value: number): number {
  return Math.round(value * RIM * 1000)
}

/** What a point of the mini-map reads as in the drawing, to three places. */
function drawnAt(value: number): string {
  return (value * RIM).toFixed(3)
}

/**
 * The mini-map in the bottom corner: a round radar with the car in the
 * middle facing up, a ring at half its range, and a dot for everyone else
 * in their own color, held on the rim when they are further off. A race's
 * gates are numbered circles, the one to head for larger and bright with a
 * line from the car to it, and the rest held on the rim when they are
 * past the range. Nothing that has not moved is written again, and nothing
 * is made anew in a frame.
 */
export class Radar {
  private readonly root: HTMLElement
  private readonly dots: BlipDot[] = []
  private readonly blips = svg('g', {})
  private readonly marks: GateMarkDot[] = []
  private readonly gates = svg('g', {})
  private readonly route = svg('line', { class: 'route' })
  private readonly shownRoute = { x: Number.NaN, y: Number.NaN }
  private readonly point: RadarPoint = { x: 0, y: 0, beyond: false }

  constructor(root: HTMLElement) {
    this.root = root
    const map = svg('svg', { viewBox: '-1 -1 2 2', 'aria-hidden': 'true' })
    map.append(svg('circle', { class: 'face', r: RIM }))
    map.append(svg('circle', { class: 'ring', r: RIM / 2 }))
    map.append(svg('line', { class: 'ring', x1: 0, y1: -RIM, x2: 0, y2: RIM }))
    map.append(svg('line', { class: 'ring', x1: -RIM, y1: 0, x2: RIM, y2: 0 }))
    map.append(this.blips, this.route, this.gates)
    map.append(svg('path', { class: 'self', d: 'M0 -0.09 L0.065 0.07 L0 0.035 L-0.065 0.07 Z' }))
    root.replaceChildren(map, element('span', 'range', `${RADAR_RANGE} m`))
    root.hidden = true
  }

  /** Show this, or nothing. */
  render(state: RadarState | undefined): void {
    if (state === undefined) {
      if (!this.root.hidden) this.root.hidden = true
      return
    }
    if (this.root.hidden) this.root.hidden = false
    this.showOthers(state)
    this.showGates(state)
  }

  /** A dot for everyone else on the island, in their own color, held on the rim when they are past it. */
  private showOthers(state: RadarState): void {
    while (this.dots.length < state.others.length) {
      const dot: BlipDot = { dot: svg('circle', { r: BLIP_MARKER }), x: Number.NaN, y: Number.NaN, fill: '', beyond: false, drawn: false }
      this.dots.push(dot)
      this.blips.append(dot.dot)
    }
    for (const [index, dot] of this.dots.entries()) {
      const other = state.others[index]
      if (other === undefined) {
        if (dot.drawn) {
          dot.drawn = false
          dot.dot.style.display = 'none'
        }
        continue
      }
      if (!dot.drawn) {
        dot.drawn = true
        dot.dot.style.display = ''
      }
      placePoint(state.position, state.forward, other, this.point)
      const x = toRim(this.point.x)
      const y = toRim(this.point.y)
      if (x !== dot.x) {
        dot.x = x
        writeAttribute(dot.dot, 'cx', drawnAt(this.point.x))
      }
      if (y !== dot.y) {
        dot.y = y
        writeAttribute(dot.dot, 'cy', drawnAt(this.point.y))
      }
      const fill = fillOf(other.color)
      if (fill !== dot.fill) {
        dot.fill = fill
        writeAttribute(dot.dot, 'fill', fill)
      }
      if (dot.beyond !== this.point.beyond) {
        dot.beyond = this.point.beyond
        setClass(dot.dot, 'beyond', this.point.beyond)
      }
    }
  }

  /** The course's gates: a numbered circle each, the one to head for larger and bright, and the way to it. */
  private showGates(state: RadarState): void {
    while (this.marks.length < state.gates.length) {
      const group = svg('g', { class: 'gate' })
      const circle = svg('circle', { r: GATE_MARKER })
      // The number sits in the middle of its circle, half a line down from its middle.
      const label = svg('text', { x: 0, y: 0, dy: 0.045 })
      group.append(circle, label)
      this.marks.push({
        group,
        circle,
        label,
        x: Number.NaN,
        y: Number.NaN,
        radius: Number.NaN,
        number: '',
        next: false,
        beyond: false,
        drawn: false,
      })
      this.gates.append(group)
    }
    let next: RadarGate | undefined
    for (const [index, mark] of this.marks.entries()) {
      const gate = state.gates[index]
      if (gate === undefined) {
        if (mark.drawn) {
          mark.drawn = false
          mark.group.style.display = 'none'
        }
        continue
      }
      if (!mark.drawn) {
        mark.drawn = true
        mark.group.style.display = ''
      }
      if (gate.next) next = gate
      placePoint(state.position, state.forward, gate, this.point)
      const x = toRim(this.point.x)
      const y = toRim(this.point.y)
      const radius = toRim(gate.next ? NEXT_GATE_MARKER : GATE_MARKER)
      // The number sits in the middle of its circle, so it goes where the circle does.
      if (x !== mark.x) {
        mark.x = x
        writeAttribute(mark.circle, 'cx', drawnAt(this.point.x))
        writeAttribute(mark.label, 'x', drawnAt(this.point.x))
      }
      if (y !== mark.y) {
        mark.y = y
        writeAttribute(mark.circle, 'cy', drawnAt(this.point.y))
        writeAttribute(mark.label, 'y', drawnAt(this.point.y))
      }
      if (radius !== mark.radius) {
        mark.radius = radius
        writeAttribute(mark.circle, 'r', drawnAt(gate.next ? NEXT_GATE_MARKER : GATE_MARKER))
      }
      if (gate.label !== mark.number) {
        mark.number = gate.label
        writeText(mark.label, gate.label)
      }
      if (gate.next !== mark.next) {
        mark.next = gate.next
        setClass(mark.group, 'next', gate.next)
      }
      if (this.point.beyond !== mark.beyond) {
        mark.beyond = this.point.beyond
        setClass(mark.group, 'beyond', this.point.beyond)
      }
    }
    this.showRoute(state, next)
  }

  /** The line from the car to the gate it is heading for, and nothing where there is no such gate. */
  private showRoute(state: RadarState, next: RadarGate | undefined): void {
    if (next === undefined) {
      if (this.route.style.display !== 'none') this.route.style.display = 'none'
      return
    }
    if (this.route.style.display === 'none') this.route.style.display = ''
    placePoint(state.position, state.forward, next, this.point)
    const x = toRim(this.point.x)
    const y = toRim(this.point.y)
    if (x !== this.shownRoute.x) {
      this.shownRoute.x = x
      writeAttribute(this.route, 'x2', drawnAt(this.point.x))
    }
    if (y !== this.shownRoute.y) {
      this.shownRoute.y = y
      writeAttribute(this.route, 'y2', drawnAt(this.point.y))
    }
  }
}
