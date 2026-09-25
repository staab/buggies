import type { TerrainMap } from './types.ts'

/**
 * A hash of everything about an island that the physics reads, to the
 * last bit: the heights, every road's points and structure, every
 * building, every tree and every rock. Two machines that agree on it will
 * agree on where a car lands.
 */
export function fingerprint(map: TerrainMap): string {
  const hash = new Fnv1a()
  hash.numbers(map.heightfield.heights)
  hash.number(map.seaLevel)
  for (const road of map.roads) {
    hash.text(road.kind)
    hash.number(road.closed ? 1 : 0)
    hash.number(road.width)
    for (const point of road.points) hash.numbers([point.x, point.y, point.z])
    hash.bytes(road.structure)
  }
  for (const building of map.buildings) {
    hash.text(building.kind)
    hash.numbers([building.x, building.z, building.yaw, building.width, building.depth, building.bottom, building.top])
  }
  for (const tree of map.trees) {
    hash.text(tree.kind)
    hash.numbers([tree.x, tree.z, tree.bottom, tree.height, tree.radius])
  }
  for (const rock of map.rocks) {
    hash.text(rock.kind)
    hash.numbers([rock.x, rock.z, rock.bottom, rock.size, rock.yaw])
  }
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
