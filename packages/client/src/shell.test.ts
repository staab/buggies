import type { VehicleProfileId } from '@buggies/game'
import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { Sound } from './audio.ts'
import type { HudState } from './hud.ts'
import type { Choice, MenuHost, Step } from './menu.ts'
import type { ModeView } from './mode.ts'
import { Shell, continues, playersFor, type ShellMenu, type ShellModes } from './shell.ts'
import type { ShowroomView } from './showroom-mode.ts'
import { Sun } from './sun.ts'

/** A game that only remembers what was done to it. */
interface StubGame extends ModeView {
  kind: string
  disposed: boolean
  updates: { dt: number; active: boolean }[]
}

interface StubShowroom extends ShowroomView {
  disposed: boolean
}

function stubShowroom(): StubShowroom {
  let vehicle: VehicleProfileId | null = null
  const showroom: StubShowroom = {
    disposed: false,
    camera: new THREE.PerspectiveCamera(),
    scene: new THREE.Scene(),
    get vehicle() {
      return vehicle
    },
    show(next) {
      vehicle = next
    },
    resize() {},
    update() {},
    hud() {
      return []
    },
    dispose() {
      showroom.disposed = true
    },
  }
  showroom.camera.name = 'showroom'
  return showroom
}

function fakeMap(seed: number): TerrainMap {
  return { seed, size: 8, cellSize: 1, districts: [], roads: [], rivers: [], lakes: [] } as unknown as TerrainMap
}

class StubMenu implements ShellMenu {
  open = false
  shown: [Choice, Step | undefined][] = []
  notices: string[] = []
  host: MenuHost | null = null
  show(choice: Choice, step?: Step): void {
    this.open = true
    this.shown.push([choice, step])
  }
  hide(): void {
    this.open = false
  }
  notice(text: string): void {
    this.notices.push(text)
  }
}

const CHOICE: Choice = { mode: 'solo', vehicle: 'sportsCar', vehicle2: 'raceCar' }
const SERVER = 'ws://island:8787'

/** A shell with nothing real behind it, and a record of everything it made. */
function build(seed = 5, refuse: string | null = null) {
  const games: StubGame[] = []
  const showrooms: StubShowroom[] = []
  const generated: number[] = []
  const settled: Choice[] = []
  const joined: string[] = []
  const hudStates: (HudState | null)[][] = [[], []]
  const rendered: string[] = []
  const menu = new StubMenu()
  const renderer = {
    domElement: {} as HTMLCanvasElement,
    setSize() {},
    render(_scene: THREE.Scene, camera: THREE.Camera) {
      rendered.push(camera.name)
    },
  } as unknown as THREE.WebGLRenderer
  const modes: ShellModes = {
    terrainView: () => new THREE.Group(),
    showroom: () => {
      const showroom = stubShowroom()
      showrooms.push(showroom)
      return showroom
    },
    play: async (_scene, url, players, mapFor) => {
      joined.push(url)
      if (refuse !== null) throw new Error(refuse)
      // Two players joining at once both ask for the island.
      await Promise.all(players.map(() => mapFor(seed)))
      const game: StubGame = {
        kind: `${players.map((player) => player.profile).join('+')} on ${seed}`,
        disposed: false,
        updates: [],
        camera: new THREE.PerspectiveCamera(),
        resize() {},
        update(dt, active) {
          game.updates.push({ dt, active })
        },
        hud() {
          return players.map((player) => ({ title: player.profile }))
        },
        dispose() {
          game.disposed = true
        },
      }
      game.camera.name = game.kind
      games.push(game)
      return game
    },
  }
  const shell = new Shell(
    {
      renderer,
      scene: new THREE.Scene(),
      container: { clientWidth: 800, clientHeight: 600 },
      huds: hudStates.map((states) => ({
        render: (state: HudState | null) => void states.push(state),
        notice: (text: string) => void states.push({ title: text }),
      })),
      sound: {} as Sound,
      sun: new Sun(),
      islands: {
        generate: async (asked) => {
          generated.push(asked)
          return fakeMap(asked)
        },
      },
      server: SERVER,
      createMenu: (host, choice) => {
        menu.host = host
        menu.show(choice)
        menu.hide()
        return menu
      },
      modes,
      settle: (choice) => void settled.push(choice),
    },
    CHOICE,
  )
  return { shell, menu, games, showrooms, generated, settled, joined, hudStates, rendered }
}

describe('the shell', () => {
  it('opens the menu with the vehicle turning behind it', () => {
    const { shell, menu, showrooms } = build()
    shell.welcome()
    expect(menu.open).toBe(true)
    expect(showrooms).toHaveLength(1)
    expect(showrooms[0]!.vehicle).toBe('sportsCar')
    expect(shell.onShow).toBe('showroom')
    // Another vehicle turns on the same turntable.
    shell.showVehicle('tank')
    expect(showrooms).toHaveLength(1)
    expect(showrooms[0]!.vehicle).toBe('tank')
  })

  it('joins the server, makes the island once, and keeps the game behind the menu', async () => {
    const { shell, menu, games, showrooms, generated, settled, joined } = build()
    shell.welcome()
    await shell.start(CHOICE)
    expect(joined).toEqual([SERVER])
    expect(games).toHaveLength(1)
    expect(games[0]!.kind).toBe('sportsCar on 5')
    expect(generated).toEqual([5])
    expect(showrooms[0]!.disposed).toBe(true)
    expect(shell.playing).toBe(true)
    expect(settled).toEqual([CHOICE])

    // Escape: the menu opens on the vehicle page, the showroom in front, the game still running.
    shell.toggleMenu()
    expect(menu.shown.at(-1)).toEqual([CHOICE, 'car'])
    shell.showVehicle('tank')
    expect(shell.onShow).toBe('showroom')
    expect(games[0]!.disposed).toBe(false)
    shell.frame(0.016)
    expect(games[0]!.updates.at(-1)).toEqual({ dt: 0.016, active: false })

    // Escape again: the showroom goes, the game goes on, in front.
    shell.toggleMenu()
    expect(menu.open).toBe(false)
    expect(showrooms[1]!.disposed).toBe(true)
    expect(shell.onShow).toBe('game')
    shell.frame(0.016)
    expect(games[0]!.updates.at(-1)).toEqual({ dt: 0.016, active: true })
  })

  it('goes back to the same game, and rejoins for a different vehicle or a second player', async () => {
    const { shell, games, joined, generated } = build()
    await shell.start(CHOICE)
    await shell.start(CHOICE)
    expect(joined).toHaveLength(1)
    expect(games[0]!.disposed).toBe(false)

    await shell.start({ ...CHOICE, vehicle: 'tank' })
    expect(joined).toHaveLength(2)
    expect(games[0]!.disposed).toBe(true)
    expect(games[1]!.kind).toBe('tank on 5')
    // The island is the server's, made once and kept.
    expect(generated).toEqual([5])

    await shell.start({ mode: 'duo', vehicle: 'tank', vehicle2: 'goKart' })
    expect(games[2]!.kind).toBe('tank+goKart on 5')
    expect(generated).toEqual([5])
  })

  it('draws what is in front and fills a HUD a player from the game', async () => {
    const { shell, hudStates, rendered } = build()
    await shell.start({ mode: 'duo', vehicle: 'sportsCar', vehicle2: 'semi' })
    hudStates.forEach((states) => states.splice(0))
    shell.frame(0.01)
    expect(rendered.at(-1)).toBe('sportsCar+semi on 5')
    expect(hudStates[0]!.at(-1)).toEqual({ title: 'sportsCar' })
    expect(hudStates[1]!.at(-1)).toEqual({ title: 'semi' })
    shell.toggleMenu()
    shell.showVehicle('semi')
    shell.frame(0.01)
    expect(rendered.at(-1)).toBe('showroom')
    expect(hudStates[0]!.at(-1)).toBeNull()
    expect(hudStates[1]!.at(-1)).toBeNull()
  })

  it('lets go of a join that something newer overtook', async () => {
    const { shell, games } = build()
    const first = shell.start(CHOICE)
    const second = shell.start({ ...CHOICE, vehicle: 'tank' })
    await Promise.all([first, second])
    expect(games).toHaveLength(2)
    expect(games[0]!.disposed).toBe(true)
    expect(games[1]!.disposed).toBe(false)
    expect(shell.playing).toBe(true)
  })

  it('puts the menu back up with the reason when the server cannot be joined', async () => {
    const { shell, menu } = build(5, 'refused')
    await shell.start(CHOICE)
    expect(shell.playing).toBe(false)
    expect(menu.open).toBe(true)
    expect(menu.notices.at(-1)).toBe(`could not join ${SERVER}: refused`)
  })

  it('knows when a choice is the game already on', () => {
    expect(continues(CHOICE, CHOICE)).toBe(true)
    expect(continues(CHOICE, { ...CHOICE, vehicle: 'tank' })).toBe(false)
    expect(continues(CHOICE, { ...CHOICE, vehicle2: 'tank' })).toBe(true)
    const duo: Choice = { ...CHOICE, mode: 'duo' }
    expect(continues(duo, { ...duo, vehicle2: 'tank' })).toBe(false)
    expect(continues(CHOICE, duo)).toBe(false)
    expect(playersFor(CHOICE).map((player) => player.profile)).toEqual(['sportsCar'])
    expect(playersFor(duo).map((player) => player.profile)).toEqual(['sportsCar', 'raceCar'])
  })
})
