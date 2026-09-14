import {
  ARTERIAL_WIDTH,
  CROSS_WIDTH,
  DISTRICT_CITY,
  DISTRICT_SUBURB,
  ROAD_BRIDGE,
  ROAD_TUNNEL,
  STREET_WIDTH,
  generateTerrain,
  orientedTriangle,
  triangleCentroid,
} from '../src/index.ts'

const seed = Number(process.argv[2] ?? 1)
const map = generateTerrain(seed)
const { heightfield, seaLevel, rivers, lakes, mountains, districts, districtOf, roads } = map
const { width, depth, heights } = heightfield

const riverCells = new Set<number>()
for (const river of rivers) {
  for (const point of river.points) {
    const col = Math.min(Math.max(Math.floor(point.x / map.cellSize), 0), width - 1)
    const row = Math.min(Math.max(Math.floor(point.z / map.cellSize), 0), depth - 1)
    riverCells.add(row * width + col)
  }
}
const lakeCells = new Set<number>(lakes.flatMap((lake) => lake.cells))

interface Overlay {
  rank: number
  char: string
}
const roadAt = new Map<number, Overlay>()
for (const road of roads) {
  const segmentCount = road.closed ? road.points.length : road.points.length - 1
  for (let i = 0; i < segmentCount; i++) {
    const a = road.points[i]!
    const b = road.points[(i + 1) % road.points.length]!
    const structure = road.structure[i]!
    const char = structure === ROAD_BRIDGE ? 'B' : structure === ROAD_TUNNEL ? 'T' : road.closed ? '#' : '+'
    const rank = structure === ROAD_TUNNEL ? 11 : structure === ROAD_BRIDGE ? 9 : road.closed ? 10 : 8
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / map.cellSize))
    for (let k = 0; k <= steps; k++) {
      const x = a.x + ((b.x - a.x) * k) / steps
      const z = a.z + ((b.z - a.z) * k) / steps
      const col = Math.min(Math.max(Math.round(x / map.cellSize), 0), width - 1)
      const row = Math.min(Math.max(Math.round(z / map.cellSize), 0), depth - 1)
      const cell = row * width + col
      if ((roadAt.get(cell)?.rank ?? -1) < rank) roadAt.set(cell, { rank, char })
    }
  }
}

let maxHeight = 0
for (const height of heights) maxHeight = Math.max(maxHeight, height)

const columns = 100
const stride = Math.max(1, Math.ceil(width / columns))
const outWidth = Math.ceil(width / stride)
const outHeight = Math.ceil(depth / stride)
const grid: string[] = new Array(outWidth * outHeight).fill(' ')

const rank = (char: string): number =>
  char === 'T'
    ? 11
    : char === 'B'
      ? 10
      : char === '#'
        ? 9
        : char === '+'
          ? 8
          : char === 'o'
            ? 6
            : char === '*'
              ? 5
              : char === '~'
                ? 4
                : char === 'C'
                  ? 3
                  : char === 's'
                    ? 2
                    : char === ' '
                      ? 0
                      : 1

for (let row = 0; row < depth; row++) {
  for (let col = 0; col < width; col++) {
    const cell = row * width + col
    const height = heights[cell]!
    let char: string
    if (lakeCells.has(cell)) char = 'o'
    else if (riverCells.has(cell)) char = '*'
    else if (height <= seaLevel) char = '~'
    else if (districtOf[cell] === DISTRICT_CITY) char = 'C'
    else if (districtOf[cell] === DISTRICT_SUBURB) char = 's'
    else {
      const t = maxHeight > 0 ? height / maxHeight : 0
      char = t < 0.08 ? '.' : t < 0.28 ? '-' : t < 0.6 ? '^' : 'A'
    }
    const road = roadAt.get(cell)
    if (road && road.rank > rank(char)) char = road.char
    const out = Math.floor(row / stride) * outWidth + Math.floor(col / stride)
    if (rank(char) > rank(grid[out]!)) grid[out] = char
  }
}

const lines: string[] = []
for (let row = 0; row < outHeight; row++) lines.push(grid.slice(row * outWidth, (row + 1) * outWidth).join(''))

const lakeSizes = lakes
  .map((lake) => lake.cells.length)
  .sort((a, b) => b - a)
  .join(', ')

console.log(
  `seed ${seed}  world ${(width * map.cellSize).toFixed(0)} (${width}x${depth} cells @ ${map.cellSize})  maxHeight ${maxHeight.toFixed(1)}`,
)
console.log(`mountains ${mountains.length}  rivers ${rivers.length}  lakes ${lakes.length} [${lakeSizes}]`)
for (const mountain of mountains) {
  const center = triangleCentroid(orientedTriangle(mountain))
  console.log(
    `  mountain (${center.x.toFixed(0)},${center.z.toFixed(0)}) height ${mountain.height.toFixed(0)} skirt ${mountain.skirt.toFixed(0)}`,
  )
}
console.log(`districts ${districts.length}`)
for (const district of districts) {
  console.log(
    `  city ${district.id} at (${district.cx.toFixed(0)},${district.cz.toFixed(0)}) radius ${district.radius.toFixed(0)} suburbs +${district.suburbWidth.toFixed(0)} area ${district.area}`,
  )
}
for (const road of roads) {
  const segmentCount = road.closed ? road.points.length : road.points.length - 1
  let length = 0
  let bridges = 0
  let tunnels = 0
  for (let i = 0; i < segmentCount; i++) {
    const a = road.points[i]!
    const b = road.points[(i + 1) % road.points.length]!
    length += Math.hypot(b.x - a.x, b.z - a.z)
  }
  for (let i = 0; i < segmentCount; i++) {
    const structure = road.structure[i]!
    if (structure === ROAD_BRIDGE) bridges++
    else if (structure === ROAD_TUNNEL) tunnels++
  }
  const label = road.closed
    ? 'highway'
    : road.width === CROSS_WIDTH
      ? 'cross'
      : road.width === ARTERIAL_WIDTH
        ? 'arterial'
        : road.width === STREET_WIDTH
          ? 'street'
          : 'ramp'
  console.log(
    `  ${label} ${road.id}: ${road.points.length} points, ${road.closed ? 'closed' : 'open'}, width ${road.width}, length ${length.toFixed(0)}, grade ${segmentCount - bridges - tunnels} bridge ${bridges} tunnel ${tunnels}`,
  )
}
for (const river of rivers) {
  const start = river.points[0]!
  const end = river.points.at(-1)!
  console.log(
    `  river ${river.id}: ${river.points.length} points, start (${start.x.toFixed(0)},${start.z.toFixed(0)}) y${start.y.toFixed(1)} -> end (${end.x.toFixed(0)},${end.z.toFixed(0)}) y${end.y.toFixed(1)}`,
  )
}
console.log(
  'legend: ~ sea  . plains  - foothills  ^ mountains  A summit  * river  o lake  C city  s suburb  # highway  B bridge  T tunnel  + ramp',
)
console.log(lines.join('\n'))
