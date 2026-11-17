import type { VehicleProfileId } from '@buggies/game'
import { ConnectionFailure, NO_ARRIVAL, REJECT_PROTOCOL_MISMATCH, type GameOptions, type GameSlotView, type GameSummary, type GameView, type LobbyEvents, type Standing } from '@buggies/net'
import { moonOf, worldId, worldKindOf, type World } from '@buggies/terrain'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import type { Sound } from './audio.ts'
import type { RoomHost } from './game-room.ts'
import type { HudState } from './hud.ts'
import type { Choice, DriveMode, FinishState, LiveMode, LocalDriver, ModeView, PlayRequest, PortalTrip, Screen, ShellModes, WatchRequest } from './mode.ts'
import { Shell, type ScreenHost, type ShellLobby, type ShellScreens } from './shell.ts'
import type { ShowroomView } from './showroom-mode.ts'
import { Sun } from './sun.ts'

const SERVER = 'ws://island:8787'
const CHOICE: Choice = { name: 'Ada', vehicle: 'sportsCar', game: 0 }
/** The island of the seed every game here is on. */
const ISLAND = worldId(5, 'planet')

/** An island, or any other world, with only what the shell asks of it. */
function fakeWorld(world: number): World {
  return { seed: world, kind: worldKindOf(world), radius: 600, districts: [], roads: [], rivers: [], lakes: [], portals: [{}, {}, {}] } as unknown as World
}

/** A game on the server that only remembers what was done to it. */
interface StubLobby extends ShellLobby {
  sent: string[]
  name: string
  refused: Error | null
  pushGames(games: readonly GameSummary[]): void
  pushGame(game: GameView | null): void
  closeSocket(why: string): void
}

/** A drive that only remembers what was done to it. */
interface StubGame extends DriveMode {
  /** The game's clock: never moved by a stub. */
  tick(): number
  kind: string
  through: number
  tripTo: PortalTrip | null
  dropped: string | null
  rows: readonly Standing[] | null
  /** How the player's own racer came, as the mode says: `null` while it races. */
  came: FinishState | null
  disposed: boolean
  updates: { dt: number; active: boolean }[]
}

/** A race looked on at that only remembers what was done to it. */
interface StubWatch extends LiveMode {
  tick(): number
  disposed: boolean
  /** Why its room closed, as the mode says: `null` while it is there. */
  reason: string | null
  updates: number
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
    vehicle: () => vehicle,
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

/** A box of the page, as far as a stage is concerned: one with no size, so nothing is drawn into it. */
function stubBox(): HTMLElement {
  return { getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0 }) } as unknown as HTMLElement
}

/** A screen that only remembers what was done to it. */
function stubScreens() {
  const name = {
    shown: [] as string[],
    visible: false,
    show(text: string) {
      name.visible = true
      name.shown.push(text)
    },
    hide() {
      name.visible = false
    },
  }
  const start = {
    visible: false,
    shows: 0,
    updates: 0,
    warnings: [] as string[],
    open: () => start.visible,
    show() {
      start.visible = true
      start.shows += 1
    },
    hide() {
      start.visible = false
    },
    update() {
      start.updates += 1
    },
    warn(text: string) {
      start.warnings.push(text)
    },
  }
  const room = {
    visible: false,
    shows: [] as (GameView | null)[],
    warnings: [] as string[],
    makings: [] as boolean[],
    /** Whether the car modal is open, with a stage in it to draw the turntable into. */
    carOpen: false,
    /** The host the room asks for a preview, and the seed whose worlds it has been showing. */
    host: null as RoomHost | null,
    seed: -1,
    open: () => room.visible,
    show(game: GameView | null) {
      room.visible = true
      room.shows.push(game)
      // Another seed is another set of worlds: the room goes back to the island on it, as the real one does.
      if (game !== null && game.options.seed !== room.seed) {
        room.seed = game.options.seed
        room.host?.previewWorld('planet')
      }
    },
    hide() {
      room.visible = false
      room.seed = -1
    },
    warn(text: string) {
      room.warnings.push(text)
    },
    worldBox: () => stubBox(),
    making: (making: boolean) => void room.makings.push(making),
    carBox: () => (room.carOpen ? stubBox() : null),
  }
  const standings = {
    visible: false,
    rows: [] as readonly Standing[],
    host: null as ScreenHost | null,
    open: () => standings.visible,
    show(rows: readonly Standing[]) {
      standings.visible = true
      standings.rows = rows
    },
    hide() {
      standings.visible = false
    },
    /** The button under it, as the real one has it. */
    back() {
      standings.host?.backToLobby()
    },
  }
  const finish = {
    visible: false,
    /** What it was shown, and what it was told after, as the race went on. */
    states: [] as FinishState[],
    updates: [] as FinishState[],
    rows: null as readonly Standing[] | null,
    host: null as ScreenHost | null,
    open: () => finish.visible,
    show(state: FinishState) {
      finish.visible = true
      finish.states.push(state)
      finish.rows = null
    },
    update(state: FinishState) {
      finish.updates.push(state)
    },
    standings(rows: readonly Standing[]) {
      finish.rows = rows
    },
    hide() {
      finish.visible = false
    },
    /** The button under the celebration, as the real one has it. */
    back() {
      finish.host?.backToLobby()
    },
  }
  return { name, start, room, standings, finish }
}

/** One slot of a game: a bot's, unless it says otherwise. */
function slot(patch: Partial<GameSlotView> = {}): GameSlotView {
  return { slot: 1, bot: true, member: 0, name: 'Axle', vehicle: 'raceCar', ready: true, driving: false, ...patch }
}

/** This tab's member's own slot, the host's unless it says otherwise. */
function ownSlot(patch: Partial<GameSlotView> = {}): GameSlotView {
  return slot({ slot: 0, bot: false, member: 1, name: 'Ada', vehicle: 'sportsCar', ready: false, ...patch })
}

function gameView(patch: Partial<GameView> = {}): GameView {
  const options: GameOptions = { mode: 'race', seed: 5, weapons: true, bananas: true, raceLength: 3 }
  return {
    id: 3,
    status: 'open',
    host: 1,
    options,
    slots: [ownSlot(), slot({ slot: 2, name: 'Bolt' })],
    you: 1,
    drivePass: 40,
    fault: null,
    ...patch,
  }
}

/** A game as the start screen lists it: a race waiting on the island of seed 5 unless it says otherwise. */
function summary(patch: Partial<GameSummary> = {}): GameSummary {
  return { id: 3, seed: 5, mode: 'race', status: 'open', host: 'Ada', humans: 1, slots: 4, leader: 0, demo: false, ...patch }
}

const STANDINGS: readonly Standing[] = [
  { place: 1, name: 'Ada', vehicle: 'sportsCar', seconds: 67, dnf: false, bot: false },
  { place: 2, name: 'Bo', vehicle: 'tank', seconds: 0, dnf: true, bot: false },
]

/** A shell with nothing real behind it, and a record of everything it made. */
function build(options: { name?: string; game?: number } = {}) {
  const screens = stubScreens()
  const lobbies: StubLobby[] = []
  const games: StubGame[] = []
  const watches: StubWatch[] = []
  const asked: WatchRequest[] = []
  const showrooms: StubShowroom[] = []
  const played: PlayRequest[] = []
  const failures: Error[] = []
  const generated: number[] = []
  const settled: Choice[] = []
  const hudStates: (HudState | null)[] = []
  const rendered: string[] = []
  const viewed: World[] = []

  const modes: ShellModes = {
    terrainView: (map) => {
      viewed.push(map)
      return new THREE.Group()
    },
    island: (map) => {
      const island: ModeView = {
        camera: new THREE.PerspectiveCamera(),
        resize() {},
        update() {},
        dispose() {},
      }
      island.camera.name = `island ${map.seed}`
      return island
    },
    showroom: () => {
      const showroom = stubShowroom()
      showrooms.push(showroom)
      return showroom
    },
    picture: async () => ({}) as HTMLCanvasElement,
    play: async (request) => {
      played.push(request)
      const failure = failures.shift()
      if (failure !== undefined) throw failure
      await request.mapFor(request.world, request.world === moonOf(5) ? [1] : null)
      const game: StubGame = {
        kind: `${request.driver.name} on ${request.world}`,
        through: -1,
        tripTo: null,
        dropped: null,
        rows: null,
        came: null,
        disposed: false,
        updates: [],
        camera: new THREE.PerspectiveCamera(),
        tick: () => 0,
        resize() {},
        update(dt, active) {
          game.updates.push({ dt, active })
        },
        hud() {
          return { title: game.kind }
        },
        portal() {
          const through = game.through
          game.through = -1
          return through
        },
        trip() {
          const trip = game.tripTo
          game.tripTo = null
          return trip
        },
        standings() {
          return game.rows
        },
        finished() {
          return game.came
        },
        lost() {
          return game.dropped
        },
        dispose() {
          game.disposed = true
        },
      }
      game.camera.name = game.kind
      games.push(game)
      return game
    },
    watch: async (request) => {
      asked.push(request)
      await request.mapFor(request.world, null)
      const watch: StubWatch = {
        reason: null,
        disposed: false,
        updates: 0,
        camera: new THREE.PerspectiveCamera(),
        tick: () => 0,
        resize() {},
        update() {
          watch.updates += 1
        },
        lost() {
          return watch.reason
        },
        render(renderer) {
          rendered.push(watch.camera.name)
          void renderer
        },
        dispose() {
          watch.disposed = true
        },
      }
      watch.camera.name = `watching ${request.game} in ${request.world}`
      watches.push(watch)
      return watch
    },
  }

  const makeLobby = (events: Partial<LobbyEvents>): StubLobby => {
    let latestGames: readonly GameSummary[] = []
    let latestGame: GameView | null = null
    const lobby: StubLobby = {
      sent: [],
      name: '',
      refused: null,
      games: () => [],
      game: () => null,
      async connect(name: string, game = 0) {
        lobby.name = name
        lobby.sent.push(`connect ${name} ${game}`)
        if (lobby.refused !== null) throw lobby.refused
      },
      create: (vehicle) => void lobby.sent.push(`create ${vehicle}`),
      join: (id, vehicle) => void lobby.sent.push(`join ${id} ${vehicle}`),
      addSlot: () => void lobby.sent.push('add slot'),
      removeSlot: (slot) => void lobby.sent.push(`remove slot ${slot}`),
      setBotVehicle: (slot, vehicle) => void lobby.sent.push(`bot ${slot} ${vehicle}`),
      leave: () => void lobby.sent.push('leave'),
      ready: (vehicle, ready) => void lobby.sent.push(`ready ${vehicle} ${ready ? 'yes' : 'no'}`),
      edit: (options) => void lobby.sent.push(`edit ${options.mode} ${options.seed} ${options.raceLength}`),
      start: () => void lobby.sent.push('start'),
      close: (why) => {
        lobby.sent.push(`close ${why}`)
        lobby.closeSocket(why)
      },
      pushGames(games) {
        latestGames = games
        events.onGames?.(games)
      },
      pushGame(game) {
        latestGame = game
        events.onGame?.(game)
      },
      closeSocket(why) {
        events.onClosed?.(why)
      },
    }
    lobby.games = () => latestGames
    lobby.game = () => latestGame
    lobbies.push(lobby)
    return lobby
  }

  const shell = new Shell(
    {
      renderer: {
        domElement: {} as HTMLCanvasElement,
        setSize() {},
        setViewport() {},
        setScissor() {},
        setScissorTest() {},
        getClearColor(target: THREE.Color) {
          return target
        },
        getClearAlpha() {
          return 1
        },
        setClearColor() {},
        clear() {},
        render(_scene: THREE.Object3D, camera: THREE.Camera) {
          rendered.push(camera.name)
        },
      } as unknown as THREE.WebGLRenderer,
      scene: new THREE.Scene(),
      container: { clientWidth: 800, clientHeight: 600 },
      hud: {
        render: (state: HudState | null) => void hudStates.push(state),
        notice: (text: string) => void hudStates.push({ title: text }),
      },
      sound: {} as Sound,
      sun: new Sun(),
      worlds: {
        generate: async (world) => {
          generated.push(world)
          return fakeWorld(world)
        },
      },
      server: SERVER,
      screens: (host: ScreenHost) => {
        // The screens hold the host, as the real ones do: a click is a call on it.
        screens.room.host = host
        screens.finish.host = host
        screens.standings.host = host
        return screens as unknown as ShellScreens
      },
      lobby: makeLobby,
      modes,
      settle: (choice) => void settled.push(choice),
    },
    { ...CHOICE, name: options.name ?? CHOICE.name, game: options.game ?? 0 },
  )
  return { shell, screens, lobbies, games, watches, asked, showrooms, played, failures, generated, settled, hudStates, rendered, modes, viewed }
}

/** Let every promise the shell is waiting on settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('the shell', () => {
  it('asks for a name when none is kept, and opens on the start screen when one is', async () => {
    const bare = build({ name: '' })
    bare.shell.welcome()
    expect(bare.shell.screen()).toBe('name')
    expect(bare.screens.name.visible).toBe(true)
    expect(bare.screens.start.visible).toBe(false)
    expect(bare.lobbies).toHaveLength(0)

    const known = build()
    known.shell.welcome()
    await settle()
    expect(known.shell.screen()).toBe('start')
    expect(known.screens.start.visible).toBe(true)
    expect(known.lobbies[0]!.sent[0]).toBe('connect Ada 0')

    // A name typed is taken, kept, and the start screen comes up under it.
    bare.shell.nameChosen('Bo')
    await settle()
    expect(bare.shell.choice().name).toBe('Bo')
    expect(bare.shell.screen()).toBe('start')
    expect(bare.lobbies[0]!.name).toBe('Bo')
  })

  it('opens the game the address bar names, and says when it is gone', async () => {
    const linked = build({ game: 7 })
    linked.shell.welcome()
    await settle()
    expect(linked.lobbies[0]!.sent[0]).toBe('connect Ada 7')

    // Not there: the server answers with the list, and the start screen says so.
    const gone = build({ game: 9 })
    gone.shell.welcome()
    await settle()
    expect(gone.shell.screen()).toBe('start')
    expect(gone.screens.start.warnings.at(-1)).toBe('that game is gone')
  })

  it('hosts a race and goes into its room, naming it in the address bar', async () => {
    const { shell, screens, lobbies, settled } = build()
    shell.welcome()
    await settle()
    shell.host()
    expect(lobbies[0]!.sent.at(-1)).toBe('create sportsCar')
    lobbies[0]!.pushGame(gameView())
    expect(shell.screen()).toBe('room')
    expect(screens.room.visible).toBe(true)
    expect(screens.room.shows.at(-1)?.id).toBe(3)
    expect(settled.at(-1)?.game).toBe(3)
  })

  it('takes a joiner into the room of the game it joins', async () => {
    const { shell, screens, lobbies, settled } = build()
    shell.welcome()
    await settle()
    shell.join(3)
    expect(lobbies[0]!.sent.at(-1)).toBe('join 3 sportsCar')
    lobbies[0]!.pushGame(gameView({ you: 2, slots: [slot(), ownSlot({ slot: 1, member: 2, vehicle: 'tank' })] }))
    expect(shell.screen()).toBe('room')
    expect(screens.room.shows.at(-1)?.you).toBe(2)
    expect(settled.at(-1)?.game).toBe(3)
    expect(shell.choice().vehicle).toBe('tank')
  })

  it('goes into the world once the race starts, in the member’s own vehicle, with its pass', async () => {
    const { shell, lobbies, played, generated } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView({ status: 'starting', slots: [ownSlot({ vehicle: 'tank', ready: true, driving: true }), slot({ slot: 2 })] }))
    await settle()
    expect(shell.screen()).toBe('drive')
    expect(played).toHaveLength(1)
    const request = played[0]!
    expect(request.game).toBe(3)
    expect(request.world).toBe(ISLAND)
    expect(request.arrival).toBe(NO_ARRIVAL)
    expect(request.driver).toEqual({ name: 'Ada', profile: 'tank', pass: 40 } satisfies LocalDriver)
    // The first world is made before the seat is asked for.
    expect(generated).toContain(ISLAND)
    // Another push does not join a second time.
    lobbies[0]!.pushGame(gameView({ status: 'racing', slots: [ownSlot({ vehicle: 'tank', ready: true, driving: true }), slot({ slot: 2 })] }))
    await settle()
    expect(played).toHaveLength(1)
  })

  it('goes into the world when a free drive’s player is ready', async () => {
    const { shell, lobbies, played, screens } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView({ options: { mode: 'free', seed: 5, weapons: true, bananas: true, raceLength: 3 } }))
    expect(shell.screen()).toBe('room')
    expect(played).toHaveLength(0)
    // Ready is what puts the member into a free drive's world.
    shell.ready(true)
    expect(lobbies[0]!.sent.at(-1)).toBe('ready sportsCar yes')
    lobbies[0]!.pushGame(gameView({ options: { mode: 'free', seed: 5, weapons: true, bananas: true, raceLength: 3 }, slots: [ownSlot({ ready: true, driving: true })] }))
    await settle()
    expect(shell.screen()).toBe('drive')
    expect(played).toHaveLength(1)
    expect(played[0]!.world).toBe(ISLAND)
    // Out again with Escape: not ready, and back in the room.
    shell.escape()
    await settle()
    expect(lobbies[0]!.sent.at(-1)).toBe('ready sportsCar no')
    expect(shell.screen()).toBe('room')
    expect(screens.room.visible).toBe(true)
  })

  it('follows the course through the gate out of each world', async () => {
    const { shell, lobbies, played, games } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView({ status: 'racing' }))
    await settle()
    expect(played).toHaveLength(1)
    games[0]!.tripTo = { to: moonOf(5), arrival: 1 }
    shell.frame(1 / 60)
    await settle()
    expect(games[0]!.disposed).toBe(true)
    expect(played).toHaveLength(2)
    expect(played[1]!.world).toBe(moonOf(5))
    expect(played[1]!.arrival).toBe(1)
    expect(played[1]!.driver.pass).toBe(40)
    expect(shell.driving()).toEqual({ game: 3, world: moonOf(5) })
  })

  it('draws the world being driven, as the race keeps it, and not the one the room showed', async () => {
    const { shell, lobbies, games, viewed } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView({ status: 'racing' }))
    await settle()
    games[0]!.tripTo = { to: moonOf(5), arrival: 1 }
    shell.frame(1 / 60)
    await settle()
    const last = viewed.at(-1)!
    expect(last.seed).toBe(moonOf(5))
    // Only the course's portal is drawn there: the rest are gone from the race's world.
    expect(last.portals).toHaveLength(1)
  })

  it('picks a world at random through a free drive’s portal, and comes back out of the one it left by', async () => {
    const { shell, lobbies, played, games } = build()
    const dice = vi.spyOn(Math, 'random').mockReturnValue(0)
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView({ options: { mode: 'free', seed: 5, weapons: true, bananas: true, raceLength: 3 }, slots: [ownSlot({ ready: true, driving: true })] }))
    await settle()
    expect(played).toHaveLength(1)

    games[0]!.through = 2
    shell.frame(1 / 60)
    await settle()
    expect(played.at(-1)!.world).toBe(moonOf(5))
    expect(played.at(-1)!.arrival).toBe(0)

    games[1]!.through = 0
    shell.frame(1 / 60)
    await settle()
    expect(played.at(-1)!.world).toBe(5)
    expect(played.at(-1)!.arrival).toBe(2)
    dice.mockRestore()
  })

  it('shows the standings of a racer who did not finish until they leave, with the way back to the lobby', async () => {
    const { shell, lobbies, screens, games } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView({ status: 'racing' }))
    await settle()
    games[0]!.rows = STANDINGS
    shell.frame(1 / 60)
    expect(shell.screen()).toBe('standings')
    expect(screens.standings.rows).toBe(STANDINGS)
    expect(games[0]!.disposed).toBe(true)

    // It stays as long as it takes: there is no timer taking it away.
    for (let second = 0; second < 20; second++) shell.frame(1)
    expect(shell.screen()).toBe('standings')
    expect(screens.standings.visible).toBe(true)

    // The button under it goes back to the start screen, out of the game.
    screens.standings.back()
    await settle()
    expect(lobbies[0]!.sent).toContain('leave')
    expect(shell.screen()).toBe('start')
    expect(screens.start.visible).toBe(true)
    expect(screens.start.updates).toBeGreaterThan(0)
  })

  it('throws a celebration when the player’s racer comes home, and keeps the drive behind it until they leave', async () => {
    const { shell, lobbies, screens, games, hudStates } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView({ status: 'racing' }))
    await settle()
    expect(shell.screen()).toBe('drive')

    games[0]!.came = { place: 2, of: 4, ticks: 8100, home: [{ place: 1, name: 'Bo' }] }
    hudStates.splice(0)
    shell.frame(0.016)
    expect(shell.screen()).toBe('finish')
    expect(screens.finish.visible).toBe(true)
    expect(screens.finish.states.at(-1)).toEqual({ place: 2, of: 4, ticks: 8100, home: [{ place: 1, name: 'Bo' }] })
    // The HUD is out of the way of it.
    expect(hudStates.at(-1)).toBeNull()
    // The drive is kept, and given no keys: the car brakes itself to a stop.
    expect(games[0]!.disposed).toBe(false)
    expect(shell.driving()).toEqual({ game: 3, world: ISLAND })
    games[0]!.updates.length = 0
    shell.frame(0.016)
    expect(games[0]!.updates.at(-1)).toEqual({ dt: 0.016, active: false })

    // Whoever else is home is kept up to date under the place.
    games[0]!.came = { place: 2, of: 4, ticks: 8100, home: [{ place: 1, name: 'Bo' }, { place: 3, name: 'Cy' }] }
    shell.frame(0.016)
    expect(screens.finish.updates.at(-1)?.home).toHaveLength(2)

    // The standings, once they come, go into the celebration and not onto a screen of their own.
    games[0]!.rows = STANDINGS
    shell.frame(0.016)
    expect(shell.screen()).toBe('finish')
    expect(screens.finish.rows).toBe(STANDINGS)
    expect(screens.standings.visible).toBe(false)

    // The button under it goes back to the lobby, out of the game, and the celebration goes.
    screens.finish.back()
    await settle()
    expect(lobbies[0]!.sent).toContain('leave')
    expect(shell.screen()).toBe('start')
    expect(screens.finish.visible).toBe(false)
    expect(games[0]!.disposed).toBe(true)
  })

  it('leaves the celebration with Escape, as the button does', async () => {
    const { shell, lobbies, games } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView({ status: 'racing' }))
    await settle()
    games[0]!.came = { place: 1, of: 3, ticks: 5400, home: [] }
    shell.frame(0.016)
    expect(shell.screen()).toBe('finish')
    shell.escape()
    await settle()
    expect(lobbies[0]!.sent).toContain('leave')
    expect(shell.screen()).toBe('start')
  })

  it('lets a finished race’s room close without joining it again, with the demo playing behind the celebration', async () => {
    const { shell, lobbies, screens, games, played, watches, asked, rendered } = build()
    shell.welcome()
    await settle()
    const demo = summary({ id: 9, demo: true, status: 'racing', host: '', humans: 0, slots: 4, leader: ISLAND })
    lobbies[0]!.pushGames([demo])
    shell.host()
    lobbies[0]!.pushGame(gameView({ status: 'racing' }))
    await settle()
    games[0]!.came = { place: 1, of: 4, ticks: 5400, home: [] }
    const askedBefore = asked.length
    shell.frame(1 / 60)
    expect(shell.screen()).toBe('finish')
    // The drive is drawn, so nothing is watched yet.
    expect(asked).toHaveLength(askedBefore)

    // The server closes the finished game's rooms: the drive is let go, not joined again.
    games[0]!.dropped = 'the room closed'
    const joined = played.length
    shell.frame(1 / 60)
    await settle()
    expect(games[0]!.disposed).toBe(true)
    expect(played).toHaveLength(joined)
    expect(shell.driving()).toBeNull()
    expect(shell.screen()).toBe('finish')
    expect(screens.finish.visible).toBe(true)

    // The demo plays behind the celebration in its place.
    expect(asked).toHaveLength(askedBefore + 1)
    expect(asked.at(-1)!.game).toBe(9)
    expect(watches.at(-1)!.disposed).toBe(false)
    shell.frame(1 / 60)
    expect(rendered.at(-1)).toBe(`watching 9 in ${ISLAND}`)
  })

  it('says to reload when the server has moved on while joining a world', async () => {
    const { shell, lobbies, screens, failures } = build()
    shell.welcome()
    await settle()
    shell.host()
    failures.push(new ConnectionFailure('protocol mismatch', REJECT_PROTOCOL_MISMATCH))
    lobbies[0]!.pushGame(gameView({ status: 'starting' }))
    await settle()
    expect(shell.screen()).toBe('start')
    expect(screens.start.warnings.at(-1)).toBe('The server has been updated: reload the page to play on.')
    expect(lobbies[0]!.sent).toContain('close left')
  })

  it('leaves the game from the room and from a race, naming the address bar as the start screen again', async () => {
    const { shell, lobbies, settled, games } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView())
    shell.escape()
    expect(lobbies[0]!.sent.at(-1)).toBe('leave')
    expect(shell.screen()).toBe('start')
    expect(settled.at(-1)?.game).toBe(0)

    // Out of a race altogether: the racer is out of it.
    lobbies[0]!.pushGame(gameView({ status: 'racing' }))
    await settle()
    expect(shell.screen()).toBe('drive')
    shell.escape()
    await settle()
    expect(shell.screen()).toBe('start')
    expect(games[0]!.disposed).toBe(true)
  })

  it('goes back to the start screen, and tries the lobby again, when the connection closes', async () => {
    const { shell, lobbies, screens } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView())
    lobbies[0]!.closeSocket('gone')
    await settle()
    expect(shell.screen()).toBe('start')
    expect(screens.start.warnings.at(-1)).toBe('lost the server (gone)')
    expect(lobbies).toHaveLength(2)
    expect(lobbies[1]!.sent[0]).toBe('connect Ada 0')
  })

  it('says the room has closed when the game goes out from under it', async () => {
    const { shell, lobbies, screens } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView({ options: { mode: 'free', seed: 5, weapons: true, bananas: true, raceLength: 3 } }))
    lobbies[0]!.pushGame(null)
    expect(shell.screen()).toBe('start')
    expect(screens.start.warnings.at(-1)).toBe('that game has closed')
  })

  it('turns the vehicle picked in the room, and tells the server it is that one', async () => {
    const { shell, lobbies, showrooms, screens } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView({ options: { mode: 'free', seed: 5, weapons: true, bananas: true, raceLength: 3 } }))
    shell.setVehicle('tank')
    expect(lobbies[0]!.sent.at(-1)).toBe('ready tank no')
    expect(showrooms[0]!.vehicle()).toBe('tank')
    expect(shell.choice().vehicle).toBe('tank')
    void screens
  })

  it('sends the host’s edits, the ready flag, the slots and the start', async () => {
    const { shell, lobbies } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView())
    shell.edit({ mode: 'race', seed: 12, weapons: false, bananas: true, raceLength: 4 })
    expect(lobbies[0]!.sent.at(-1)).toBe('edit race 12 4')
    shell.ready(true)
    expect(lobbies[0]!.sent.at(-1)).toBe('ready sportsCar yes')
    // The host and no one else may say how many slots there are, and what the bots drive.
    shell.addSlot()
    expect(lobbies[0]!.sent.at(-1)).toBe('add slot')
    shell.removeSlot(2)
    expect(lobbies[0]!.sent.at(-1)).toBe('remove slot 2')
    shell.setBotVehicle(1, 'pickup')
    expect(lobbies[0]!.sent.at(-1)).toBe('bot 1 pickup')
    shell.start()
    expect(lobbies[0]!.sent.at(-1)).toBe('start')
    expect(shell.isHost()).toBe(true)
  })

  it('draws the drive with the HUD, and nothing but the world behind a screen', async () => {
    const { shell, lobbies, games, hudStates, rendered } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView({ status: 'racing' }))
    await settle()
    hudStates.splice(0)
    rendered.splice(0)
    shell.frame(0.016)
    expect(games[0]!.updates.at(-1)).toEqual({ dt: 0.016, active: true })
    expect(hudStates.at(-1)).toEqual({ title: 'Ada on 5' })
    expect(rendered.at(-1)).toBe('Ada on 5')
    // A screen up over the drive: the car is not driven, but the game goes on.
    const standings: readonly Standing[] = []
    games[0]!.rows = standings
    shell.frame(0.016)
    expect(shell.screen()).toBe('standings')
    hudStates.splice(0)
    shell.frame(0.016)
    expect(hudStates.at(-1)).toBeNull()
  })

  it('remembers the screen it is on, so that a second frame draws what the first did', async () => {
    const { shell, lobbies, screens } = build()
    shell.welcome()
    await settle()
    expect(screens.start.open()).toBe(true)
    shell.host()
    lobbies[0]!.pushGame(gameView())
    const screen: Screen = shell.screen()
    expect(screen).toBe('room')
    expect(shell.driving()).toBeNull()
  })

  it('watches the server’s demo behind the start screen, which is no game of anybody’s', async () => {
    const { shell, lobbies, watches, asked, rendered } = build()
    shell.welcome()
    await settle()
    // The demo lines up first: with no leader's world there is nothing to look at yet.
    lobbies[0]!.pushGames([summary({ id: 9, demo: true, status: 'open', host: '', humans: 0, slots: 4 })])
    shell.frame(1 / 60)
    await settle()
    expect(asked).toHaveLength(0)

    // Under way, it plays behind the screen.
    lobbies[0]!.pushGames([summary({ id: 9, demo: true, status: 'racing', host: '', humans: 0, slots: 4, leader: ISLAND })])
    shell.frame(1 / 60)
    await settle()
    expect(asked).toHaveLength(1)
    expect(asked[0]!.game).toBe(9)
    expect(asked[0]!.world).toBe(ISLAND)
    expect(watches[0]!.disposed).toBe(false)
    expect(shell.watching()).toBe(0)
    // The demo is watched, not listed: the screen has no game to show.
    expect(shell.games().some((game) => game.demo)).toBe(true)

    // It plays: the frame is handed to it, and it draws the world.
    watches[0]!.updates = 0
    shell.frame(1 / 60)
    expect(watches[0]!.updates).toBe(1)
    expect(rendered.at(-1)).toBe(`watching 9 in ${ISLAND}`)
  })

  it('watches the race picked instead of the demo, and goes back to the demo when it is picked again', async () => {
    const { shell, lobbies, watches, asked } = build()
    shell.welcome()
    await settle()
    const demo = summary({ id: 9, demo: true, status: 'racing', host: '', humans: 0, slots: 4, leader: ISLAND })
    const race = summary({ id: 3, status: 'racing', leader: moonOf(5), humans: 3 })
    lobbies[0]!.pushGames([demo, race])
    shell.frame(1 / 60)
    await settle()
    expect(asked.at(-1)!.game).toBe(9)
    expect(shell.watching()).toBe(0)

    shell.watch(3)
    expect(shell.watching()).toBe(3)
    shell.frame(1 / 60)
    await settle()
    expect(watches[0]!.disposed).toBe(true)
    expect(asked.at(-1)!.game).toBe(3)
    expect(asked.at(-1)!.world).toBe(moonOf(5))
    expect(watches[1]!.disposed).toBe(false)

    // The same race again: back to the demo, which is what is watched when nothing is picked.
    shell.watch(3)
    expect(shell.watching()).toBe(0)
    shell.frame(1 / 60)
    await settle()
    expect(watches[1]!.disposed).toBe(true)
    expect(asked.at(-1)!.game).toBe(9)
    expect(asked.at(-1)!.world).toBe(ISLAND)
  })

  it('follows the leader of a watched race on to the world it has gone to, and lets the race go when it is over', async () => {
    const { shell, lobbies, watches, asked } = build()
    shell.welcome()
    await settle()
    lobbies[0]!.pushGames([summary({ id: 3, status: 'racing', leader: ISLAND })])
    shell.watch(3)
    shell.frame(1 / 60)
    await settle()
    expect(asked.at(-1)!.world).toBe(ISLAND)

    // The leader has gone through the portal: the watcher goes with it.
    lobbies[0]!.pushGames([summary({ id: 3, status: 'racing', leader: moonOf(5) })])
    shell.frame(1 / 60)
    await settle()
    expect(watches[0]!.disposed).toBe(true)
    expect(asked.at(-1)!.world).toBe(moonOf(5))

    // Its room closed under the watcher: another is opened where the leader is.
    watches[1]!.reason = 'the room closed'
    shell.frame(1 / 60)
    await settle()
    expect(watches[1]!.disposed).toBe(true)
    expect(watches[2]!.disposed).toBe(false)

    // Over: there is no race to follow, and the demo, if the server has one, is what plays.
    lobbies[0]!.pushGames([summary({ id: 3, status: 'finished', leader: 0 }), summary({ id: 9, demo: true, status: 'racing', host: '', humans: 0, slots: 4, leader: ISLAND })])
    shell.frame(1 / 60)
    await settle()
    expect(watches[2]!.disposed).toBe(true)
    expect(asked.at(-1)!.game).toBe(9)

    // The demo finished: nothing plays behind the screen any more.
    lobbies[0]!.pushGames([summary({ id: 4, status: 'open' })])
    shell.frame(1 / 60)
    await settle()
    expect(watches.at(-1)!.disposed).toBe(true)
    expect(shell.watching()).toBe(0)
  })

  it('stops watching once it goes into a game of its own', async () => {
    const { shell, lobbies, watches } = build()
    shell.welcome()
    await settle()
    lobbies[0]!.pushGames([summary({ id: 9, demo: true, status: 'racing', host: '', humans: 0, slots: 4, leader: ISLAND })])
    shell.frame(1 / 60)
    await settle()
    expect(watches[0]!.disposed).toBe(false)

    shell.host()
    lobbies[0]!.pushGame(gameView())
    expect(watches[0]!.disposed).toBe(true)
  })

  it('looks over another of the game’s seed’s worlds in the room, while the race still starts on the island', async () => {
    const { shell, lobbies, screens, viewed } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView())
    await settle()
    // The room opens on the island of the game's seed.
    expect(viewed.at(-1)!.seed).toBe(ISLAND)
    expect(screens.room.makings.at(-1)).toBe(false)

    shell.previewWorld('mars')
    await settle()
    expect(viewed.at(-1)!.seed).toBe(worldId(5, 'mars'))
    expect(screens.room.makings).toContain(true)

    // The race starts on the island all the same, whoever looked at what.
    lobbies[0]!.pushGame(gameView({ status: 'racing' }))
    await settle()
    expect(shell.screen()).toBe('drive')
    expect(viewed.at(-1)!.seed).toBe(ISLAND)
  })

  it('goes back to the island when the host rolls another seed', async () => {
    const { shell, lobbies, viewed } = build()
    shell.welcome()
    await settle()
    shell.host()
    lobbies[0]!.pushGame(gameView())
    await settle()
    shell.previewWorld('mercury')
    await settle()
    expect(viewed.at(-1)!.seed).toBe(worldId(5, 'mercury'))
    // Another seed is another set of worlds: the island of it, as the room asks for.
    lobbies[0]!.pushGame(gameView({ options: { mode: 'race', seed: 12, weapons: true, bananas: true, raceLength: 3 } }))
    await settle()
    expect(viewed.at(-1)!.seed).toBe(worldId(12, 'planet'))
  })
})
