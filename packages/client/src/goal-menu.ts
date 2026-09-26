import { GOAL_KINDS, GOAL_LABELS, GOAL_TARGET_MOST, type Goal, type GoalKind, type GoalRequest } from '@buggies/game'
import { sampleHeight, type TerrainMap } from '@buggies/terrain'

/** How many pixels a side the island is drawn at to pick a spot on. */
const MAP_PIXELS = 360

/** What each goal asks for, under its name. */
const GOAL_NOTES: Readonly<Record<GoalKind, string>> = {
  score: 'Collect this many bananas',
  kills: 'Wreck this many cars with your weapons',
  location: 'Drive to a spot on the map',
}

/** What each goal starts at, when first picked. */
const GOAL_DEFAULTS: Readonly<Record<Exclude<GoalKind, 'location'>, number>> = { score: 20, kills: 3 }

/** What the goal panel needs of the game behind it. */
export interface GoalHost {
  /** The island being played, or nothing when no game is on. */
  map(): TerrainMap | null
  /** Where the player is, to be shown on the map. */
  position(): { x: number; z: number } | null
  /** The goal being played for, if any. */
  goal(): Goal | null
  /** Play for this goal, or for none. */
  setGoal(goal: GoalRequest | null): void
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  return element
}

/** Mix two colors, `t` of the way from the first to the second. */
function mix(a: readonly number[], b: readonly number[], t: number): number[] {
  return a.map((value, i) => value + (b[i]! - value) * t)
}

const DEEP = [22, 58, 92]
const SHALLOW = [58, 118, 150]
const LOW = [86, 132, 72]
const HIGH = [150, 128, 96]
const PEAK = [226, 226, 222]

/**
 * The island from above, as a picture to pick a spot on: the sea by its
 * depth, the land by its height, the rivers and the roads over it.
 */
function drawIsland(map: TerrainMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = MAP_PIXELS
  canvas.height = MAP_PIXELS
  const context = canvas.getContext('2d')
  if (context === null) return canvas
  const extent = map.size * map.cellSize
  const scale = MAP_PIXELS / extent
  let highest = map.seaLevel + 1
  for (const height of map.heightfield.heights) highest = Math.max(highest, height)
  const image = context.createImageData(MAP_PIXELS, MAP_PIXELS)
  for (let row = 0; row < MAP_PIXELS; row++) {
    for (let col = 0; col < MAP_PIXELS; col++) {
      const height = sampleHeight(map.heightfield, (col + 0.5) / scale, (row + 0.5) / scale)
      const color =
        height <= map.seaLevel
          ? mix(DEEP, SHALLOW, Math.max(1 + (height - map.seaLevel) / 30, 0))
          : (() => {
              const up = (height - map.seaLevel) / (highest - map.seaLevel)
              return up < 0.5 ? mix(LOW, HIGH, up * 2) : mix(HIGH, PEAK, (up - 0.5) * 2)
            })()
      const at = (row * MAP_PIXELS + col) * 4
      image.data[at] = color[0]!
      image.data[at + 1] = color[1]!
      image.data[at + 2] = color[2]!
      image.data[at + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  const trace = (points: readonly { x: number; z: number }[], closed: boolean): void => {
    context.beginPath()
    points.forEach((point, i) => (i === 0 ? context.moveTo(point.x * scale, point.z * scale) : context.lineTo(point.x * scale, point.z * scale)))
    if (closed) context.closePath()
    context.stroke()
  }
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = '#4f9fd0'
  context.lineWidth = 1.5
  for (const river of map.rivers) trace(river.points, false)
  for (const road of map.roads) {
    if (road.kind === 'street' || road.kind === 'ramp') continue
    context.strokeStyle = road.kind === 'highway' ? '#f2d27a' : '#d8d2c4'
    context.lineWidth = road.kind === 'highway' ? 2.5 : 1.2
    trace(road.points, road.closed)
  }
  return canvas
}

/**
 * The "set a goal" panel, opened from the trophy in the corner: a goal to
 * play for on top of free play, a number of bananas or of cars wrecked, or
 * a spot on the island to drive to, picked on a map of it.
 */
export class GoalMenu {
  private readonly root: HTMLElement
  private readonly host: GoalHost
  private readonly cards: Record<GoalKind, HTMLButtonElement>
  private readonly current: HTMLParagraphElement
  private readonly amount: HTMLLabelElement
  private readonly amountInput: HTMLInputElement
  private readonly spot: HTMLDivElement
  private readonly board: HTMLCanvasElement
  private readonly note: HTMLParagraphElement
  private readonly setButton: HTMLButtonElement
  private readonly clearButton: HTMLButtonElement
  private kind: GoalKind = 'score'
  private picked: { x: number; z: number } | null = null
  private island: { seed: number; picture: HTMLCanvasElement } | null = null

  constructor(root: HTMLElement, host: GoalHost) {
    this.root = root
    this.host = host
    root.hidden = true
    const panel = document.createElement('div')
    panel.className = 'panel goals'
    const title = document.createElement('h1')
    title.textContent = 'Set a goal'
    const blurb = document.createElement('p')
    blurb.className = 'blurb'
    blurb.textContent = 'Play for something. Reach it and you win 100 bananas.'
    this.current = document.createElement('p')
    this.current.className = 'status'

    const fieldset = document.createElement('fieldset')
    const legend = document.createElement('legend')
    legend.textContent = 'Goal'
    const cards = document.createElement('div')
    cards.className = 'cards'
    fieldset.append(legend, cards)
    const made = {} as Record<GoalKind, HTMLButtonElement>
    for (const kind of GOAL_KINDS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.append(span('name', GOAL_LABELS[kind]), span('note', GOAL_NOTES[kind]))
      button.addEventListener('click', () => this.pick(kind))
      cards.append(button)
      made[kind] = button
    }
    this.cards = made

    // How many, for a number of bananas or of wrecks.
    this.amount = document.createElement('label')
    this.amount.className = 'amount'
    this.amountInput = document.createElement('input')
    this.amountInput.type = 'number'
    this.amountInput.min = '1'
    this.amountInput.max = String(GOAL_TARGET_MOST)
    this.amountInput.step = '1'
    // The game is listening for keys too: these are the field's.
    this.amountInput.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') this.confirm()
    })
    this.amountInput.addEventListener('input', () => this.render())
    this.amount.append(span('name', 'How many'), this.amountInput)

    // Where, on a map of the island.
    this.spot = document.createElement('div')
    this.spot.className = 'spot'
    this.board = document.createElement('canvas')
    this.board.width = MAP_PIXELS
    this.board.height = MAP_PIXELS
    this.board.addEventListener('click', (event) => this.pickSpot(event))
    this.spot.append(this.board)

    this.note = document.createElement('p')
    this.note.className = 'status'

    const nav = document.createElement('div')
    nav.className = 'nav'
    this.setButton = document.createElement('button')
    this.setButton.type = 'button'
    this.setButton.className = 'go'
    this.setButton.textContent = 'Set goal'
    this.setButton.addEventListener('click', () => this.confirm())
    this.clearButton = document.createElement('button')
    this.clearButton.type = 'button'
    this.clearButton.textContent = 'Clear goal'
    this.clearButton.addEventListener('click', () => {
      this.host.setGoal(null)
      this.hide()
    })
    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = 'Close'
    close.addEventListener('click', () => this.hide())
    nav.append(this.setButton, this.clearButton, close)

    panel.append(title, blurb, this.current, fieldset, this.amount, this.spot, this.note, nav)
    root.append(panel)
  }

  get open(): boolean {
    return !this.root.hidden
  }

  show(): void {
    if (this.host.map() === null) return
    const goal = this.host.goal()
    if (goal?.kind === 'location') this.picked = { x: goal.x, z: goal.z }
    this.root.hidden = false
    this.pick(goal?.kind ?? this.kind)
  }

  hide(): void {
    this.root.hidden = true
    // The keys drive the game again.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  toggle(): void {
    if (this.open) this.hide()
    else this.show()
  }

  /** Pick a kind of goal: the one being played for as it is, or another as it starts out. */
  private pick(kind: GoalKind): void {
    this.kind = kind
    const goal = this.host.goal()
    if (kind !== 'location') this.amountInput.value = String(goal?.kind === kind ? goal.target : GOAL_DEFAULTS[kind])
    this.render()
  }

  /** The number asked for, if it is one that can be played for. */
  private target(): number | null {
    const value = Number(this.amountInput.value)
    return Number.isInteger(value) && value >= 1 && value <= GOAL_TARGET_MOST ? value : null
  }

  private pickSpot(event: MouseEvent): void {
    const map = this.host.map()
    if (map === null) return
    const bounds = this.board.getBoundingClientRect()
    const extent = map.size * map.cellSize
    const x = ((event.clientX - bounds.left) / bounds.width) * extent
    const z = ((event.clientY - bounds.top) / bounds.height) * extent
    this.picked = sampleHeight(map.heightfield, x, z) > map.seaLevel ? { x, z } : null
    this.note.textContent = this.picked === null ? 'Pick a spot on land.' : ''
    this.render()
  }

  private confirm(): void {
    if (this.kind === 'location') {
      if (this.picked === null) return
      this.host.setGoal({ kind: 'location', target: 0, x: this.picked.x, z: this.picked.z })
    } else {
      const target = this.target()
      if (target === null) return
      this.host.setGoal({ kind: this.kind, target, x: 0, z: 0 })
    }
    this.hide()
  }

  private render(): void {
    for (const kind of GOAL_KINDS) this.cards[kind].setAttribute('aria-pressed', String(kind === this.kind))
    const goal = this.host.goal()
    this.current.textContent = goal === null ? 'No goal: free play.' : `Playing for: ${describeGoal(goal)}`
    this.clearButton.hidden = goal === null
    const location = this.kind === 'location'
    this.amount.hidden = location
    this.spot.hidden = !location
    if (location) this.drawBoard()
    else this.note.textContent = this.target() === null ? `A whole number from 1 to ${GOAL_TARGET_MOST}.` : ''
    this.setButton.disabled = location ? this.picked === null : this.target() === null
  }

  /** The island, the player on it, and the spot picked. */
  private drawBoard(): void {
    const map = this.host.map()
    const context = this.board.getContext('2d')
    if (map === null || context === null) return
    if (this.island?.seed !== map.seed) this.island = { seed: map.seed, picture: drawIsland(map) }
    context.drawImage(this.island.picture, 0, 0)
    const scale = MAP_PIXELS / (map.size * map.cellSize)
    const here = this.host.position()
    if (here !== null) {
      context.fillStyle = '#6fd3c7'
      context.strokeStyle = '#0b1620'
      context.lineWidth = 2
      context.beginPath()
      context.arc(here.x * scale, here.z * scale, 5, 0, Math.PI * 2)
      context.fill()
      context.stroke()
    }
    if (this.picked !== null) {
      const x = this.picked.x * scale
      const z = this.picked.z * scale
      context.strokeStyle = '#ffd24a'
      context.lineWidth = 3
      context.beginPath()
      context.arc(x, z, 9, 0, Math.PI * 2)
      context.moveTo(x - 14, z)
      context.lineTo(x + 14, z)
      context.moveTo(x, z - 14)
      context.lineTo(x, z + 14)
      context.stroke()
    }
  }
}

/** A goal, said in a few words. */
export function describeGoal(goal: Goal): string {
  if (goal.kind === 'score') return `collect ${goal.target} ${goal.target === 1 ? 'banana' : 'bananas'}`
  if (goal.kind === 'kills') return `wreck ${goal.target} ${goal.target === 1 ? 'car' : 'cars'}`
  return 'reach the spot on the map'
}
