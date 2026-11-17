import type { VehicleProfileId } from '@buggies/game'
import type { Standing } from '@buggies/net'
import type { World } from '@buggies/terrain'
import type * as THREE from 'three'

import type { AchievementState } from './achievement-toast.ts'
import type { Sound } from './audio.ts'
import type { BannerState } from './banner.ts'
import type { ShowroomView } from './showroom-mode.ts'
import type { Sun } from './sun.ts'

/**
 * A screen of the game, and what it holds: the name asked for at the door;
 * the list of the server's games, with a race playing behind it; the room of
 * one; the world being driven; the celebration a racer's own finish throws
 * up, with the standings that go under it once they come; or the standings a
 * race of one who did not finish ends on.
 */
export type Page =
  | { readonly kind: 'name' }
  | { readonly kind: 'start' }
  | { readonly kind: 'room' }
  | { readonly kind: 'drive' }
  | { readonly kind: 'finish'; readonly came: FinishState; readonly standings: readonly Standing[] | null }
  | { readonly kind: 'standings'; readonly standings: readonly Standing[] }

/** Which screen is up: one at a time, from the name asked for at the door to the standings a race ends on. */
export type Screen = Page['kind']

/** What the player wants: who they go by, what they drive, and the game they are in, `0` for none. */
export interface Choice {
  name: string
  vehicle: VehicleProfileId
  game: number
}

/** The one player a tab drives, and the pass the server seats them by. */
export interface LocalDriver {
  name: string
  profile: VehicleProfileId
  pass: number
}

/** Where a portal leads: the world, and the portal there to come out of. */
export interface PortalTrip {
  to: number
  arrival: number
}

/**
 * One way of being on a map, as far as it is seen: it owns its camera and
 * whatever it adds to the scene; the shell owns the renderer, the lights and
 * the terrain itself. The world looked over, the showroom turntable and a
 * drive are all of these.
 */
export interface ModeView {
  readonly camera: THREE.PerspectiveCamera
  /** A scene of the mode's own to draw instead of the island's, if it has one. */
  readonly scene?: THREE.Scene
  resize(aspect: number): void
  /** `active` is false while a screen is up over the top and the player is not driving. */
  update(dt: number, active: boolean): void
  /** Draw itself, if it is not simply its scene through its camera. */
  render?(renderer: THREE.WebGLRenderer): void
  dispose(): void
}

/**
 * A mode the game goes on in, whether or not anyone is driving it: it keeps
 * the game's clock, and its connection to the server may be lost under it.
 * The drive's own is one, and so is a race looked on at.
 */
export interface LiveMode extends ModeView {
  /** The game's tick, the same on every mirror, for whatever on the island keeps time by it. */
  tick(): number
  /** Why the connection to the server was lost, if it has been, for the world to be joined again. */
  lost(): string | null
}

/**
 * A live mode with this player's own car in it: what the HUD says of the
 * drive, and what the shell reads of how the race is going, each at the
 * moment it is asked for. Nothing here is an accessor: every answer is asked
 * for with a method.
 */
export interface DriveMode extends LiveMode {
  /** What the HUD should say of the drive; nothing while it has nothing to say. */
  hud(): HudState | null
  /** The portal the player has driven through since last asked, or -1: in free drive, the shell picks where it leads. */
  portal(): number
  /** Where a race's next portal on the course leads, once the car is through it; nothing off the course. */
  trip(): PortalTrip | null
  /** How the race ended, once it has, for the standings; nothing while it is on. */
  standings(): readonly Standing[] | null
  /**
   * How the player's own racer came, from the moment it comes home: for the
   * celebration; nothing while it races, or in a free drive.
   */
  finished(): FinishState | null
}

/**
 * What every mode is made with, whatever it is for: the scene it draws into,
 * the server it talks to, and the world it is put in, made or on its way.
 */
export interface ModeRequest {
  scene: THREE.Scene
  /** The game server. */
  url: string
  /**
   * The world with this id, made or on its way; `keep` names the portals a race's world keeps,
   * or `null` for every portal it has. The same world again is the same world.
   */
  mapFor(world: number, keep: readonly number[] | null): Promise<World>
  sound: Sound
  sun: Sun
}

/** Everything a drive is made with: whose it is, where, and the world it is on. */
export interface PlayRequest extends ModeRequest {
  game: number
  /** The world to drive, by its id. */
  world: number
  /** The portal to arrive out of, or `NO_ARRIVAL` to start from the beginning of the world. */
  arrival: number
  driver: LocalDriver
}

/**
 * How the shell makes what it shows. Replaceable, so that the screens and
 * their comings and goings can be tested without a GPU, a keyboard or a server.
 */
export interface ShellModes {
  terrainView(map: World): THREE.Group
  island(map: World, scene: THREE.Scene, surface: HTMLElement): ModeView
  showroom(sound: Sound): ShowroomView
  /** An island drawn flat, 2 wide by 1 high, for a game's thumbnail on the start screen. */
  picture(world: number, pixels: number): Promise<HTMLCanvasElement>
  /** Join a game's world with a car of one's own in it. */
  play(request: PlayRequest): Promise<DriveMode>
  /** Look on at a game's world without a car of one's own in it. */
  watch(request: WatchRequest): Promise<LiveMode>
}

/**
 * Everything a watcher's view of a game is made with: the server, the game and
 * the world to look on at, and the world itself. A watcher takes no seat and
 * sends nothing; it follows whichever racer leads.
 */
export interface WatchRequest extends ModeRequest {
  game: number
  /** The world to watch, by its id. */
  world: number
}

/** What the HUD shows of a mode: a title always, and the driving gauges when someone is driving. */
export interface HudState {
  /** Who is driving what, where. */
  title: string
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
  /** How the car is keeping up with the server, in a line, for anyone wondering about a jump. */
  sync?: string
  /** Where everyone else is and which way the next gate is, for the mini-map. */
  radar?: RadarState
  /** How the race is going: where in it, how far along and how long. */
  race?: RaceHud
  /** Which way the next gate is, and how far, for the compass under the car: there all through a race. */
  arrow?: GateArrow
  /** A line of news, such as what is being waited for; nothing in free play. */
  game?: string
  /** The big words across the middle of the screen, for a race starting or over. */
  banner?: BannerState
  /** A feat just paid for, told of at the top of the screen. */
  achievement?: AchievementState
}

/** The way to the gate to head for, as the compass points it. */
export interface GateArrow {
  /** Radians clockwise from straight ahead of the car, which is straight up the screen. */
  angle: number
  /** How far it is, round the ground, in meters. */
  meters: number
  /** What its sign says: its number, or PORTAL, or FINISH. */
  label: string
}

/**
 * How the player's own race ended, for the celebration that goes up over the
 * drive: where the car came, out of how many, and how long it took.
 */
export interface FinishState {
  /** Where the car came, 1 upward. */
  place: number
  /** How many raced in all, for the "of N" under the place. */
  of: number
  /** The race's clock as the car crossed the line, in ticks since the go. */
  ticks: number
  /** The racers home so far in this world, in the order they came; the car's own is not among them. */
  home: readonly FinishedRacer[]
}

/** A racer that is home, as the celebration names it. */
export interface FinishedRacer {
  /** Where it came, 1 upward. */
  place: number
  /** The name it goes by. */
  name: string
}

/** How a race is going for the car the HUD belongs to. */
export interface RaceHud {
  /** Where it stands, 1 upward, out of everyone racing. */
  place: number
  of: number
  /** How many gates of this world it has passed, 0 before the first, out of how many there are. */
  checkpoint: number
  ofCheckpoints: number
  /** Which world of the course it is on, 1 upward, out of how many the race runs. */
  world: number
  ofWorlds: number
  /** How long it has been racing, in seconds. */
  seconds: number
}

/** Keys and what they do: `W` `A` `S` `D` "to drive". */
export interface ControlHint {
  keys: readonly string[]
  does: string
}

/** What the mini-map shows: where the car is and which way it faces, everyone else, and the course's gates. */
export interface RadarState {
  position: { x: number; z: number }
  forward: { x: number; z: number }
  others: readonly RadarBlip[]
  gates: readonly RadarGate[]
}

/** Someone else on the island, in their seat's color. */
export interface RadarBlip {
  x: number
  z: number
  color: number
}

/** A gate of the course, to be found by its number and followed to: the next one is the one to head for. */
export interface RadarGate {
  x: number
  z: number
  /** What the marker says, its number along the course. */
  label: string
  /** Whether this is the next gate to pass. */
  next: boolean
}
