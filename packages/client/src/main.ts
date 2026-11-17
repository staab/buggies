import { DEFAULT_VEHICLE_PROFILE, initPhysics } from '@buggies/game'
import { cleanName } from '@buggies/net'
import * as THREE from 'three'

import './styles.css'

import { Sound } from './audio.ts'
import { loadCarModels } from './car-model.ts'
import { FinishScreen } from './finish-screen.ts'
import { GameRoom } from './game-room.ts'
import { Hud } from './hud.ts'
import { playerKey } from './identity.ts'
import { NameScreen } from './name-screen.ts'
import { Shell } from './shell.ts'
import { Standings } from './standings.ts'
import { StartScreen } from './start-screen.ts'
import { Sun } from './sun.ts'
import { TerrainSource } from './terrain-source.ts'

/** Where the player's name is kept between visits. */
const NAME_KEY = 'buggies.name'

/** An element the page is built with: not there, and nothing else can be. */
function element(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`the page has no #${id}`)
  return found
}

const container = element('app')
const screensRoot = element('screens')
const sound = new Sound()
// Browsers hold sound back until the player has done something.
for (const gesture of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(gesture, () => sound.unlock())
}

// A speaker button in the corner mutes the sound and shows which way it is.
const muteButton = element('mute') as HTMLButtonElement
function setMuted(muted: boolean): void {
  sound.muted = muted
  muteButton.setAttribute('aria-pressed', String(muted))
  muteButton.setAttribute('aria-label', muted ? 'Unmute' : 'Mute')
  muteButton.title = muted ? 'Unmute' : 'Mute'
}
muteButton.addEventListener('click', () => {
  setMuted(!sound.muted)
  // The keys drive the game, not the button, once it has been clicked.
  muteButton.blur()
})

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
container.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#a9cbe6')
const sun = new Sun()
scene.add(sun.object)

/**
 * The game server: named at build time by VITE_SERVER_URL, or else the one
 * that served the page. Under Vite's dev server, that is the game server
 * beside it on port 8787.
 */
function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined
  if (configured) return configured
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  if (import.meta.env.DEV) return `${scheme}://${location.hostname || 'localhost'}:8787`
  return `${scheme}://${location.host}`
}

/** The name the player last went by here, if the browser kept it. */
function savedName(): string {
  try {
    return cleanName(localStorage.getItem(NAME_KEY) ?? '')
  } catch {
    return ''
  }
}

/**
 * What the address bar asks for: the game to open, as `/{gameId}`, or `0`
 * for the start screen. Who the player is was kept from last time; what to
 * drive is the game room's to ask.
 */
export function readDeepLink(): { game: number; name: string } {
  const given = location.pathname.split('/').find((part) => part !== '')
  const game = Number(given)
  return { game: Number.isInteger(game) && game > 0 ? game : 0, name: savedName() }
}

/** Reflect the game being played in the address bar, and keep the name gone by for next time. */
function settle(choice: { game: number; name: string }): void {
  history.replaceState(null, '', choice.game === 0 ? '/' : `/${choice.game}`)
  try {
    if (choice.name !== '') localStorage.setItem(NAME_KEY, choice.name)
  } catch {
    // Kept or not, it is asked for again on the first page.
  }
}

// The player's key, made and kept on their first visit: what proves to the server which seat is theirs.
playerKey()

const link = readDeepLink()
const hud = new Hud(element('hud'), element('radar'), element('banner'), element('achievement'), element('compass'))
const shell = new Shell(
  {
    renderer,
    scene,
    container,
    hud,
    sound,
    sun,
    worlds: new TerrainSource(),
    server: serverUrl(),
    screens: (host) => ({
      name: new NameScreen(screensRoot, (name) => host.nameChosen(name)),
      start: new StartScreen(screensRoot, host),
      room: new GameRoom(screensRoot, host),
      finish: new FinishScreen(element('finish'), sound, () => host.backToLobby()),
      standings: new Standings(screensRoot, () => host.backToLobby()),
    }),
    settle,
  },
  { name: link.name, vehicle: DEFAULT_VEHICLE_PROFILE, game: link.game },
)

// The physics engine is a wasm module, so it has to be ready before anything
// can be driven. It loads in well under a frame, and getting it out of the way
// up front beats a loading state in the middle of a session. The vehicles'
// models come in alongside it: every one of them, since anyone may turn up
// in any of them.
hud.notice('loading...')
await Promise.all([initPhysics(), loadCarModels()])
// Nothing is being waited for once they are in: the first screen says the rest.
shell.notice('')
shell.welcome()

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') shell.escape()
})

// A tab that is closed leaves its game: the server hears of it rather than waiting for the socket to be noticed.
window.addEventListener('pagehide', () => shell.unload())

window.addEventListener('resize', () => shell.resize())
shell.resize()

let last = performance.now()

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  shell.frame(dt)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
