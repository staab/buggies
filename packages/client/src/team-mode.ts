import type { TerrainMap } from '@buggies/terrain'
import * as THREE from 'three'

import type { Sound } from './audio.ts'
import type { ModeView } from './mode.ts'
import { joinOnline, type OnlinePlayer, type OnlineView } from './online-mode.ts'
import type { Sun } from './sun.ts'

/**
 * Everyone on this screen, on the server: one player with the whole screen,
 * or two side by side, each with their own connection, seat and view of the
 * same island. Each view draws only its own things, so that the other's car
 * is seen through this one's mirror and not twice over.
 */
export async function createTeamMode(
  scene: THREE.Scene,
  url: string,
  seed: number,
  players: readonly OnlinePlayer[],
  mapFor: (seed: number) => Promise<TerrainMap>,
  sound: Sound,
  sun: Sun,
): Promise<ModeView> {
  const locals = new Set<number>()
  const joins = await Promise.allSettled(
    players.map((player) => joinOnline(scene, url, seed, player, locals, mapFor, sound)),
  )
  const failed = joins.find((join): join is PromiseRejectedResult => join.status === 'rejected')
  if (failed !== undefined) {
    // One of them could not get on: neither plays.
    for (const join of joins) if (join.status === 'fulfilled') join.value.dispose()
    throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason))
  }
  const views = joins.map((join) => (join as PromiseFulfilledResult<OnlineView>).value)
  const split = views.length > 1
  const viewport = new THREE.Vector4()

  return {
    camera: views[0]!.camera,
    resize(aspect) {
      for (const view of views) view.resize(split ? aspect / views.length : aspect)
    },
    update(dt, active) {
      for (const view of views) view.update(dt, active)
    },
    render(renderer) {
      // The sun's shadows are drawn afresh for each view, around its own car.
      if (!split) {
        sun.follow(views[0]!.focus)
        renderer.render(scene, views[0]!.camera)
        return
      }
      renderer.getViewport(viewport)
      const { x, y, z: width, w: height } = viewport
      const each = Math.floor(width / views.length)
      renderer.setScissorTest(true)
      views.forEach((view, side) => {
        for (const other of views) other.root.visible = other === view
        sun.follow(view.focus)
        const left = x + side * each
        renderer.setViewport(left, y, each, height)
        renderer.setScissor(left, y, each, height)
        renderer.render(scene, view.camera)
      })
      for (const view of views) view.root.visible = true
      renderer.setScissorTest(false)
      renderer.setViewport(viewport)
    },
    hud() {
      return views.map((view) => view.hud())
    },
    dispose() {
      for (const view of views) view.dispose()
    },
  }
}
