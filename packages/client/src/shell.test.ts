import type { VehicleProfileId } from '@buggies/game'
import { NO_ARRIVAL } from '@buggies/net'
import { isMoon, moonOf, type World } from '@buggies/terrain'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { Sound } from './audio.ts'
import type { HudState } from './hud.ts'
import type { Choice, MenuHost, Step } from './menu.ts'
import type { ModeView } from './mode.ts'
import { Shell, continues, sameSeats, type ShellMenu, type ShellModes } from './shell.ts'
import type { ShowroomView } from './showroom-mode.ts'
import { Sun } from './sun.ts'

/** A game that only remembers what was done to it. */
interface StubGame extends ModeView {
  kind: string
  /** The portal to say was driven through when next asked, if any. */
  through: number
  /** Why the connection to the server is to be said lost, if it is. */
  dropped: string | null
  disposed: boolean
  updates: { dt: number; active: boolean }[]
  /** The vehicles the player was swapped into, where they were, one entry a swap. */
  swaps: VehicleProfileId[]
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
    dispose() {
      showroom.disposed = true
    },
  }
  showroom.camera.name = 'showroom'
  return showroom
}

function fakeMap(seed: number): World {
  return { seed, kind: isMoon(seed) ? 'moon' : 'planet', radius: 600, districts: [], roads: [], rivers: [], lakes: [], portals: [] } as unknown as World
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

const CHOICE: Choice = { seed: 5, vehicle: 'sportsCar' }
const SERVER = 'ws://island:8787'

/** An island being looked over, that only remembers what was done to it. */
interface StubIsland extends ModeView {
  seed: number
  disposed: boolean
}

/** A shell with nothing real behind it, and a record of everything it made. */
function build(refuse: string | null = null) {
  const games: StubGame[] = []
  const showrooms: StubShowroom[] = []
  const islands: StubIsland[] = []
  const generated: number[] = []
  const settled: Choice[] = []
  const joined: string[] = []
  const arrivals: (number | undefined)[] = []
  const passed: (number | undefined)[] = []
  const hudStates: (HudState | null)[] = []
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
    island: (map) => {
      const island: StubIsland = {
        seed: map.seed,
        disposed: false,
        camera: new THREE.PerspectiveCamera(),
        resize() {},
        update() {},
        dispose() {
          island.disposed = true
        },
      }
      island.camera.name = `island ${map.seed}`
      islands.push(island)
      return island
    },
    showroom: () => {
      const showroom = stubShowroom()
      showrooms.push(showroom)
      return showroom
    },
    peek: async () => [],
    rooms: async (url) => {
      if (refuse !== null) throw new Error(refuse)
      return [{ seed: url.length, players: 3 }]
    },
    play: async (_scene, url, seed, profile, mapFor, _sound, _sun, arrival, pass) => {
      joined.push(`${url}#${seed}`)
      arrivals.push(arrival)
      passed.push(pass)
      if (refuse !== null) throw new Error(refuse)
      await mapFor(seed)
      const game: StubGame = {
        kind: `${profile} on ${seed}`,
        through: -1,
        portal() {
          const through = game.through
          game.through = -1
          return through
        },
        dropped: null,
        lost() {
          return game.dropped
        },
        pass() {
          return 40
        },
        disposed: false,
        updates: [],
        swaps: [],
        camera: new THREE.PerspectiveCamera(),
        resize() {},
        update(dt, active) {
          game.updates.push({ dt, active })
        },
        hud() {
          return { title: profile }
        },
        changeVehicle(next) {
          game.swaps.push(next)
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
      hud: {
        render: (state: HudState | null) => void hudStates.push(state),
        notice: (text: string) => void hudStates.push({ title: text }),
      },
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
  return { shell, menu, games, showrooms, islands, generated, settled, joined, arrivals, passed, hudStates, rendered }
}

/** Let every promise the shell is waiting on settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('the shell', () => {
  it('opens the menu with the island coming up behind it, made once', async () => {
    const { shell, menu, islands, generated, settled } = build()
    shell.welcome()
    await settle()
    expect(menu.open).toBe(true)
    expect(generated).toEqual([5])
    expect(islands).toHaveLength(1)
    expect(shell.onShow).toBe('island')
    // Looking at the same island again makes nothing new; another seed does.
    expect(await shell.showIsland(5)).toContain('seed 5')
    expect(generated).toEqual([5])
    await shell.showIsland(9)
    expect(generated).toEqual([5, 9])
    // The address bar names the island picked, before any game is started on it.
    expect(settled.at(-1)?.seed).toBe(9)
    expect(islands[0]!.disposed).toBe(true)
    expect(islands[1]!.seed).toBe(9)
  })

  it('puts the vehicle turning in front, and lets go of an island something newer overtook', async () => {
    const { shell, islands, showrooms } = build()
    const looking = shell.showIsland(9)
    shell.showVehicle('tank')
    expect(await looking).toBe('')
    expect(islands).toHaveLength(0)
    expect(shell.onShow).toBe('showroom')
    expect(showrooms[0]!.vehicle).toBe('tank')
    // Another vehicle turns on the same turntable.
    shell.showVehicle('semi')
    expect(showrooms).toHaveLength(1)
    expect(showrooms[0]!.vehicle).toBe('semi')
  })

  it('joins the room for the island, made once, and keeps the game behind the menu', async () => {
    const { shell, menu, games, showrooms, generated, settled, joined } = build()
    shell.welcome()
    await settle()
    await shell.start(CHOICE)
    expect(joined).toEqual([`${SERVER}#5`])
    expect(games).toHaveLength(1)
    expect(games[0]!.kind).toBe('sportsCar on 5')
    expect(generated).toEqual([5])
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
    await settle()
    expect(menu.open).toBe(false)
    expect(showrooms[0]!.disposed).toBe(true)
    expect(shell.onShow).toBe('game')
    shell.frame(0.016)
    expect(games[0]!.updates.at(-1)).toEqual({ dt: 0.016, active: true })
  })

  it('goes back to the same game, swaps vehicles where the car is, and rejoins for another island', async () => {
    const { shell, games, joined, generated } = build()
    await shell.start(CHOICE)
    await shell.start(CHOICE)
    expect(joined).toHaveLength(1)
    expect(games[0]!.disposed).toBe(false)

    // Another vehicle is the same seat on the same island, in something else.
    await shell.start({ ...CHOICE, vehicle: 'tank' })
    expect(joined).toHaveLength(1)
    expect(games[0]!.disposed).toBe(false)
    expect(games[0]!.swaps).toEqual(['tank'])
    await shell.start({ ...CHOICE, vehicle: 'tank' })
    expect(games[0]!.swaps).toHaveLength(1)

    // The island is kept: it is the same one.
    expect(generated).toEqual([5])

    // Another island is another room, made afresh.
    await shell.start({ ...CHOICE, seed: 6 })
    expect(joined.at(-1)).toBe(`${SERVER}#6`)
    expect(games[0]!.disposed).toBe(true)
    expect(games[1]!.kind).toBe('sportsCar on 6')
    expect(generated).toEqual([5, 6])
  })

  it('draws what is in front and fills a HUD a player from the game', async () => {
    const { shell, hudStates, rendered } = build()
    await shell.start({ ...CHOICE, vehicle: 'semi' })
    hudStates.splice(0)
    shell.frame(0.01)
    expect(rendered.at(-1)).toBe('semi on 5')
    expect(hudStates.at(-1)).toEqual({ title: 'semi' })
    shell.toggleMenu()
    shell.showVehicle('semi')
    shell.frame(0.01)
    expect(rendered.at(-1)).toBe('showroom')
    expect(hudStates.at(-1)).toBeNull()
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
    const { shell, menu } = build('refused')
    await shell.start(CHOICE)
    expect(shell.playing).toBe(false)
    expect(menu.open).toBe(true)
    expect(menu.notices.at(-1)).toBe(`Could not join ${SERVER}: refused`)
  })

  it('asks the server which islands are busy, and has none to offer when it cannot say', async () => {
    expect(await build().shell.listRooms()).toEqual([{ seed: SERVER.length, players: 3 }])
    expect(await build('down').shell.listRooms()).toEqual([])
  })

  it('takes everyone through a portal to the moon, and back out of the portal they left the planet by', async () => {
    const { shell, games, joined, arrivals } = build()
    await shell.start(CHOICE)
    await settle()
    games[0]!.through = 2
    shell.frame(1 / 60)
    await settle()
    expect(games[0]!.disposed).toBe(true)
    expect(joined.at(-1)).toBe(`${SERVER}#${moonOf(5)}`)
    expect(arrivals.at(-1)).toBe(0)
    games[1]!.through = 0
    shell.frame(1 / 60)
    await settle()
    expect(joined.at(-1)).toBe(`${SERVER}#5`)
    expect(arrivals.at(-1)).toBe(2)
    expect(games[1]!.disposed).toBe(true)
    expect(shell.onShow).toBe('game')
  })

  it('joins the same world again when the connection is lost, showing the passes it was given', async () => {
    const { shell, games, joined, arrivals, passed } = build()
    await shell.start(CHOICE)
    await settle()
    games[0]!.dropped = 'connection closed'
    shell.frame(1 / 60)
    await settle()
    expect(games[0]!.disposed).toBe(true)
    expect(joined).toEqual([`${SERVER}#5`, `${SERVER}#5`])
    expect(arrivals.at(-1)).toBe(NO_ARRIVAL)
    expect(passed.at(-1)).toBe(40)
    expect(games[1]!.kind).toBe('sportsCar on 5')
    expect(shell.onShow).toBe('game')
  })

  it('knows when a choice is the game already on', () => {
    expect(continues(CHOICE, CHOICE)).toBe(true)
    expect(continues(CHOICE, { ...CHOICE, seed: 6 })).toBe(false)
    expect(continues(CHOICE, { ...CHOICE, vehicle: 'tank' })).toBe(false)
    expect(sameSeats(CHOICE, { ...CHOICE, vehicle: 'tank' })).toBe(true)
    expect(sameSeats(CHOICE, { ...CHOICE, seed: 6 })).toBe(false)
  })
})
