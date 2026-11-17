import { FIXED_TIMESTEP, MAX_PLAYERS, NEUTRAL_INPUT, createArena } from '@buggies/game'
import { NO_SEAT, NetClient, SpectatorMirror, rulesOf } from '@buggies/net'
import * as THREE from 'three'

import { ArenaView } from './arena-view.ts'
import { bendAround, bendMaterials } from './bend.ts'
import { ChaseCamera, createCameraTuning, createChaseTarget } from './chase-camera.ts'
import { cameraBounds } from './driver-hud.ts'
import { MirrorCars, type CarField } from './mirror-cars.ts'
import type { LiveMode, WatchRequest } from './mode.ts'
import { RaceView } from './race-view.ts'
import { SUN_DISTANCE } from './sun.ts'
import { WORLD_LOOKS } from './world-looks.ts'
import { WebSocketClientTransport } from './ws-transport.ts'

/**
 * The most simulation a single frame may cover. A tab that was in the
 * background for a minute should come back to the race as it is, not fast-forward it.
 */
const MAX_CATCH_UP = 0.25

/**
 * Watch a game's world with no car of one's own in it: a spectator's
 * connection, which is sent the race's plan and its snapshots as a player's
 * is but takes no seat and gives no input, and a mirror of the server's arena
 * drawn behind a chase camera. There is no HUD: the camera follows the racer
 * that leads this world, or, before anyone leads, the furthest round it, and
 * shows the gate that racer is heading for. When the room closes, the mode
 * says why and the view that made it goes elsewhere.
 */
export async function createWatchMode(request: WatchRequest): Promise<LiveMode> {
  const { scene, sound, sun } = request
  let lost: string | null = null
  const client = new NetClient(
    new WebSocketClientTransport(request.url),
    () => performance.now(),
    {
      onClosed: (reason) => {
        lost = reason
      },
    },
  )
  const welcome = await client.watch(request.game, request.world)
  // A race's gates and the portals its world keeps come with the welcome; a free drive builds the world whole.
  const plan = await client.racePlan()
  const map = await request.mapFor(welcome.seed, plan?.keep ?? null)
  // A mirror of the server's arena with every seat empty: the snapshots fill them, and soon.
  const mirror = createArena(map, MAX_PLAYERS, rulesOf(welcome.flags))
  const watched = new SpectatorMirror(mirror, client.startTick(), client.bananas)

  const root = new THREE.Group()
  scene.add(root)
  /** The cars, and the car their sounds fall on: the one being followed, from the first frame. */
  const field: CarField = { seats: mirror.seats, robots: mirror.robots, ufos: mirror.ufos, spiders: mirror.spiders, vehicle: mirror.seats[0]!.vehicle }
  const arena = new ArenaView(mirror, sound, () => field.vehicle.frame.position, mirror.planet)
  root.add(arena.object)
  const cars = new MirrorCars(field, NO_SEAT, arena.effects)
  root.add(cars.object)
  // The course's gates, bright on the one to head for and faint on the one after it.
  const gates = plan === null ? null : new RaceView(map, plan.checkpoints, plan.exit === null)
  if (gates !== null) root.add(gates.object)

  const cameraTuning = createCameraTuning()
  // Far enough to take in the whole world, and the sun beyond it.
  cameraTuning.far = Math.max(4 * Math.PI * mirror.planet.radius, SUN_DISTANCE * 1.5)
  const chase = new ChaseCamera(cameraTuning)
  chase.setBoundsAt(cameraBounds(mirror.planet))
  const target = createChaseTarget()

  /** The seat the camera is on, or `NO_SEAT` before the first snapshot has brought anyone. */
  let followedSeat = NO_SEAT
  let chaseSnapped = false

  /** The racer to keep the camera on: the best placed here, or, before anyone
   * has a place, the one furthest round this world. In a free drive, whoever
   * came first.
   */
  const leaderSeat = (): number => {
    const race = watched.race
    if (race === null) {
      for (const seat of mirror.seats) {
        if (seat.occupied) return seat.id
      }
      return NO_SEAT
    }
    let best = NO_SEAT
    let bestPlace = Number.POSITIVE_INFINITY
    let bestGates = -1
    for (const racer of race.racers) {
      const place = racer.place > 0 ? racer.place : Number.POSITIVE_INFINITY
      if (place > bestPlace || (place === bestPlace && racer.checkpoint <= bestGates)) continue
      best = racer.seat
      bestPlace = place
      bestGates = racer.checkpoint
    }
    return best
  }

  /** How many gates of this world the racer in this seat has passed, for the ones shown over the road. */
  const gatesPassed = (seat: number): number => {
    const race = watched.race
    if (race === null) return 0
    for (const racer of race.racers) {
      if (racer.seat === seat) return racer.checkpoint
    }
    return 0
  }

  /** Keep the eye on whoever leads, and the gates with it: as the race goes the car to watch changes. */
  const follow = (): void => {
    const seat = leaderSeat()
    if (seat !== followedSeat) {
      followedSeat = seat
      chaseSnapped = false
    }
    if (seat === NO_SEAT) return
    const car = mirror.seats[seat]
    if (car !== undefined) field.vehicle = car.vehicle
    gates?.show(gatesPassed(seat))
  }

  let owed = 0

  return {
    camera: chase.camera,
    // The game's time, as every mirror keeps it, so the day, the boats and the clouds are where they are for whoever is watching.
    tick: () => watched.tick(),
    render(renderer) {
      const { frame, up } = field.vehicle
      sun.follow(frame.position, up)
      sun.shade(scene, WORLD_LOOKS[map.kind].skies)
      bendMaterials(scene)
      bendAround(frame.position, map.radius)
      renderer.render(scene, chase.camera)
      bendAround(null)
    },
    resize(aspect) {
      chase.camera.aspect = aspect
      chase.camera.updateProjectionMatrix()
    },
    update(dt) {
      // There is no key to read and nothing to send: the race goes on whether or not a screen is up over it.
      owed = Math.min(owed + dt, MAX_CATCH_UP)
      while (owed >= FIXED_TIMESTEP) {
        const word = client.pump(NEUTRAL_INPUT)
        cars.reconciled(watched.take(word.newestSnapshot))
        watched.run(word.stepsFor)
        cars.stepped()
        arena.captureStep()
        owed -= FIXED_TIMESTEP
      }
      follow()
      cars.render(owed / FIXED_TIMESTEP, dt)
      arena.update(dt, owed / FIXED_TIMESTEP)
      if (followedSeat !== NO_SEAT && cars.aim(followedSeat, target)) {
        if (chaseSnapped) chase.update(dt, target)
        else {
          chase.snapTo(target)
          chaseSnapped = true
        }
      }
    },
    lost() {
      return lost
    },
    dispose() {
      client.close('left')
      cars.dispose()
      arena.dispose()
      gates?.dispose()
      watched.dispose()
      scene.remove(root)
    },
  }
}
