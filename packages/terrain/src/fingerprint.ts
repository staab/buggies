import type { World } from './world.ts'

/**
 * A hash of everything about a planet that the physics reads, to the last
 * bit: its ground, bored and whole, every road's points and structure, every
 * building, tree, rock and prop where it starts, and every solid built on
 * the ground. Two machines that agree on it will agree on where a car lands.
 */
export function fingerprint(world: World): string {
  const hash = new Fnv1a()
  const point = (p: { x: number; y: number; z: number }): void => hash.numbers([p.x, p.y, p.z])
  const turn = (q: { x: number; y: number; z: number; w: number }): void => hash.numbers([q.x, q.y, q.z, q.w])
  hash.numbers(world.ground.heights)
  hash.numbers(world.bored)
  hash.number(world.seaLevel)
  for (const road of world.roads) {
    hash.text(road.kind)
    hash.number(road.closed ? 1 : 0)
    hash.numbers(road.widths)
    for (const p of road.points) point(p)
    hash.bytes(road.structure)
  }
  for (const building of world.buildings) {
    hash.text(building.kind)
    point(building.at)
    turn(building.turn)
    hash.numbers([building.width, building.depth, building.height])
  }
  for (const tree of world.trees) {
    hash.text(tree.kind)
    point(tree.at)
    hash.numbers([tree.height, tree.radius])
  }
  for (const rock of world.rocks) {
    hash.text(rock.kind)
    point(rock.at)
    turn(rock.turn)
    hash.number(rock.size)
  }
  for (const prop of world.props) {
    hash.text(prop.kind)
    point(prop.at)
    turn(prop.turn)
  }
  for (const mesh of [world.decks, world.rails, world.curbs, ...world.shells]) {
    hash.numbers(mesh.positions)
    hash.numbers(mesh.indices)
  }
  for (const kicker of world.kickers) hash.numbers(kicker)
  return hash.hex()
}

/** FNV-1a, 32 bits at a time over the exact bytes of every number, so a bit's difference shows. */
class Fnv1a {
  private state = 0x811c9dc5
  private readonly scratch = new DataView(new ArrayBuffer(8))

  private byte(value: number): void {
    this.state = Math.imul(this.state ^ value, 0x01000193) >>> 0
  }

  bytes(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.byte(values[i]! & 0xff)
  }

  number(value: number): void {
    this.scratch.setFloat64(0, value)
    for (let i = 0; i < 8; i++) this.byte(this.scratch.getUint8(i))
  }

  numbers(values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.number(values[i]!)
  }

  text(value: string): void {
    for (let i = 0; i < value.length; i++) this.byte(value.charCodeAt(i) & 0xff)
  }

  hex(): string {
    return this.state.toString(16).padStart(8, '0')
  }
}
