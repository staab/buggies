import {
  DISTRICT_CITY,
  DISTRICT_SUBURB,
  generateTerrain,
  orientedTriangle,
  triangleCentroid,
} from '../src/index.ts'

const seed = Number(process.argv[2] ?? 1)
const map = generateTerrain(seed)
const { heightfield, seaLevel, rivers, lakes, mountains, districts, districtOf } = map
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

let maxHeight = 0
for (const height of heights) maxHeight = Math.max(maxHeight, height)

const columns = 100
const stride = Math.max(1, Math.ceil(width / columns))
const outWidth = Math.ceil(width / stride)
const outHeight = Math.ceil(depth / stride)
const grid: string[] = new Array(outWidth * outHeight).fill(' ')

const rank = (char: string): number =>
  char === 'o' ? 6 : char === '*' ? 5 : char === '~' ? 4 : char === 'C' ? 3 : char === 's' ? 2 : char === ' ' ? 0 : 1

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

console.log(`seed ${seed}  size ${width}x${depth}  maxHeight ${maxHeight.toFixed(1)}`)
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
for (const river of rivers) {
  const start = river.points[0]!
  const end = river.points.at(-1)!
  console.log(
    `  river ${river.id}: ${river.points.length} points, start (${start.x.toFixed(0)},${start.z.toFixed(0)}) y${start.y.toFixed(1)} -> end (${end.x.toFixed(0)},${end.z.toFixed(0)}) y${end.y.toFixed(1)}`,
  )
}
console.log('legend: ~ sea  . plains  - foothills  ^ mountains  A summit  * river  o lake  C city  s suburb')
console.log(lines.join('\n'))
