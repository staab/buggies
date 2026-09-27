import * as THREE from 'three'

// A planet this small curves away fast: from a car, the horizon is some
// forty meters off. What is drawn around the chase camera is bent as though
// the planet were bigger: every point keeps its height and how far it is
// from the car along the ground, but is laid on a sphere `scale` times the
// size, touching the planet under the car. Right by the car nothing moves;
// farther off the ground falls away more gently, and the horizon is further
// out. Only the drawing is bent; the game plays on the planet as it is.
//
// It is done in the vertex shader, where every material works out where a
// point is on the screen, so it bends everything alike: the ground, what
// stands on it, the cars. The shadow maps are drawn by materials of three's
// own, which know nothing of the bend and draw unbent: exact by the car,
// where the bend is nothing, and a little off further out.

/** How many times bigger than it is the planet is drawn round the camera. */
export const BEND_SCALE = 4

/** What every material bends by: whether it bends at all, the planet's radius, how much bigger it is drawn, and the way up at the car. */
const uniforms = {
  bendOn: { value: 0 },
  bendRadius: { value: 1 },
  bendScale: { value: BEND_SCALE },
  bendUp: { value: new THREE.Vector3(0, 1, 0) },
}

const DECLARATIONS = /* glsl */ `
uniform float bendOn;
uniform float bendRadius;
uniform float bendScale;
uniform vec3 bendUp;

vec4 bendAroundCar( vec4 world ) {
	if ( bendOn < 0.5 ) return world;
	vec3 p = world.xyz;
	float r = length( p );
	vec3 d = p / max( r, 1e-6 );
	float along = dot( d, bendUp );
	vec3 side = d - bendUp * along;
	float aside = length( side );
	// The angle round from the car, by its tangent: exact however small, as an arccosine is not.
	float angle = atan( aside, along );
	vec3 away = aside > 1e-7 ? side / aside : vec3( 0.0 );
	float big = bendRadius * bendScale;
	float bigAngle = angle / bendScale;
	float height = r - bendRadius;
	vec3 middle = bendUp * ( bendRadius - big );
	return vec4( middle + ( big + height ) * ( bendUp * cos( bigAngle ) + away * sin( bigAngle ) ), world.w );
}
`

const PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );

#ifdef USE_BATCHING

	mvPosition = batchingMatrix * mvPosition;

#endif

#ifdef USE_INSTANCING

	mvPosition = instanceMatrix * mvPosition;

#endif

mvPosition = viewMatrix * bendAroundCar( modelMatrix * mvPosition );

gl_Position = projectionMatrix * mvPosition;
`

/**
 * Put the bend into three's shaders, once, as this is first loaded: before
 * anything is compiled, since three keeps a compiled shader by its
 * material's settings and not its source. Put in any later, a material
 * already drawn goes on without it, and stands unbent in a bent world:
 * sunk into the ground far off, and rising out of it as it is come near.
 * Every material's vertex shader goes through it, and does nothing until
 * its material is given the settings and it is switched on.
 */
export function installBend(): void {
  if (THREE.ShaderChunk.project_vertex === PROJECT) return
  THREE.ShaderChunk.common = `${THREE.ShaderChunk.common}\n${DECLARATIONS}`
  THREE.ShaderChunk.project_vertex = PROJECT
}
installBend()

/**
 * Give every material under a root the bend's settings, the first time it
 * is seen: its shader then reads them from the one set every other shares.
 * A material marked `bent` already is left out, and is drawn unbent.
 */
export function bendMaterials(root: THREE.Object3D): void {
  root.traverse((node) => {
    const material = (node as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (material === undefined) return
    for (const one of Array.isArray(material) ? material : [material]) {
      if (one.userData.bent === true) continue
      one.userData.bent = true
      const before = one.onBeforeCompile.bind(one)
      one.onBeforeCompile = (shader, renderer) => {
        before(shader, renderer)
        Object.assign(shader.uniforms, uniforms)
      }
      // A key of its own, so it is compiled afresh and handed the settings: a material already
      // drawn, as the island is while it is chosen, is otherwise given its old program back, and
      // the settings never reach it.
      const key = one.customProgramCacheKey.bind(one)
      one.customProgramCacheKey = () => `${key()}:bent`
      one.needsUpdate = true
    }
  })
}

/** Bend what is drawn round a car here on a planet this big; or, with no planet, bend nothing. */
export function bendAround(at: { x: number; y: number; z: number } | null, radius = 1): void {
  if (at === null) {
    uniforms.bendOn.value = 0
    return
  }
  uniforms.bendOn.value = 1
  uniforms.bendRadius.value = radius
  uniforms.bendUp.value.set(at.x, at.y, at.z).normalize()
}
