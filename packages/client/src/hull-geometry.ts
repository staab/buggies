import * as THREE from 'three'

/**
 * A boat's hull in unit measure: a meter long along X, from the transom
 * at the stern to the stem at the bow, a meter in the beam along Z, its
 * keel at y = 0 and its gunwale at y = 1, rising a little toward the bow.
 * Lofted through a run of sections, with a V under it and the transom
 * flat, its faces left flat; the deck comes as a piece of its own, so it
 * can be another color.
 */
export function hullGeometry(): { skin: THREE.BufferGeometry; deck: THREE.BufferGeometry } {
  const sections = [
    { x: -0.5, w: 0.36 },
    { x: -0.3, w: 0.46 },
    { x: -0.05, w: 0.5 },
    { x: 0.2, w: 0.46 },
    { x: 0.38, w: 0.3 },
    { x: 0.5, w: 0.02 },
  ]
  const sheer = (x: number): number => 1 + 0.12 * Math.max(0, x + 0.1)
  // Each section around from the keel: the keel, the chine and the gunwale on the left, then the gunwale and the chine on the right.
  const rings = sections.map((s) => [
    [s.x, 0, 0],
    [s.x, 0.4, -s.w * 0.72],
    [s.x, sheer(s.x), -s.w],
    [s.x, sheer(s.x), s.w],
    [s.x, 0.4, s.w * 0.72],
  ])
  const outward = (triangles: number[]): THREE.BufferGeometry => {
    // Every face turned to face out from the hull's middle, whichever way it was wound.
    const positions: number[] = []
    for (let i = 0; i < triangles.length; i += 9) {
      const a = triangles.slice(i, i + 3)
      const b = triangles.slice(i + 3, i + 6)
      const c = triangles.slice(i + 6, i + 9)
      const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
      const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
      const normal = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!]
      const middle = [(a[0]! + b[0]! + c[0]!) / 3, (a[1]! + b[1]! + c[1]!) / 3 - 0.5, (a[2]! + b[2]! + c[2]!) / 3]
      const facing = normal[0]! * middle[0]! + normal[1]! * middle[1]! + normal[2]! * middle[2]!
      positions.push(...a, ...(facing < 0 ? c : b), ...(facing < 0 ? b : c))
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    return geometry
  }
  const skin: number[] = []
  const deck: number[] = []
  const quad = (into: number[], a: number[], b: number[], c: number[], d: number[]): void => {
    into.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  for (let i = 0; i + 1 < rings.length; i++) {
    const near = rings[i]!
    const far = rings[i + 1]!
    for (const [k, l] of [
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 0],
    ] as const) {
      quad(skin, near[k]!, near[l]!, far[l]!, far[k]!)
    }
    quad(deck, near[2]!, near[3]!, far[3]!, far[2]!)
  }
  // The transom, closing the stern.
  const stern = rings[0]!
  skin.push(...stern[0]!, ...stern[1]!, ...stern[2]!, ...stern[0]!, ...stern[2]!, ...stern[3]!, ...stern[0]!, ...stern[3]!, ...stern[4]!)
  return { skin: outward(skin), deck: outward(deck) }
}
