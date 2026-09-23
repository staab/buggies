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

/** A mode that only remembers what was done to it. */
interface StubMode extends ModeView {
  kind: string
  disposed: boolean
  updates: { dt: number; active: boolean }[]
  swapped: [VehicleProfileId, number][]
}

function stubMode(kind: string, hud: HudState[] = []): StubMode {
  const mode: StubMode = {
    kind,
    disposed: false,
    updates: [],
    swapped: [],
    camera: new THREE.PerspectiveCamera(),
    resize() {},
    update(dt, active) {
      mode.updates.push({ dt, active })
    },
    hud() {
      return hud
    },
    setVehicle(profile, player = 0) {
      mode.swapped.push([profile, player])
    },
    dispose() {
      mode.disposed = true
    },
  }
  return mode
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

const CHOICE: Choice = { mode: 'drive', seed: 5, vehicle: 'sportsCar', vehicle2: 'raceCar', server: 'ws://x' }

/** A shell with nothing real behind it, and a record of everything it made. */
function build(online: ShellModes['online'] = () => Promise.reject(new Error('no server'))) {
  const made = { drives: [] as StubMode[], islands: [] as StubMode[], showrooms: [] as StubShowroom[] }
  const generated: number[] = []
  const settled: Choice[] = []
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
    island: (map) => {
      const mode = stubMode(`island ${map.seed}`)
      mode.camera.name = mode.kind
      made.islands.push(mode)
      return mode
    },
    showroom: () => {
      const showroom = stubShowroom()
      showroom.camera.name = 'showroom'
      made.showrooms.push(showroom)
      return showroom
    },
    drive: (map, _scene, players) => {
      const mode = stubMode(`drive ${map.seed} ${players.map((player) => player.profile).join('+')}`, [
        { title: 'driving' },
      ])
      mode.camera.name = mode.kind
      made.drives.push(mode)
      return mode
    },
    online,
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
      islands: {
        generate: async (seed) => {
          generated.push(seed)
          return fakeMap(seed)
        },
      },
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
  return { shell, menu, made, generated, settled, hudStates, rendered }
}

/** Let every promise the shell is waiting on settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('the shell', () => {
  it('opens the menu with the island behind it, made once', async () => {
    const { shell, menu, made, generated } = build()
    shell.welcome()
    await settle()
    expect(menu.open).toBe(true)
    expect(generated).toEqual([5])
    expect(made.islands).toHaveLength(1)
    expect(shell.onShow).toBe('island')
    expect(menu.notices.at(-1)).toContain('seed 5')
    // Looking at the same island again makes nothing new.
    await shell.showIsland(5)
    expect(generated).toEqual([5])
    expect(made.islands).toHaveLength(1)
  })

  it('lets go of an island asked for before something else was', async () => {
    const { shell, made } = build()
    const looking = shell.showIsland(9)
    shell.showVehicle('tank')
    expect(await looking).toBe('')
    expect(made.islands).toHaveLength(0)
    expect(shell.onShow).toBe('showroom')
    expect(made.showrooms[0]!.vehicle).toBe('tank')
  })

  it('starts a drive, keeps it behind the menu, and comes back to it', async () => {
    const { shell, menu, made, settled } = build()
    await shell.start(CHOICE)
    expect(made.drives).toHaveLength(1)
    expect(made.drives[0]!.kind).toBe('drive 5 sportsCar')
    expect(shell.playing).toBe(true)
    expect(settled).toEqual([CHOICE])

    // Escape: the menu opens on the vehicle page, the showroom in front, the game still running.
    shell.toggleMenu()
    expect(menu.shown.at(-1)).toEqual([CHOICE, 'car'])
    shell.showVehicle('tank')
    expect(shell.onShow).toBe('showroom')
    expect(made.drives[0]!.disposed).toBe(false)
    shell.frame(0.016)
    expect(made.drives[0]!.updates.at(-1)).toEqual({ dt: 0.016, active: false })

    // Escape again: the showroom goes, the game goes on, in front.
    shell.toggleMenu()
    await settle()
    expect(menu.open).toBe(false)
    expect(made.showrooms[0]!.disposed).toBe(true)
    expect(shell.onShow).toBe('game')
    shell.frame(0.016)
    expect(made.drives[0]!.updates.at(-1)).toEqual({ dt: 0.016, active: true })
  })

  it('swaps the vehicle in place on the same island, and starts over on another', async () => {
    const { shell, made, generated } = build()
    await shell.start(CHOICE)
    await shell.start({ ...CHOICE, vehicle: 'tank' })
    expect(made.drives).toHaveLength(1)
    expect(made.drives[0]!.swapped).toEqual([['tank', 0]])
    expect(generated).toEqual([5])

    await shell.start({ ...CHOICE, mode: 'split', vehicle: 'tank', vehicle2: 'goKart' })
    expect(made.drives).toHaveLength(2)
    expect(made.drives[0]!.disposed).toBe(true)
    expect(made.drives[1]!.kind).toBe('drive 5 tank+goKart')
    await shell.start({ ...CHOICE, mode: 'split', vehicle: 'tank', vehicle2: 'semi' })
    expect(made.drives).toHaveLength(2)
    expect(made.drives[1]!.swapped).toEqual([['semi', 1]])

    await shell.start({ ...CHOICE, seed: 6 })
    expect(generated).toEqual([5, 6])
    expect(made.drives).toHaveLength(3)
    expect(made.drives[1]!.disposed).toBe(true)
  })

  it('draws what is in front and fills the HUDs from the game', async () => {
    const { shell, hudStates, rendered } = build()
    await shell.start(CHOICE)
    hudStates.forEach((states) => states.splice(0))
    shell.frame(0.01)
    expect(rendered.at(-1)).toBe('drive 5 sportsCar')
    expect(hudStates[0]!.at(-1)).toEqual({ title: 'driving' })
    expect(hudStates[1]!.at(-1)).toBeNull()
    shell.toggleMenu()
    shell.showVehicle('semi')
    shell.frame(0.01)
    expect(rendered.at(-1)).toBe('showroom')
    expect(hudStates[0]!.at(-1)).toBeNull()
  })

  it('puts the menu back up with the reason when a server cannot be joined', async () => {
    const { shell, menu } = build(() => Promise.reject(new Error('refused')))
    await shell.start({ ...CHOICE, mode: 'online' })
    expect(shell.playing).toBe(false)
    expect(menu.open).toBe(true)
    expect(menu.notices.at(-1)).toBe('could not join ws://x: refused')
  })

  it('knows when a choice is the game already on', () => {
    expect(continues(CHOICE, { ...CHOICE, vehicle: 'tank' })).toBe(true)
    expect(continues(CHOICE, { ...CHOICE, seed: 6 })).toBe(false)
    expect(continues(CHOICE, { ...CHOICE, mode: 'split' })).toBe(false)
    const online: Choice = { ...CHOICE, mode: 'online' }
    expect(continues(online, { ...online, seed: 99 })).toBe(true)
    expect(continues(online, { ...online, vehicle: 'tank' })).toBe(false)
    expect(playersFor(CHOICE).map((player) => player.profile)).toEqual(['sportsCar'])
    expect(playersFor({ ...CHOICE, mode: 'split' }).map((player) => player.profile)).toEqual(['sportsCar', 'raceCar'])
  })
})
