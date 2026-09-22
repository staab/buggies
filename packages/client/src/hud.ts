import * as THREE from 'three'

/** What the HUD shows of a mode: a title always, and the driving gauges when someone is driving. */
export interface HudState {
  /** Who is driving what, where. */
  title: string
  /** A word on the moment: airborne, in a tunnel, wrecked, disconnected. */
  state?: string
  /** How fast, in m/s. */
  speed?: number
  /** The most this vehicle does, in m/s: the dial reads to just past it. */
  maxSpeed?: number
  /** How beaten up, 0 untouched to 1 wrecked. */
  damage?: number
}

const TO_KPH = 3.6

/** The dial reads to the next multiple of this above the vehicle's top speed, in km/h. */
const DIAL_STEP_KPH = 20

/** How far the needle swings either side of straight up, in degrees. */
export const DIAL_SWEEP = 120

const DIAL_RADIUS = 44
const DIAL_CENTRE = { x: 60, y: 56 }
const TICKS = 5

/** How long the dial's arc is, for filling it part way. */
export const DIAL_LENGTH = (DIAL_RADIUS * 2 * DIAL_SWEEP * Math.PI) / 180

/** The reading at the end of the dial, in km/h: a round number just past what the vehicle can do. */
export function dialTop(maxSpeed: number): number {
  return Math.max(DIAL_STEP_KPH, Math.ceil((maxSpeed * TO_KPH) / DIAL_STEP_KPH) * DIAL_STEP_KPH)
}

/** How far round the dial a speed is, 0 to 1. */
export function dialFraction(speed: number, maxSpeed: number): number {
  return THREE.MathUtils.clamp((Math.abs(speed) * TO_KPH) / dialTop(maxSpeed), 0, 1)
}

/** Where the needle points for a fraction of the dial, in degrees clockwise from straight up. */
export function needleAngle(fraction: number): number {
  return -DIAL_SWEEP + 2 * DIAL_SWEEP * fraction
}

function dialPoint(angle: number, radius = DIAL_RADIUS): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180
  return { x: DIAL_CENTRE.x + radius * Math.sin(radians), y: DIAL_CENTRE.y - radius * Math.cos(radians) }
}

/** The dial's arc, from its start to its end, as an SVG path. */
export function dialArc(): string {
  const from = dialPoint(-DIAL_SWEEP)
  const to = dialPoint(DIAL_SWEEP)
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${DIAL_RADIUS} ${DIAL_RADIUS} 0 1 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`
}

const UNHURT = new THREE.Color('#8ba3b6')
const WRECKED = new THREE.Color('#e04a3a')
const mixed = new THREE.Color()

/** The damage bar's colour: nothing much to look at until it starts turning red. */
export function damageColor(damage: number): string {
  return mixed.lerpColors(UNHURT, WRECKED, THREE.MathUtils.clamp(damage, 0, 1)).getStyle()
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

function div(className: string): HTMLDivElement {
  const element = document.createElement('div')
  element.className = className
  return element
}

/**
 * The corner of the screen that says how it is going: a speedometer, a
 * damage bar that fills and reddens as the car is knocked about, a word on
 * the moment, and the keys.
 */
export class Hud {
  private readonly root: HTMLElement
  private readonly title = div('title')
  private readonly gauges = div('gauges')
  private readonly needle: SVGLineElement
  private readonly filled: SVGPathElement
  private readonly reading: SVGTextElement
  private readonly fill = div('fill')
  private readonly state = div('state')
  private readonly controls = div('controls')
  private shownTitle = ''
  private shownState = ''
  private shownReading = ''

  constructor(root: HTMLElement) {
    this.root = root
    root.replaceChildren()

    const dial = svg('svg', { class: 'speedo', viewBox: '0 0 120 92' })
    dial.append(svg('path', { class: 'track', d: dialArc() }))
    this.filled = svg('path', { class: 'value', d: dialArc(), 'stroke-dasharray': `0 ${DIAL_LENGTH}` })
    dial.append(this.filled)
    for (let tick = 0; tick < TICKS; tick++) {
      const angle = needleAngle(tick / (TICKS - 1))
      const inner = dialPoint(angle, DIAL_RADIUS - 9)
      const outer = dialPoint(angle, DIAL_RADIUS - 4)
      dial.append(svg('line', { class: 'tick', x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y }))
    }
    const tip = dialPoint(0, DIAL_RADIUS - 10)
    this.needle = svg('line', {
      class: 'needle',
      x1: DIAL_CENTRE.x,
      y1: DIAL_CENTRE.y,
      x2: tip.x,
      y2: tip.y,
      transform: `rotate(${needleAngle(0)} ${DIAL_CENTRE.x} ${DIAL_CENTRE.y})`,
    })
    dial.append(this.needle)
    dial.append(svg('circle', { class: 'hub', cx: DIAL_CENTRE.x, cy: DIAL_CENTRE.y, r: 3 }))
    this.reading = svg('text', { class: 'reading', x: DIAL_CENTRE.x, y: 80 })
    this.reading.textContent = '0'
    dial.append(this.reading)
    const unit = svg('text', { class: 'unit', x: DIAL_CENTRE.x, y: 90 })
    unit.textContent = 'km/h'
    dial.append(unit)

    const damage = div('damage')
    const bar = div('bar')
    bar.append(this.fill)
    const label = document.createElement('span')
    label.className = 'label'
    label.textContent = 'damage'
    damage.append(bar, label)

    this.gauges.append(dial, damage)

    this.controls.innerHTML =
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to drive &nbsp; ' +
      '<kbd>Space</kbd> handbrake<br />' +
      '<kbd>Enter</kbd> back to the road &nbsp; <kbd>Esc</kbd> menu'

    root.append(this.title, this.gauges, this.state, this.controls)
    this.render(null)
  }

  /** Show this, or nothing. */
  render(state: HudState | null): void {
    this.root.hidden = state === null
    if (state === null) return

    if (state.title !== this.shownTitle) {
      this.shownTitle = state.title
      this.title.textContent = state.title
    }
    const shownState = state.state ?? ''
    if (shownState !== this.shownState) {
      this.shownState = shownState
      this.state.textContent = shownState
    }
    this.state.hidden = shownState === ''

    const driving = state.speed !== undefined && state.maxSpeed !== undefined && state.damage !== undefined
    this.gauges.hidden = !driving
    this.controls.hidden = !driving
    if (!driving) return

    const fraction = dialFraction(state.speed!, state.maxSpeed!)
    this.needle.setAttribute('transform', `rotate(${needleAngle(fraction).toFixed(1)} ${DIAL_CENTRE.x} ${DIAL_CENTRE.y})`)
    this.filled.setAttribute('stroke-dasharray', `${(DIAL_LENGTH * fraction).toFixed(1)} ${DIAL_LENGTH}`)
    const reading = String(Math.round(Math.abs(state.speed!) * TO_KPH))
    if (reading !== this.shownReading) {
      this.shownReading = reading
      this.reading.textContent = reading
    }
    const damage = THREE.MathUtils.clamp(state.damage!, 0, 1)
    this.fill.style.width = `${(damage * 100).toFixed(1)}%`
    this.fill.style.background = damageColor(damage)
  }

  /** A line and nothing else: what is being waited for. */
  notice(text: string): void {
    this.render({ title: text })
  }
}
