import { DEFAULT_VEHICLE_PROFILE, initPhysics } from '@buggies/game'
import { planetSeedOf } from '@buggies/terrain'
import * as THREE from 'three'

import './styles.css'

import { Sound } from './audio.ts'
import { loadCarModels } from './car-model.ts'
import { GameMenu } from './game-menu.ts'
import { Hud } from './hud.ts'
import { Menu, type Choice } from './menu.ts'
import { Shell } from './shell.ts'
import { Sun } from './sun.ts'
import { TerrainSource } from './terrain-source.ts'

/** An element the page is built with: not there, and nothing else can be. */
function element(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`the page has no #${id}`)
  return found
}

const container = element('app')
const sound = new Sound()
// Browsers hold sound back until the player has done something.
for (const gesture of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(gesture, () => sound.unlock())
}

// A speaker button in the corner mutes the sound and shows which way it is.
const muteButton = document.getElementById('mute') as HTMLButtonElement
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

function randomSeed(): number {
  return Math.floor(Math.random() * 100000)
}

/** What the address bar asks for: the island, as `/{seed}`, or a fresh one; a moon's names its planet. What to drive is the menu's to ask. */
function readChoice(): Choice {
  // Links from before the seed moved into the path still name it as `?seed=`.
  const given = location.pathname.split('/').find((part) => part !== '') ?? new URLSearchParams(location.search).get('seed')
  const seed = Number(given)
  const planet = Number.isInteger(seed) && seed > 0 ? planetSeedOf(seed) : 0
  return {
    seed: planet > 0 ? planet : randomSeed(),
    vehicle: DEFAULT_VEHICLE_PROFILE,
  }
}

/** Reflect the island being played in the address bar. */
function settle(choice: Choice): void {
  history.replaceState(null, '', `/${choice.seed}`)
}

const shell = new Shell(
  {
    renderer,
    scene,
    container,
    huds: [new Hud(element('hud'), element('radar'))],
    sound,
    sun,
    islands: new TerrainSource(),
    server: serverUrl(),
    createMenu: (host, choice) => new Menu(element('menu'), choice, host),
    settle,
  },
  readChoice(),
)

// A trophy beside the speaker, while an island is being played, opens a panel of games to play.
const games = new GameMenu(element('games'), {
  map: () => shell.played?.map ?? null,
  position: () => shell.played?.position?.() ?? null,
  game: () => shell.played?.game?.() ?? null,
  race: () => shell.played?.race?.() ?? null,
  setGame: (game) => shell.played?.setGame?.(game),
})
shell.overlay = games
const gamesButton = element('trophy') as HTMLButtonElement
gamesButton.addEventListener('click', () => {
  games.toggle()
  // The keys drive the game, not the button, once it has been clicked.
  gamesButton.blur()
})

// The physics engine is a wasm module, so it has to be ready before anything
// can be driven. It loads in well under a frame, and getting it out of the way
// up front beats a loading state in the middle of a session. The vehicles'
// models come in alongside it: every one of them, since anyone may turn up
// in any of them.
shell.notice('loading...')
await Promise.all([initPhysics(), loadCarModels()])
shell.welcome()

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  // Escape shuts the games panel first, if it is open, and only then opens the menu.
  if (games.open) games.hide()
  else shell.toggleMenu()
})

window.addEventListener('resize', () => shell.resize())
shell.resize()

let last = performance.now()

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  shell.frame(dt)
  // The trophy is there while a game is being played and the menu is down.
  const playable = shell.played?.setGame !== undefined && !shell.menu.open
  gamesButton.hidden = !playable
  if (!playable && games.open) games.hide()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
