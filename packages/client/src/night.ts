import * as THREE from 'three'

/**
 * How far the sun is below the horizon, and above it, as day turns to night
 * and back: as the sine of its height over the horizon.
 */
export const DUSK = { below: -0.08, above: 0.12 } as const

/**
 * The way to the sun from the planet's middle, as the sun last said: shared
 * by every material lit by the night, so each point of the planet is lit by
 * its own time of day and not by the time where the play is.
 */
const sunWay = { value: new THREE.Vector3(0, 1, 0) }

/** Say which way the sun is, for everything lit by the night. */
export function setSunWay(way: THREE.Vector3): void {
  sunWay.value.copy(way).normalize()
}

/** How dark it is at a point, by the sun's height over its horizon there: 0 by day to 1 at night. */
export function nightAt(point: { x: number; y: number; z: number }): number {
  const length = Math.hypot(point.x, point.y, point.z) || 1
  const way = sunWay.value
  const height = (point.x * way.x + point.y * way.y + point.z * way.z) / length
  return 1 - THREE.MathUtils.smoothstep(height, DUSK.below, DUSK.above)
}

const VERTEX = /* glsl */ `
vec4 nightPoint = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
nightPoint = instanceMatrix * nightPoint;
#endif
vNightPoint = (modelMatrix * nightPoint).xyz;
`

const NIGHT_HERE = /* glsl */ `
float nightHere = 1.0 - smoothstep(${DUSK.below.toFixed(3)}, ${DUSK.above.toFixed(3)}, dot(normalize(vNightPoint), sunWay));
`

/**
 * Have a material's shader lit only where it is night, by the time of day
 * where each point of it is: its glow, from within, or how much of it shows
 * at all, for a glow laid over what is behind it. Called from the
 * material's `onBeforeCompile`, before any other change to its shader.
 */
export function litByNight(shader: THREE.WebGLProgramParametersWithUniforms, what: 'emissive' | 'alpha'): void {
  shader.uniforms.sunWay = sunWay
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vNightPoint;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX}`)
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 sunWay;\nvarying vec3 vNightPoint;')
  shader.fragmentShader =
    what === 'emissive'
      ? shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${NIGHT_HERE}totalEmissiveRadiance *= nightHere;`)
      : shader.fragmentShader.replace('#include <opaque_fragment>', `${NIGHT_HERE}diffuseColor.a *= nightHere;\n#include <opaque_fragment>`)
}
