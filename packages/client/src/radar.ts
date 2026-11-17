import type { RadarGate, RadarState } from './mode.ts'

// What the mini-map is drawn from belongs to the shell's contract with a mode: mode.ts has it.
export type { RadarBlip, RadarGate, RadarState } from './mode.ts'

/** How far the mini-map sees, in meters from the car to its rim. */
export const RADAR_RANGE = 300

/**
 * Where a point falls on the mini-map, turned so the car always faces up:
 * `x` to the right and `y` down, as on the screen, with the rim at 1. Anyone
 * past the rim is held on it, pointing the way to them.
 */
export function radarPoint(
  position: { x: number; z: number },
  forward: { x: number; z: number },
  other: { x: number; z: number },
  range = RADAR_RANGE,
): { x: number; y: number; beyond: boolean } {
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
  if (distance <= 1) return { x: across, y: -ahead, beyond: false }
  return { x: across / distance, y: -ahead / distance, beyond: true }
}

const SVG = 'http://www.w3.org/2000/svg'

/** How big a gate's numbered marker on the mini-map is, and how much bigger the one to head for is. */
export const GATE_MARKER = 0.07
export const NEXT_GATE_MARKER = 0.11

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

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag)
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value))
  return element
}

/** How far in from the edge of the drawing the rim is, so a blip held on it is drawn whole. */
const RIM = 0.9

/**
 * The mini-map in the bottom corner: a round radar with the car in the
 * middle facing up, a ring at half its range, and a dot for everyone else
 * in their own color, held on the rim when they are further off. A race's
 * gates are numbered circles, the one to head for larger and bright with a
 * line from the car to it, and the rest held on the rim when they are
 * past the range.
 */
export class Radar {
  private readonly root: HTMLElement
  private readonly blips = svg('g', {})
  private readonly dots: SVGCircleElement[] = []
  private readonly gates = svg('g', {})
  private readonly route = svg('line', { class: 'route' })
  private readonly marks: { group: SVGGElement; circle: SVGCircleElement; label: SVGTextElement }[] = []

  constructor(root: HTMLElement) {
    this.root = root
    const map = svg('svg', { viewBox: '-1 -1 2 2', 'aria-hidden': 'true' })
    map.append(svg('circle', { class: 'face', r: RIM }))
    map.append(svg('circle', { class: 'ring', r: RIM / 2 }))
    map.append(svg('line', { class: 'ring', x1: 0, y1: -RIM, x2: 0, y2: RIM }))
    map.append(svg('line', { class: 'ring', x1: -RIM, y1: 0, x2: RIM, y2: 0 }))
    map.append(this.blips, this.route, this.gates)
    map.append(svg('path', { class: 'self', d: 'M0 -0.09 L0.065 0.07 L0 0.035 L-0.065 0.07 Z' }))
    const label = document.createElement('span')
    label.className = 'range'
    label.textContent = `${RADAR_RANGE} m`
    root.replaceChildren(map, label)
    root.hidden = true
  }

  /** Show this, or nothing. */
  render(state: RadarState | undefined): void {
    this.root.hidden = state === undefined
    if (state === undefined) return
    while (this.dots.length < state.others.length) {
      const dot = svg('circle', { r: 0.06 })
      this.dots.push(dot)
      this.blips.append(dot)
    }
    this.dots.forEach((dot, index) => {
      const other = state.others[index]
      dot.style.display = other === undefined ? 'none' : ''
      if (other === undefined) return
      const { x, y, beyond } = radarPoint(state.position, state.forward, other)
      dot.setAttribute('cx', (x * RIM).toFixed(3))
      dot.setAttribute('cy', (y * RIM).toFixed(3))
      dot.setAttribute('fill', `#${other.color.toString(16).padStart(6, '0')}`)
      dot.classList.toggle('beyond', beyond)
    })
    this.showGates(state)
  }

  /** The course's gates: a numbered circle each, the one to head for larger and bright, and the way to it. */
  private showGates(state: RadarState): void {
    while (this.marks.length < state.gates.length) {
      const group = svg('g', { class: 'gate' })
      const circle = svg('circle', { r: GATE_MARKER })
      // The number sits in the middle of its circle, half a line down from its middle.
      const label = svg('text', { x: 0, y: 0, dy: 0.045 })
      group.append(circle, label)
      this.marks.push({ group, circle, label })
      this.gates.append(group)
    }
    this.marks.forEach((mark, index) => {
      const gate = state.gates[index]
      mark.group.style.display = gate === undefined ? 'none' : ''
      if (gate === undefined) return
      const { x, y, radius, beyond } = gateMarker(state, gate)
      mark.circle.setAttribute('cx', (x * RIM).toFixed(3))
      mark.circle.setAttribute('cy', (y * RIM).toFixed(3))
      mark.circle.setAttribute('r', (radius * RIM).toFixed(3))
      mark.label.setAttribute('x', (x * RIM).toFixed(3))
      mark.label.setAttribute('y', (y * RIM).toFixed(3))
      mark.label.textContent = gate.label
      mark.group.classList.toggle('next', gate.next)
      mark.group.classList.toggle('beyond', beyond)
    })
    const next = state.gates.find((gate) => gate.next)
    this.route.style.display = next === undefined ? 'none' : ''
    if (next === undefined) return
    const { x, y } = gateMarker(state, next)
    this.route.setAttribute('x2', (x * RIM).toFixed(3))
    this.route.setAttribute('y2', (y * RIM).toFixed(3))
  }
}
