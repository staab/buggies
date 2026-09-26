/** How far the mini-map sees, in meters from the car to its rim. */
export const RADAR_RANGE = 300

/** What the mini-map shows: where the car is and which way it faces, and everyone else on the island. */
export interface RadarState {
  position: { x: number; z: number }
  forward: { x: number; z: number }
  others: readonly RadarBlip[]
}

/** Someone else on the island, in their seat's color. */
export interface RadarBlip {
  x: number
  z: number
  color: number
}

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
 * in their own color, held on the rim when they are further off.
 */
export class Radar {
  private readonly root: HTMLElement
  private readonly blips = svg('g', {})
  private readonly dots: SVGCircleElement[] = []

  constructor(root: HTMLElement) {
    this.root = root
    const map = svg('svg', { viewBox: '-1 -1 2 2', 'aria-hidden': 'true' })
    map.append(svg('circle', { class: 'face', r: RIM }))
    map.append(svg('circle', { class: 'ring', r: RIM / 2 }))
    map.append(svg('line', { class: 'ring', x1: 0, y1: -RIM, x2: 0, y2: RIM }))
    map.append(svg('line', { class: 'ring', x1: -RIM, y1: 0, x2: RIM, y2: 0 }))
    map.append(this.blips)
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
  }
}
