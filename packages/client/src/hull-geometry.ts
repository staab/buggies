import * as THREE from 'three'

/** One section of a hull across its beam: where it is along it, its half-beam at the gunwale, how high its keel is, and how high and how far out, of that half-beam, its chine is. */
interface Section {
  x: number
  w: number
  keel: number
  chine: number
  beam: number
}

/**
 * A boat's hull in unit measure: a meter long along X, from the transom
 * at the stern to the stem at the bow, a meter in the beam along Z, its
 * keel at y = 0 and its gunwale at y = 1, rising a little toward the bow.
 * Lofted through a run of sections, with a V under it and the transom
 * flat, its faces left flat; the deck comes as a piece of its own, so it
 * can be another color.
 */
export function hullGeometry(): { skin: THREE.BufferGeometry; deck: THREE.BufferGeometry } {
  const { bottom, topsides, deck } = loft(
    [
      { x: -0.5, w: 0.36 },
      { x: -0.3, w: 0.46 },
      { x: -0.05, w: 0.5 },
      { x: 0.2, w: 0.46 },
      { x: 0.38, w: 0.3 },
      { x: 0.5, w: 0.02 },
    ].map((s) => ({ ...s, keel: 0, chine: 0.4, beam: 0.72 })),
    0,
  )
  return { skin: outward([...bottom, ...topsides]), deck: outward(deck) }
}

/**
 * An amphibian's hull, in the same measure: full and flat-bottomed through
 * the middle, so its wheels sit in its sides, its bottom sweeping up into
 * the stem. It comes in three pieces that meet edge to edge, so each can
 * be its own color: the bottom, up to `waterline`; the topsides above it;
 * and the deck.
 */
export function amphibianHullGeometry(waterline: number): { bottom: THREE.BufferGeometry; topsides: THREE.BufferGeometry; deck: THREE.BufferGeometry } {
  const { bottom, topsides, deck } = loft(
    [
      { x: -0.5, w: 0.47, keel: 0.1 },
      { x: -0.32, w: 0.5, keel: 0 },
      { x: 0, w: 0.5, keel: 0 },
      { x: 0.3, w: 0.49, keel: 0.04 },
      { x: 0.4, w: 0.44, keel: 0.22 },
      { x: 0.47, w: 0.32, keel: 0.45 },
      { x: 0.5, w: 0.16, keel: 0.62 },
    ].map((s) => ({ ...s, chine: s.keel + 0.1, beam: 0.9 })),
    waterline,
  )
  return { bottom: outward(bottom), topsides: outward(topsides), deck: outward(deck) }
}

/** The triangles of a hull through these sections, closed at both ends, below and above the waterline and across the deck. */
function loft(sections: Section[], waterline: number): { bottom: number[]; topsides: number[]; deck: number[] } {
  const sheer = (x: number): number => 1 + 0.12 * Math.max(0, x + 0.1)
  // Each section around from the keel: the keel, then the chine, the waterline and the gunwale on the left, then the same on the right going back down.
  const rings = sections.map((s) => {
    const top = sheer(s.x)
    // Where the side, chine to gunwale, crosses the waterline: at the chine where the bottom is already above it.
    const t = Math.max(0, (waterline - s.chine) / (top - s.chine))
    const line = s.w * (s.beam + (1 - s.beam) * t)
    const y = s.chine + (top - s.chine) * t
    return [
      [s.x, s.keel, 0],
      [s.x, s.chine, -s.w * s.beam],
      [s.x, y, -line],
      [s.x, top, -s.w],
      [s.x, top, s.w],
      [s.x, y, line],
      [s.x, s.chine, s.w * s.beam],
    ]
  })
  const bottom: number[] = []
  const topsides: number[] = []
  const deck: number[] = []
  const quad = (into: number[], a: number[], b: number[], c: number[], d: number[]): void => {
    into.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  /** A flat end, closed across one ring: below the waterline, a fan from the keel; above it, the strip up to the gunwale. */
  const end = (ring: number[][]): void => {
    bottom.push(...ring[0]!, ...ring[1]!, ...ring[2]!, ...ring[0]!, ...ring[2]!, ...ring[5]!, ...ring[0]!, ...ring[5]!, ...ring[6]!)
    quad(topsides, ring[2]!, ring[3]!, ring[4]!, ring[5]!)
  }
  for (let i = 0; i + 1 < rings.length; i++) {
    const near = rings[i]!
    const far = rings[i + 1]!
    for (const [k, l] of [
      [0, 1],
      [1, 2],
      [5, 6],
      [6, 0],
    ] as const) {
      quad(bottom, near[k]!, near[l]!, far[l]!, far[k]!)
    }
    quad(topsides, near[2]!, near[3]!, far[3]!, far[2]!)
    quad(topsides, near[4]!, near[5]!, far[5]!, far[4]!)
    quad(deck, near[3]!, near[4]!, far[4]!, far[3]!)
  }
  // The transom, closing the stern, and the stem's face, closing the bow.
  end(rings[0]!)
  end(rings[rings.length - 1]!)
  return { bottom, topsides, deck }
}

/** Flat-faced geometry of these triangles. */
function outward(triangles: number[]): THREE.BufferGeometry {
  // Every face turned to face out from the hull's middle, whichever way it was wound, and those with no area left out.
  const positions: number[] = []
  for (let i = 0; i < triangles.length; i += 9) {
    const a = triangles.slice(i, i + 3)
    const b = triangles.slice(i + 3, i + 6)
    const c = triangles.slice(i + 6, i + 9)
    const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
    const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
    const normal = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!]
    if (Math.hypot(normal[0]!, normal[1]!, normal[2]!) < 1e-9) continue
    const middle = [(a[0]! + b[0]! + c[0]!) / 3, (a[1]! + b[1]! + c[1]!) / 3 - 0.5, (a[2]! + b[2]! + c[2]!) / 3]
    const facing = normal[0]! * middle[0]! + normal[1]! * middle[1]! + normal[2]! * middle[2]!
    positions.push(...a, ...(facing < 0 ? c : b), ...(facing < 0 ? b : c))
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}
