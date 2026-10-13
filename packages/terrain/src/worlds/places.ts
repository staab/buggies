/**
 * The places a world past the planet is laid out round: its cities,
 * stations, villages and caverns, each a middle and a reach, scattered
 * apart over the sphere; which of them are linked, by road or tunnel; and
 * the ways out among and about them that things are placed at.
 */

import * as exact from '@buggies/physics'
import { randomRange, type Rng, type Vec3 } from '@buggies/physics'

import { randomDirection } from '../world-queries.ts'
import type { WorldDistrict } from '../world.ts'
import { fromFrame } from '../globe/frame.ts'
import { angleBetween, slerp } from '../globe/lines.ts'
import { axisAt, eachPointNear, spotFrame, type Land } from '../globe/placing.ts'

const { cos, sin } = exact

/** A place: the way out through its middle, and how far it reaches along the ground. */
export interface Place {
  readonly center: Vec3
  readonly reach: number
}

/** A link between two places, by their indices. */
export type Link = readonly [number, number]

/** Places scattered over the sphere, each `apart` from every other along the ground, and passing `fits`; as many as are wanted, or as many as are found. */
export function scatterPlaces(rng: Rng, radius: number, wanted: number, apart: (a: number, b: number) => number, reachOf: () => number, fits: (place: Place) => boolean = () => true, tries = 600): Place[] {
  const places: Place[] = []
  for (let attempt = 0; attempt < tries && places.length < wanted; attempt++) {
    const place = { center: randomDirection(rng), reach: reachOf() }
    if (places.some((other) => angleBetween(place.center, other.center) * radius < apart(place.reach, other.reach))) continue
    if (fits(place)) places.push(place)
  }
  return places
}

/**
 * Which places to link: a tree of the shortest links that joins them all,
 * and then the next shortest that do not, as many as `extra`, each linking
 * two not yet linked; each only where `fits` allows it beside those
 * already chosen, so the tree may leave some apart.
 */
export function linkPlaces(centers: readonly Vec3[], extra: number, fits: (link: Link, chosen: readonly Link[]) => boolean = () => true): Link[] {
  const pairs: { link: Link; apart: number }[] = []
  for (let a = 0; a < centers.length; a++) for (let b = a + 1; b < centers.length; b++) pairs.push({ link: [a, b], apart: angleBetween(centers[a]!, centers[b]!) })
  pairs.sort((p, q) => p.apart - q.apart || p.link[0] - q.link[0] || p.link[1] - q.link[1])
  const parent = centers.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const links: Link[] = []
  const spare: Link[] = []
  for (const { link } of pairs) {
    const [a, b] = link
    if (find(a) === find(b)) spare.push(link)
    else if (fits(link, links)) {
      parent[find(a)] = find(b)
      links.push(link)
    }
  }
  for (const link of spare) {
    if (extra <= 0) break
    if (!fits(link, links)) continue
    links.push(link)
    extra--
  }
  return links
}

/** Which of so many places, `wanted` of them or all there are, picked at random. */
export function someOf(rng: Rng, count: number, wanted: number): number[] {
  const order = Array.from({ length: count }, (_, k) => k)
  for (let k = 0; k < Math.min(wanted, count); k++) {
    const other = k + Math.floor(rng() * (count - k))
    ;[order[k], order[other]] = [order[other]!, order[k]!]
  }
  return order.slice(0, wanted)
}

/** Every pair of places, to link each with every other. */
export function linkAll(count: number): Link[] {
  const links: Link[] = []
  for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) links.push([a, b])
  return links
}

/** The way out this far along the ground from a way out, toward another. */
export function toward(from: Vec3, to: Vec3, distance: number, radius: number): Vec3 {
  return slerp(from, to, distance / radius / angleBetween(from, to))
}

/** A way out within a round reach of a middle and beyond `inner`, picked evenly over the ring between. */
export function pointIn(rng: Rng, center: Vec3, reach: number, radius: number, inner = 0): Vec3 {
  const frame = spotFrame(center, axisAt(center, 0), radius)
  const r = Math.sqrt(randomRange(rng, inner * inner, reach * reach))
  const angle = randomRange(rng, 0, Math.PI * 2)
  return fromFrame(frame, cos(angle) * r, sin(angle) * r)
}

/** Ways out evenly round a middle, `count` of them this far from it along the ground. */
export function ringAround(center: Vec3, distance: number, count: number, radius: number): Vec3[] {
  const frame = spotFrame(center, axisAt(center, 0), radius)
  return Array.from({ length: count }, (_, k) => fromFrame(frame, cos((2 * Math.PI * k) / count) * distance, sin((2 * Math.PI * k) / count) * distance))
}

/** The ground's grid marked as a kind of district (`DISTRICT_*`) over each place's reach, and as country elsewhere. */
export function markDistricts(land: Land, places: readonly Place[], district: number): Uint8Array {
  const districtOf = new Uint8Array(land.ground.heights.length)
  for (const place of places) eachPointNear(land, place.center, place.reach, (at) => (districtOf[at] = district))
  return districtOf
}

/** A place as the world has it among its cities: numbered. */
export function districtOfPlace(id: number, place: Place): WorldDistrict {
  return { id, center: place.center, radius: place.reach, suburbWidth: 0, area: Math.PI * place.reach * place.reach, island: 0 }
}
