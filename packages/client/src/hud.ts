import * as THREE from 'three'

import { AchievementToast } from './achievement-toast.ts'
import { Banner } from './banner.ts'
import { element, setClass, setHidden, svg, writeAttribute, writeStyle, writeText } from './dom.ts'
import type { ControlHint, GateArrow, HudState, RaceHud } from './mode.ts'
import { clockLabel, placeLabel } from './race-text.ts'
import { Radar } from './radar.ts'

// What the HUD is filled with belongs to the shell's contract with a mode: mode.ts has it.
export type { ControlHint, HudState } from './mode.ts'

const TO_KPH = 3.6

/** The dial reads to the next multiple of this above the vehicle's top speed, in km/h. */
const DIAL_STEP_KPH = 20

/** How far the needle swings either side of straight up, in degrees. */
export const DIAL_SWEEP = 120

const DIAL_RADIUS = 44
const DIAL_CENTER = { x: 60, y: 56 }
const TICKS = 5

/** How long the dial's arc is, for filling it part way. */
export const DIAL_LENGTH = (DIAL_RADIUS * 2 * DIAL_SWEEP * Math.PI) / 180

/** The reading at the end of the dial, in km/h: a round number just past what the vehicle can do. */
export function dialTop(maxSpeed: number): number {
  return Math.max(DIAL_STEP_KPH, Math.ceil((maxSpeed * TO_KPH) / DIAL_STEP_KPH) * DIAL_STEP_KPH)
}

/** How far around the dial a speed is, 0 to 1. */
export function dialFraction(speed: number, maxSpeed: number): number {
  return THREE.MathUtils.clamp((Math.abs(speed) * TO_KPH) / dialTop(maxSpeed), 0, 1)
}

/** Where the needle points for a fraction of the dial, in degrees clockwise from straight up. */
export function needleAngle(fraction: number): number {
  return -DIAL_SWEEP + 2 * DIAL_SWEEP * fraction
}

/** A point on the dial, this far out from its middle, at this angle from straight up. */
function dialPoint(angle: number, radius = DIAL_RADIUS): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180
  return { x: DIAL_CENTER.x + radius * Math.sin(radians), y: DIAL_CENTER.y - radius * Math.cos(radians) }
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

/** The damage dial's color at this much damage: nothing much to look at until it starts turning red. */
export function damageColor(damage: number): string {
  return mixed.lerpColors(UNHURT, WRECKED, THREE.MathUtils.clamp(damage, 0, 1)).getStyle()
}

/** A color for each per cent the damage dial reads, made once: the dial is turned every frame, its color only when its reading changes. */
const DAMAGE_COLORS: readonly string[] = Array.from({ length: 101 }, (_, perCent) => damageColor(perCent / 100))

/** The race block's four readings, as the HUD shows them. */
export interface RaceText {
  /** Where the car stands, and out of how many: "2nd of 5". */
  place: string
  /** The gate it is heading for, and how many this world has: "gate 3 of 6". */
  along: string
  /** Which world of the course it is on: "world 2 of 3". */
  world: string
  /** How long the race has been on: "1:05". */
  time: string
}

/**
 * The race block's readings, from how the race is going for the car: where
 * it stands, which gate it is heading for, which world of the course it is
 * on, and how long the race has been on.
 */
export function raceText(race: RaceHud): RaceText {
  return {
    place: placeLabel(race.place, race.of),
    along: `gate ${Math.min(race.checkpoint + 1, race.ofCheckpoints)} of ${race.ofCheckpoints}`,
    world: `world ${race.world} of ${race.ofWorlds}`,
    time: clockLabel(race.seconds),
  }
}

/** What the compass says of the gate it points at: which it is, and how far. */
export function compassText(arrow: GateArrow): { gate: string; distance: string } {
  const gate = /^\d+$/.test(arrow.label) ? `gate ${arrow.label}` : arrow.label.toLowerCase()
  const distance = arrow.meters >= 1000 ? `${(arrow.meters / 1000).toFixed(1)} km` : `${Math.round(arrow.meters / 5) * 5} m`
  return { gate, distance }
}

/** A dial: an arc that fills around to a needle, with a reading under it, and what it was last turned to. */
interface Dial {
  readonly element: SVGSVGElement
  readonly needle: SVGLineElement
  readonly filled: SVGPathElement
  readonly reading: SVGTextElement
  /** The needle's angle and the arc's length as last drawn, in tenths of a degree and of a pixel. */
  shownAngle: number
  shownFill: number
  /** The reading last drawn, and the color the arc was last filled in. */
  shownReading: number
  shownColor: string
}

/** A dial of this unit: an arc, its ticks, a needle and a reading under it. */
function buildDial(unit: string): Dial {
  const element_ = svg('svg', { class: 'dial', viewBox: '0 0 120 92' })
  element_.append(svg('path', { class: 'track', d: dialArc() }))
  const filled = svg('path', { class: 'value', d: dialArc(), 'stroke-dasharray': `0 ${DIAL_LENGTH}` })
  element_.append(filled)
  for (let tick = 0; tick < TICKS; tick++) {
    const angle = needleAngle(tick / (TICKS - 1))
    const inner = dialPoint(angle, DIAL_RADIUS - 9)
    const outer = dialPoint(angle, DIAL_RADIUS - 4)
    element_.append(svg('line', { class: 'tick', x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y }))
  }
  const tip = dialPoint(0, DIAL_RADIUS - 10)
  const needle = svg('line', {
    class: 'needle',
    x1: DIAL_CENTER.x,
    y1: DIAL_CENTER.y,
    x2: tip.x,
    y2: tip.y,
    transform: `rotate(${needleAngle(0)} ${DIAL_CENTER.x} ${DIAL_CENTER.y})`,
  })
  element_.append(needle)
  element_.append(svg('circle', { class: 'hub', cx: DIAL_CENTER.x, cy: DIAL_CENTER.y, r: 3 }))
  const reading = svg('text', { class: 'reading', x: DIAL_CENTER.x, y: 80 })
  reading.textContent = '0'
  element_.append(reading)
  const label = svg('text', { class: 'unit', x: DIAL_CENTER.x, y: 90 })
  label.textContent = unit
  element_.append(label)
  return {
    element: element_,
    needle,
    filled,
    reading,
    shownAngle: Number.NaN,
    shownFill: Number.NaN,
    shownReading: Number.NaN,
    shownColor: '',
  }
}

/** Turn a dial to a fraction of its sweep, reading this and, if it is given, filled in this color: nothing that is already so is drawn again. */
function turnDial(dial: Dial, fraction: number, reading: number, suffix = '', color?: string): void {
  const angle = Math.round(needleAngle(fraction) * 10)
  if (angle !== dial.shownAngle) {
    dial.shownAngle = angle
    writeAttribute(dial.needle, 'transform', `rotate(${(angle / 10).toFixed(1)} ${DIAL_CENTER.x} ${DIAL_CENTER.y})`)
  }
  const fill = Math.round(DIAL_LENGTH * fraction * 10)
  if (fill !== dial.shownFill) {
    dial.shownFill = fill
    writeAttribute(dial.filled, 'stroke-dasharray', `${(fill / 10).toFixed(1)} ${DIAL_LENGTH}`)
  }
  if (color !== undefined && color !== dial.shownColor) {
    dial.shownColor = color
    dial.filled.style.stroke = color
  }
  if (reading !== dial.shownReading) {
    dial.shownReading = reading
    writeText(dial.reading, `${reading}${suffix}`)
  }
}

/** A double caret, pointing down: pull the drawer open. Turned over, it shuts it. */
function caret(): SVGSVGElement {
  const icon = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' })
  for (const top of [5, 12]) {
    icon.append(
      svg('path', {
        d: `M6 ${top} l6 6 6 -6`,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    )
  }
  return icon
}

/** A banana: a thick crescent tapering to its ends, tilted, with a stem at one end, a browned tip at the other and a ridge along its back. */
function banana(): SVGSVGElement {
  const icon = svg('svg', { class: 'banana', viewBox: '0 0 24 24' })
  const tilted = svg('g', { transform: 'rotate(-35 12 12)' })
  tilted.append(svg('path', { d: 'M3 8 C3 22 21 22 21 8 C20 12 4 12 3 8 Z', fill: '#f6d23c' }))
  tilted.append(svg('path', { d: 'M2.2 8.6 L2.6 5.2 L4.6 5.4 L4.4 8.6 Z', fill: '#6b4a1e' }))
  tilted.append(svg('path', { d: 'M19.4 9.8 L21 8 L21.4 10.4 Z', fill: '#6b4a1e' }))
  tilted.append(
    svg('path', {
      d: 'M5 9.5 C8 15.5 16 15.5 19 9.5',
      fill: 'none',
      stroke: '#d9b12a',
      'stroke-width': 0.7,
      'stroke-linecap': 'round',
    }),
  )
  icon.append(tilted)
  return icon
}

/** An arrowhead, pointing straight up, the way the car faces, until the way to the next gate turns it. */
function arrowhead(): SVGSVGElement {
  const icon = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' })
  icon.append(
    svg('path', {
      d: 'M12 1.5 L21.5 17 L12 12.5 L2.5 17 Z',
      fill: 'currentColor',
      stroke: 'rgba(20, 16, 4, 0.85)',
      'stroke-width': 1.2,
      'stroke-linejoin': 'round',
    }),
  )
  return icon
}

/** Where a car stands in a race and which gate it heads for, in the top corner of the HUD. */
class RaceBlock {
  readonly element = element('div', 'race')
  private readonly place = element('div', 'place')
  private readonly along = element('div', 'along')
  private readonly world = element('div', 'world')
  private readonly time = element('div', 'time')
  /** How the race was when the block was last written: its gate and its clock are what change from frame to frame. */
  private readonly shown: RaceHud = { place: 0, of: 0, checkpoint: -1, ofCheckpoints: 0, world: 0, ofWorlds: 0, seconds: -1 }

  constructor() {
    this.element.append(this.place, this.along, this.world, this.time)
    this.element.hidden = true
  }

  /** Show this race's readings, or nothing. */
  show(race: RaceHud | undefined): void {
    setHidden(this.element, race === undefined)
    if (race === undefined) {
      this.shown.checkpoint = -1
      return
    }
    if (this.same(race)) {
      this.remember(race)
      return
    }
    this.remember(race)
    const text = raceText(race)
    writeText(this.place, text.place)
    writeText(this.along, text.along)
    writeText(this.world, text.world)
    writeText(this.time, text.time)
  }

  /** Whether the block already says what this race would have it say: whole seconds, as the clock reads them. */
  private same(race: RaceHud): boolean {
    const shown = this.shown
    return (
      shown.place === race.place &&
      shown.of === race.of &&
      shown.checkpoint === race.checkpoint &&
      shown.ofCheckpoints === race.ofCheckpoints &&
      shown.world === race.world &&
      shown.ofWorlds === race.ofWorlds &&
      Math.floor(shown.seconds) === Math.floor(race.seconds)
    )
  }

  /** Take down what the block says now, for the next frame to compare against. */
  private remember(race: RaceHud): void {
    const shown = this.shown
    shown.place = race.place
    shown.of = race.of
    shown.checkpoint = race.checkpoint
    shown.ofCheckpoints = race.ofCheckpoints
    shown.world = race.world
    shown.ofWorlds = race.ofWorlds
    shown.seconds = race.seconds
  }
}

/** The arrow under the car that points the way to the next gate, with which gate it is and how far. */
class Compass {
  private readonly root: HTMLElement
  private readonly needle = element('div', 'needle')
  private readonly gate = element('div', 'gate')
  private readonly distance = element('div', 'distance')
  /** The angle last drawn, in thousandths of a radian, and what the reading last said. */
  private readonly shown = { angle: Number.NaN, meters: Number.NaN, label: '' }

  constructor(root: HTMLElement) {
    this.root = root
    const reading = element('div', 'reading')
    reading.append(this.gate, this.distance)
    this.needle.append(arrowhead())
    root.replaceChildren(this.needle, reading)
    root.hidden = true
  }

  /** Point at this gate, or at nothing. */
  show(arrow: GateArrow | undefined): void {
    setHidden(this.root, arrow === undefined)
    if (arrow === undefined) return
    // The needle turns smoothly, so it is written to a thousandth of a radian, as it is drawn.
    const angle = Math.round(arrow.angle * 1000)
    if (angle !== this.shown.angle) {
      this.shown.angle = angle
      writeStyle(this.needle, 'transform', `rotate(${(angle / 1000).toFixed(3)}rad)`)
    }
    // How far it is, to the step the reading is rounded to: meters by fives, kilometers by tenths.
    const meters = arrow.meters >= 1000 ? Math.round(arrow.meters / 100) : Math.round(arrow.meters / 5)
    if (meters !== this.shown.meters || arrow.label !== this.shown.label) {
      this.shown.meters = meters
      this.shown.label = arrow.label
      const text = compassText(arrow)
      writeText(this.gate, text.gate)
      writeText(this.distance, text.distance)
    }
  }
}

/** A line of keys and what they do, and whether it is the same as the one already up. */
function sameControls(shown: readonly ControlHint[] | null, controls: readonly ControlHint[]): boolean {
  if (shown === controls) return true
  if (shown === null || shown.length !== controls.length) return false
  for (const [index, hint] of controls.entries()) {
    const other = shown[index]!
    if (other === hint) continue
    if (other.does !== hint.does || other.keys.length !== hint.keys.length) return false
    for (const [at, key] of hint.keys.entries()) if (other.keys[at] !== key) return false
  }
  return true
}

/**
 * The corner of the screen that says how it is going: where the car stands
 * in a race and which gate it is heading for, the bananas held, a
 * speedometer, a damage dial beside it that fills and reddens as the car
 * is knocked about, a word on the moment, and the keys in a drawer under
 * it all that a caret pulls open and shut. An arrow at the edge of the
 * screen points the way to the next gate while it is out of sight.
 *
 * It is filled in every frame, and everything on it is written to the page
 * only where what it says has changed.
 */
export class Hud {
  private readonly root: HTMLElement
  private readonly title = element('div', 'title')
  private readonly race = new RaceBlock()
  private readonly compass: Compass | null
  private readonly row = element('div', 'row')
  private readonly score = element('div', 'score')
  private readonly scoreCount = element('span')
  private readonly game = element('div', 'game')
  private readonly gauges = element('div', 'gauges')
  private readonly speedo = buildDial('km/h')
  private readonly damage = buildDial('damage')
  private readonly drawer = element('div', 'drawer')
  private readonly controls = element('div', 'controls')
  private readonly sync = element('div', 'sync')
  private readonly toggle = element('button', 'toggle')
  private readonly radar: Radar | null
  private readonly banner: Banner | null
  private readonly achievement: AchievementToast | null
  private expanded = false
  /** The bananas last counted, `NaN` while there are none. */
  private shownScore = Number.NaN
  private shownControls: readonly ControlHint[] | null = null

  /**
   * `radarRoot` is where the mini-map goes, in a corner of its own,
   * `bannerRoot` where the big words go, over the middle, `achievementRoot`
   * where a feat is told of, and `compassRoot` where the compass to the next
   * gate stands, under the car.
   */
  constructor(root: HTMLElement, radarRoot?: HTMLElement, bannerRoot?: HTMLElement, achievementRoot?: HTMLElement, compassRoot?: HTMLElement) {
    this.root = root
    this.compass = compassRoot === undefined ? null : new Compass(compassRoot)
    this.radar = radarRoot === undefined ? null : new Radar(radarRoot)
    this.banner = bannerRoot === undefined ? null : new Banner(bannerRoot)
    this.achievement = achievementRoot === undefined ? null : new AchievementToast(achievementRoot)
    root.replaceChildren()

    this.gauges.append(this.speedo.element, this.damage.element)
    this.score.append(banana(), this.scoreCount)
    this.row.append(this.score)
    this.drawer.append(this.controls, this.sync)
    this.toggle.append(caret())
    this.toggle.addEventListener('click', () => this.expand(!this.expanded))
    this.expand(false)
    root.append(this.title, this.race.element, this.row, this.game, this.gauges, this.drawer, this.toggle)
    this.render(null)
  }

  /** Pull the drawer of keys open, or shut it. */
  expand(open: boolean): void {
    this.expanded = open
    setClass(this.root, 'expanded', open)
    writeAttribute(this.toggle, 'aria-expanded', String(open))
    writeAttribute(this.toggle, 'aria-label', open ? 'Hide controls' : 'Show controls')
  }

  /** Show this, or nothing. */
  render(state: HudState | null): void {
    setHidden(this.root, state === null)
    setClass(this.root, 'busy', false)
    this.radar?.render(state?.radar)
    this.banner?.render(state?.banner)
    this.achievement?.render(state?.achievement)
    this.compass?.show(state?.arrow)
    if (state === null) return

    writeText(this.title, state.title)
    const score = state.score === undefined ? Number.NaN : state.score
    if (score !== this.shownScore) {
      this.shownScore = score
      writeText(this.scoreCount, Number.isNaN(score) ? '' : String(score))
    }
    setHidden(this.score, Number.isNaN(score))
    this.race.show(state.race)
    writeText(this.game, state.game ?? '')
    setHidden(this.game, (state.game ?? '') === '')

    const { speed, maxSpeed, damage: wear } = state
    const driving = speed !== undefined && maxSpeed !== undefined && wear !== undefined
    setHidden(this.row, !driving && Number.isNaN(score))
    setHidden(this.gauges, !driving)
    const keyed = driving && state.controls !== undefined
    setHidden(this.drawer, !keyed)
    setHidden(this.toggle, !keyed)
    if (speed === undefined || maxSpeed === undefined || wear === undefined) return
    if (state.controls !== undefined) this.showControls(state.controls)
    writeText(this.sync, state.sync ?? '')
    setHidden(this.sync, (state.sync ?? '') === '')

    turnDial(this.speedo, dialFraction(speed, maxSpeed), Math.round(Math.abs(speed) * TO_KPH))
    const perCent = Math.round(THREE.MathUtils.clamp(wear, 0, 1) * 100)
    turnDial(this.damage, perCent / 100, perCent, '%', DAMAGE_COLORS[perCent])
  }

  /** A line and nothing else: what is being waited for, with a spinner under it. */
  notice(text: string): void {
    this.render({ title: text })
    setClass(this.root, 'busy', true)
  }

  /** The keys, one line of them: only written again where they are not the ones already up. */
  private showControls(controls: readonly ControlHint[]): void {
    if (sameControls(this.shownControls, controls)) return
    this.shownControls = controls
    this.controls.replaceChildren()
    controls.forEach((hint, index) => {
      const item = element('span', 'hint')
      for (const name of hint.keys) item.append(element('kbd', '', name))
      item.append(` ${hint.does}`)
      if (index > 0) this.controls.append(' ')
      this.controls.append(item)
    })
  }
}
