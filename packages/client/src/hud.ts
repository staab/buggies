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
  /** Which keys do what, for whoever this is for. */
  controls?: readonly ControlHint[]
  /** Bananas taken. */
  score?: number
}

/** Keys and what they do: `W` `A` `S` `D` "to drive". */
export interface ControlHint {
  keys: readonly string[]
  does: string
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

/** The damage dial's colour: nothing much to look at until it starts turning red. */
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

/** A dial: an arc that fills round to a needle, with a reading under it. */
interface Dial {
  element: SVGSVGElement
  needle: SVGLineElement
  filled: SVGPathElement
  reading: SVGTextElement
  shownReading: string
}

function buildDial(unit: string): Dial {
  const element = svg('svg', { class: 'dial', viewBox: '0 0 120 92' })
  element.append(svg('path', { class: 'track', d: dialArc() }))
  const filled = svg('path', { class: 'value', d: dialArc(), 'stroke-dasharray': `0 ${DIAL_LENGTH}` })
  element.append(filled)
  for (let tick = 0; tick < TICKS; tick++) {
    const angle = needleAngle(tick / (TICKS - 1))
    const inner = dialPoint(angle, DIAL_RADIUS - 9)
    const outer = dialPoint(angle, DIAL_RADIUS - 4)
    element.append(svg('line', { class: 'tick', x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y }))
  }
  const tip = dialPoint(0, DIAL_RADIUS - 10)
  const needle = svg('line', {
    class: 'needle',
    x1: DIAL_CENTRE.x,
    y1: DIAL_CENTRE.y,
    x2: tip.x,
    y2: tip.y,
    transform: `rotate(${needleAngle(0)} ${DIAL_CENTRE.x} ${DIAL_CENTRE.y})`,
  })
  element.append(needle)
  element.append(svg('circle', { class: 'hub', cx: DIAL_CENTRE.x, cy: DIAL_CENTRE.y, r: 3 }))
  const reading = svg('text', { class: 'reading', x: DIAL_CENTRE.x, y: 80 })
  reading.textContent = '0'
  element.append(reading)
  const label = svg('text', { class: 'unit', x: DIAL_CENTRE.x, y: 90 })
  label.textContent = unit
  element.append(label)
  return { element, needle, filled, reading, shownReading: '0' }
}

/** Turn a dial to a fraction of its sweep, with this under the needle, in this colour if not its own. */
function turnDial(dial: Dial, fraction: number, reading: string, colour?: string): void {
  dial.needle.setAttribute('transform', `rotate(${needleAngle(fraction).toFixed(1)} ${DIAL_CENTRE.x} ${DIAL_CENTRE.y})`)
  dial.filled.setAttribute('stroke-dasharray', `${(DIAL_LENGTH * fraction).toFixed(1)} ${DIAL_LENGTH}`)
  if (colour !== undefined) dial.filled.style.stroke = colour
  if (reading !== dial.shownReading) {
    dial.shownReading = reading
    dial.reading.textContent = reading
  }
}

/**
 * The corner of the screen that says how it is going: a speedometer, a
 * damage dial beside it that fills and reddens as the car is knocked about,
 * a word on the moment, and the keys.
 */
export class Hud {
  private readonly root: HTMLElement
  private readonly title = div('title')
  private readonly score = div('score')
  private readonly gauges = div('gauges')
  private readonly speedo = buildDial('km/h')
  private readonly damage = buildDial('damage')
  private readonly state = div('state')
  private readonly controls = div('controls')
  private shownTitle = ''
  private shownState = ''
  private shownControls = ''
  private shownScore = ''
  private readonly scoreCount = document.createElement('span')

  constructor(root: HTMLElement) {
    this.root = root
    root.replaceChildren()

    this.gauges.append(this.speedo.element, this.damage.element)
    const banana = svg('svg', { class: 'banana', viewBox: '0 0 24 24' })
    banana.append(svg('path', { d: 'M3 13c3 6 12 7 17-1-1 4-7 8-13 5-2-1-3-2-4-4z', fill: '#f6d23c' }))
    banana.append(svg('path', { d: 'M19 11.5l1.6-2.2-1-.3z', fill: '#6b4a1e' }))
    this.score.append(banana, this.scoreCount)
    root.append(this.title, this.score, this.gauges, this.state, this.controls)
    this.render(null)
  }

  /** Show this, or nothing. */
  render(state: HudState | null): void {
    this.root.hidden = state === null
    this.root.classList.remove('busy')
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

    const score = state.score === undefined ? '' : String(state.score)
    if (score !== this.shownScore) {
      this.shownScore = score
      this.scoreCount.textContent = score
    }
    this.score.hidden = score === ''

    const { speed, maxSpeed, damage: wear } = state
    const driving = speed !== undefined && maxSpeed !== undefined && wear !== undefined
    this.gauges.hidden = !driving
    this.controls.hidden = !driving || state.controls === undefined
    if (!driving) return
    if (state.controls !== undefined) this.showControls(state.controls)

    turnDial(this.speedo, dialFraction(speed, maxSpeed), String(Math.round(Math.abs(speed) * TO_KPH)))
    const damage = THREE.MathUtils.clamp(wear, 0, 1)
    turnDial(this.damage, damage, `${Math.round(damage * 100)}%`, damageColor(damage))
  }

  /** A line and nothing else: what is being waited for, with a spinner under it. */
  notice(text: string): void {
    this.render({ title: text })
    this.root.classList.add('busy')
  }

  private showControls(controls: readonly ControlHint[]): void {
    const key = JSON.stringify(controls)
    if (key === this.shownControls) return
    this.shownControls = key
    this.controls.replaceChildren()
    controls.forEach((hint, index) => {
      const item = document.createElement('span')
      item.className = 'hint'
      for (const name of hint.keys) {
        const kbd = document.createElement('kbd')
        kbd.textContent = name
        item.append(kbd)
      }
      item.append(` ${hint.does}`)
      if (index > 0) this.controls.append(' ')
      this.controls.append(item)
    })
  }
}
