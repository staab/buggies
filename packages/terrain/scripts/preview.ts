/**
 * A planet as text: its whole surface laid out longitude across and
 * latitude down, the sea, the land by height, the cities and suburbs, the
 * rivers and lakes and the roads on it, and a summary of what it has.
 */

import { DISTRICT_CITY, DISTRICT_SUBURB, DRY, ROAD_BRIDGE, ROAD_TUNNEL, generatePlanet, gridPlace, groundIndex, sphereHeight } from '../src/index.ts'

const seed = Number(process.argv[2] ?? 1)
const world = generatePlanet(seed)
const { ground, seaLevel } = world
const columns = 120
const rows = 50

/** Which character of the picture a way out falls on. */
const cellOf = (x: number, y: number, z: number): number => {
  const length = Math.sqrt(x * x + y * y + z * z) || 1
  const longitude = Math.atan2(x, z)
  const latitude = Math.asin(y / length)
  const col = Math.min(columns - 1, Math.floor(((longitude + Math.PI) / (2 * Math.PI)) * columns))
  const row = Math.min(rows - 1, Math.floor(((Math.PI / 2 - latitude) / Math.PI) * rows))
  return row * columns + col
}

let highest = seaLevel
for (const height of ground.heights) highest = Math.max(highest, height)
const place = { face: 0, i: 0, j: 0 }
const picture: string[] = []
for (let row = 0; row < rows; row++) {
  const latitude = Math.PI / 2 - ((row + 0.5) / rows) * Math.PI
  for (let col = 0; col < columns; col++) {
    const longitude = ((col + 0.5) / columns) * 2 * Math.PI - Math.PI
    const direction = { x: Math.cos(latitude) * Math.sin(longitude), y: Math.sin(latitude), z: Math.cos(latitude) * Math.cos(longitude) }
    const height = sphereHeight(ground, direction)
    gridPlace(ground.n, direction, place)
    const at = groundIndex(ground, place.face, Math.round(place.i), Math.round(place.j))
    const district = world.districtOf[at]
    let char = height <= seaLevel ? ' ' : height > seaLevel + (highest - seaLevel) * 0.6 ? '^' : height > seaLevel + (highest - seaLevel) * 0.3 ? ':' : '.'
    if (height > seaLevel && world.water[at] !== DRY) char = '~'
    if (district === DISTRICT_SUBURB) char = 's'
    if (district === DISTRICT_CITY) char = 'C'
    picture.push(char)
  }
}
for (const road of world.roads) {
  for (const [i, point] of road.points.entries()) {
    const structure = road.structure[Math.min(i, road.structure.length - 1)]
    picture[cellOf(point.x, point.y, point.z)] = structure === ROAD_TUNNEL ? 'T' : structure === ROAD_BRIDGE ? 'B' : road.kind === 'highway' ? '#' : road.kind === 'street' ? picture[cellOf(point.x, point.y, point.z)]! : '+'
  }
}

for (let row = 0; row < rows; row++) console.log(picture.slice(row * columns, (row + 1) * columns).join(''))
const kinds = new Map<string, number>()
for (const road of world.roads) kinds.set(road.kind, (kinds.get(road.kind) ?? 0) + 1)
console.log(`\nplanet ${seed}: radius ${world.radius.toFixed(0)} m, ${world.districts.length} cities, ${world.mountains.length} mountains, ${world.rivers.length} rivers, ${world.lakes.length} lakes`)
console.log(`roads: ${[...kinds].map(([kind, count]) => `${count} ${kind}`).join(', ')}`)
console.log(`${world.buildings.length} buildings, ${world.trees.length} trees and shrubs, ${world.rocks.length} rocks, ${world.props.length} props`)
