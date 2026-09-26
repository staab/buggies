import type { TerrainMap } from '@buggies/terrain'

import { drawIsland } from './island-picture.ts'

/** How many pixels a side the island is drawn at in the overview. */
const OVERVIEW_PIXELS = 720
/** How often the overview is drawn afresh while it is open, in seconds. */
const REDRAW = 0.1

/** Something to show on the overview. */
export interface OverviewMark {
  kind: 'you' | 'player' | 'npc' | 'robot' | 'ufo' | 'goal'
  x: number
  z: number
  /** The color a car is marked in: its seat's. */
  color?: number
  /** Which way it faces, for your own car: a unit vector across the ground. */
  forward?: { x: number; z: number }
}

/** What the overview needs of the game behind it. */
export interface OverviewHost {
  /** The island being played, or nothing when no game is on. */
  map(): TerrainMap | null
  /** Where everything worth showing is, now. */
  marks(): readonly OverviewMark[]
}

const LEGEND: readonly [OverviewMark['kind'], string][] = [
  ['you', 'You'],
  ['player', 'Players'],
  ['npc', 'Traffic'],
  ['robot', 'Robots'],
  ['ufo', 'Saucer'],
  ['goal', 'Goal'],
]

const COLORS: Readonly<Record<Exclude<OverviewMark['kind'], 'player'>, string>> = {
  you: '#ffffff',
  npc: '#9aa0a6',
  robot: '#ff3030',
  ufo: '#5cff8a',
  goal: '#ffd24a',
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

/**
 * The island from above with everything on it as it moves: every car, the
 * cars nobody drives, the robots, the saucer and the spot being played
 * for. It is drawn over the game, which goes on under it.
 */
export class MapOverview {
  private readonly root: HTMLElement
  private readonly host: OverviewHost
  private readonly board: HTMLCanvasElement
  private island: { seed: number; picture: HTMLCanvasElement } | null = null
  private sinceDrawn = Infinity

  constructor(root: HTMLElement, host: OverviewHost) {
    this.root = root
    this.host = host
    root.hidden = true
    const panel = document.createElement('div')
    panel.className = 'overview'
    this.board = document.createElement('canvas')
    this.board.width = OVERVIEW_PIXELS
    this.board.height = OVERVIEW_PIXELS
    const legend = document.createElement('div')
    legend.className = 'legend'
    for (const [kind, name] of LEGEND) {
      const item = document.createElement('span')
      const swatch = document.createElement('i')
      swatch.style.background = kind === 'player' ? '#e8a33a' : COLORS[kind]
      item.append(swatch, name)
      legend.append(item)
    }
    panel.append(this.board, legend)
    root.append(panel)
  }

  get open(): boolean {
    return !this.root.hidden
  }

  show(): void {
    if (this.host.map() === null) return
    this.root.hidden = false
    this.sinceDrawn = Infinity
  }

  hide(): void {
    this.root.hidden = true
  }

  toggle(): void {
    if (this.open) this.hide()
    else this.show()
  }

  /** A frame on: drawn afresh every so often while it is open. */
  update(dt: number): void {
    if (!this.open) return
    this.sinceDrawn += dt
    if (this.sinceDrawn < REDRAW) return
    this.sinceDrawn = 0
    this.draw()
  }

  private draw(): void {
    const map = this.host.map()
    const context = this.board.getContext('2d')
    if (map === null || context === null) return
    if (this.island?.seed !== map.seed) this.island = { seed: map.seed, picture: drawIsland(map, OVERVIEW_PIXELS) }
    context.drawImage(this.island.picture, 0, 0)
    const scale = OVERVIEW_PIXELS / (map.size * map.cellSize)
    // Drawn from the least to the most wanted, so your own car is on top.
    const order: OverviewMark['kind'][] = ['goal', 'npc', 'robot', 'ufo', 'player', 'you']
    const marks = [...this.host.marks()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    context.lineWidth = 2
    context.strokeStyle = '#0b1620'
    for (const mark of marks) {
      const x = mark.x * scale
      const z = mark.z * scale
      context.fillStyle = mark.kind === 'player' ? hex(mark.color ?? 0xe8a33a) : COLORS[mark.kind]
      context.beginPath()
      switch (mark.kind) {
        case 'you': {
          // An arrow the way the car faces.
          const f = mark.forward ?? { x: 0, z: -1 }
          context.moveTo(x + f.x * 11, z + f.z * 11)
          context.lineTo(x - f.x * 7 - f.z * 7, z - f.z * 7 + f.x * 7)
          context.lineTo(x - f.x * 3, z - f.z * 3)
          context.lineTo(x - f.x * 7 + f.z * 7, z - f.z * 7 - f.x * 7)
          context.closePath()
          break
        }
        case 'npc':
          context.rect(x - 4, z - 4, 8, 8)
          break
        case 'robot':
          context.moveTo(x, z - 7)
          context.lineTo(x + 7, z + 6)
          context.lineTo(x - 7, z + 6)
          context.closePath()
          break
        case 'ufo':
          context.ellipse(x, z, 10, 6, 0, 0, Math.PI * 2)
          break
        case 'goal':
          context.arc(x, z, 8, 0, Math.PI * 2)
          break
        default:
          context.arc(x, z, 6, 0, Math.PI * 2)
      }
      context.fill()
      context.stroke()
    }
  }
}
