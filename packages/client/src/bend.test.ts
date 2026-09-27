import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { BEND_SCALE, bendAround, bendMaterials } from './bend.ts'

/** What a material's shader is given when it compiles, as the renderer would hand it over. */
function compile(material: THREE.Material): Record<string, { value: unknown }> {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: '' }
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)
  return shader.uniforms
}

describe('the bend round the car', () => {
  it('puts itself where every material works out its place on the screen, and gives each the one set of settings', () => {
    const a = new THREE.MeshStandardMaterial()
    const b = new THREE.MeshBasicMaterial()
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), a), new THREE.Mesh(new THREE.BoxGeometry(), [a, b]))
    bendMaterials(scene)
    expect(THREE.ShaderChunk.project_vertex).toContain('bendAroundCar')
    expect(THREE.ShaderChunk.common).toContain('uniform float bendScale')
    const first = compile(a)
    const second = compile(b)
    expect(first.bendUp).toBe(second.bendUp)
    expect(first.bendScale!.value).toBe(BEND_SCALE)
    // Round a car on a planet: on, with its radius and the way up there.
    bendAround({ x: 0, y: 0, z: 612 }, 612)
    expect(first.bendOn!.value).toBe(1)
    expect(first.bendRadius!.value).toBe(612)
    expect((first.bendUp!.value as THREE.Vector3).z).toBeCloseTo(1, 9)
    // With no planet, nothing is bent.
    bendAround(null)
    expect(second.bendOn!.value).toBe(0)
  })

  it('keeps a material it has seen, and one marked as not to be bent, as they are', () => {
    const skip = new THREE.MeshBasicMaterial()
    skip.userData.bent = true
    const keep = new THREE.MeshBasicMaterial()
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), skip), new THREE.Mesh(new THREE.BoxGeometry(), keep))
    bendMaterials(scene)
    const hook = keep.onBeforeCompile
    // Compiled afresh under a key of its own, so a material drawn before is handed the settings too.
    expect(keep.customProgramCacheKey()).toMatch(/:bent$/)
    bendMaterials(scene)
    expect(keep.onBeforeCompile).toBe(hook)
    expect(keep.customProgramCacheKey()).not.toMatch(/:bent:bent$/)
    expect(compile(skip).bendOn).toBeUndefined()
  })
})
