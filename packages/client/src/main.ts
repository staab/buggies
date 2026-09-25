import {
  DEFAULT_VEHICLE_PROFILE,
  VEHICLE_PROFILE_IDS,
  initPhysics,
  type VehicleProfileId,
} from '@buggies/game'
import * as THREE from 'three'

import './styles.css'

import { Sound } from './audio.ts'
import { loadCarModels } from './car-model.ts'
import { Hud } from './hud.ts'
import { Menu, type Choice, type Mode } from './menu.ts'
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
 * next to whichever address the page was opened on.
 */
function serverUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined
  if (configured) return configured
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.hostname || 'localhost'}:8787`
}

function randomSeed(): number {
  return Math.floor(Math.random() * 100000)
}

/** What the address bar asks for, with something sensible for whatever it leaves out. */
function readChoice(): Choice {
  const params = new URLSearchParams(location.search)
  const seed = Number(params.get('seed'))
  const mode: Mode = params.get('mode') === 'duo' ? 'duo' : 'solo'
  const profile = (name: string, fallback: VehicleProfileId): VehicleProfileId => {
    const given = params.get(name)
    return VEHICLE_PROFILE_IDS.includes(given as VehicleProfileId) ? (given as VehicleProfileId) : fallback
  }
  return {
    mode,
    seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : randomSeed(),
    vehicle: profile('vehicle', DEFAULT_VEHICLE_PROFILE),
    vehicle2: profile('vehicle2', VEHICLE_PROFILE_IDS[1] ?? DEFAULT_VEHICLE_PROFILE),
  }
}

/** Reflect what is being played in the address bar. */
function settle(choice: Choice): void {
  const url =
    `?mode=${choice.mode}&seed=${choice.seed}&vehicle=${choice.vehicle}` +
    (choice.mode === 'duo' ? `&vehicle2=${choice.vehicle2}` : '')
  history.replaceState(null, '', url)
}

const shell = new Shell(
  {
    renderer,
    scene,
    container,
    // One HUD a viewport: the left, or only, and the right of a split screen.
    huds: [new Hud(element('hud')), new Hud(element('hud-right'))],
    sound,
    sun,
    islands: new TerrainSource(),
    server: serverUrl(),
    createMenu: (host, choice) => new Menu(element('menu'), choice, host),
    settle,
  },
  readChoice(),
)

// The physics engine is a wasm module, so it has to be ready before anything
// can be driven. It loads in well under a frame, and getting it out of the way
// up front beats a loading state in the middle of a session. The vehicles'
// models come in alongside it: every one of them, since anyone may turn up
// in any of them.
shell.notice('loading...')
await Promise.all([initPhysics(), loadCarModels()])
shell.welcome()

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') shell.toggleMenu()
})

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
