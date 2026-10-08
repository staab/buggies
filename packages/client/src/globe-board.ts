import * as THREE from 'three'

import type { Vec3 } from '@buggies/physics'
import type { World } from '@buggies/terrain'

import { drawIsland } from './island-picture.ts'

/** How many pixels round the planet's picture is drawn, laid over the globe. */
const PICTURE_PIXELS = 1024

/** How near and how far the camera can be from the middle, in the planet's radii. */
const NEAREST = 1.25
const FARTHEST = 4

/** How far a press can wander and still be a click rather than a drag, in pixels. */
const CLICK_SLOP = 4

/** How many radians the globe turns for a pixel dragged, at the farthest. */
const TURN_PER_PIXEL = 0.008

/** A mark on the globe, and what to draw it as. */
export interface GlobeMark {
  at: Vec3
  color: string
  label: string
}

/** What is drawn over the globe: a course through marks, and where the player is. */
export interface GlobeScene {
  course: readonly GlobeMark[]
  here: Vec3 | null
}

/**
 * The picture is laid on by each pixel's own way out from the middle, not
 * by the sphere's corners, so the seam where longitude wraps never shows.
 */
const GLOBE_VERTEX = /* glsl */ `
  varying vec3 vOut;
  varying vec3 vNormal;
  void main() {
    vOut = position;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const GLOBE_FRAGMENT = /* glsl */ `
  uniform sampler2D picture;
  varying vec3 vOut;
  varying vec3 vNormal;
  const float PI = 3.141592653589793;
  void main() {
    vec3 out_ = normalize(vOut);
    vec2 uv = vec2((atan(out_.x, out_.z) + PI) / (2.0 * PI), 0.5 + asin(clamp(out_.y, -1.0, 1.0)) / PI);
    vec3 color = texture2D(picture, uv).rgb;
    float light = 0.45 + 0.55 * max(dot(normalize(vNormal), normalize(vec3(-0.35, 0.45, 1.0))), 0.0);
    gl_FragColor = vec4(color * light, 1.0);
    #include <colorspace_fragment>
  }
`

/**
 * The planet as a globe to pick spots on: dragged to turn it, wheeled to
 * draw nearer, clicked to pick the spot under the pointer. Marks, the
 * course between them and the player are drawn over it, on the near side
 * only.
 */
export class GlobeBoard {
  readonly element: HTMLDivElement
  private readonly pixels: number
  private readonly onPick: (out: Vec3) => void
  private readonly overlay: HTMLCanvasElement
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20)
  private readonly scene = new THREE.Scene()
  private readonly globe: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>
  private renderer: THREE.WebGLRenderer | null = null
  private picture: { seed: number; texture: THREE.CanvasTexture } | null = null
  private drawn: GlobeScene = { course: [], here: null }
  private press: { id: number; x: number; y: number; moved: boolean } | null = null

  constructor(pixels: number, onPick: (out: Vec3) => void) {
    this.pixels = pixels
    this.onPick = onPick
    this.element = document.createElement('div')
    this.element.className = 'globe'
    this.overlay = document.createElement('canvas')
    this.element.append(this.overlay)
    this.globe = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: { picture: { value: null } },
        vertexShader: GLOBE_VERTEX,
        fragmentShader: GLOBE_FRAGMENT,
      }),
    )
    this.scene.add(this.globe)
    this.camera.position.set(0, 0, 3)

    this.element.addEventListener('pointerdown', (event) => {
      this.press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
      this.element.setPointerCapture(event.pointerId)
    })
    this.element.addEventListener('pointermove', (event) => this.drag(event))
    this.element.addEventListener('pointerup', (event) => {
      const press = this.press
      this.press = null
      this.element.classList.remove('turning')
      if (press?.id === event.pointerId && !press.moved) this.pick(event)
    })
    this.element.addEventListener('pointercancel', () => {
      this.press = null
      this.element.classList.remove('turning')
    })
    this.element.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault()
        const distance = this.camera.position.z * Math.exp(event.deltaY * 0.001)
        this.camera.position.z = Math.min(Math.max(distance, NEAREST), FARTHEST)
        this.paint()
      },
      { passive: false },
    )
  }

  /** Turn the globe so this spot faces the viewer, north up. */
  face(point: Vec3): void {
    const length = Math.hypot(point.x, point.y, point.z) || 1
    const longitude = Math.atan2(point.x, point.z)
    const latitude = Math.asin(Math.min(Math.max(point.y / length, -1), 1))
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -longitude)
    const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), latitude)
    this.globe.quaternion.copy(pitch.multiply(yaw))
  }

  /** Draw this planet, and what is over it. */
  draw(world: World, scene: GlobeScene): void {
    if (this.picture?.seed !== world.seed) {
      this.picture?.texture.dispose()
      const texture = new THREE.CanvasTexture(drawIsland(world, PICTURE_PIXELS))
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = THREE.RepeatWrapping
      // The picture's longitude jumps at the seam, which would pick the smallest mip there.
      texture.generateMipmaps = false
      texture.minFilter = THREE.LinearFilter
      this.picture = { seed: world.seed, texture }
      this.globe.material.uniforms['picture']!.value = texture
    }
    this.drawn = scene
    this.paint()
  }

  private paint(): void {
    if (this.picture === null) return
    const ratio = window.devicePixelRatio || 1
    if (this.renderer === null) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      this.renderer.setClearColor(0x000000, 0)
      this.element.prepend(this.renderer.domElement)
    }
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(this.pixels, this.pixels, false)
    this.renderer.render(this.scene, this.camera)
    this.paintOverlay(ratio)
  }

  /** Where a point of the planet is on the board, and whether it is on the side facing the viewer. */
  private onBoard(point: Vec3): { x: number; y: number; near: boolean } {
    const out = new THREE.Vector3(point.x, point.y, point.z).normalize().applyQuaternion(this.globe.quaternion)
    // A point of the sphere can be seen from the camera when it is nearer than the horizon.
    const near = out.dot(this.camera.position) > 1
    out.project(this.camera)
    return { x: ((out.x + 1) / 2) * this.pixels, y: ((1 - out.y) / 2) * this.pixels, near }
  }

  private paintOverlay(ratio: number): void {
    this.overlay.width = this.pixels * ratio
    this.overlay.height = this.pixels * ratio
    const context = this.overlay.getContext('2d')
    if (context === null) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const { course, here } = this.drawn
    context.strokeStyle = 'rgba(255, 255, 255, 0.75)'
    context.lineWidth = 2
    context.lineCap = 'round'
    context.beginPath()
    for (let k = 1; k < course.length; k++) {
      const arc = greatCircle(course[k - 1]!.at, course[k]!.at)
      arc.forEach((point, i) => {
        const spot = this.onBoard(point)
        const before = i > 0 && this.onBoard(arc[i - 1]!).near
        if (!spot.near) return
        if (before) context.lineTo(spot.x, spot.y)
        else context.moveTo(spot.x, spot.y)
      })
    }
    context.stroke()
    for (const mark of course) {
      const spot = this.onBoard(mark.at)
      if (!spot.near) continue
      context.fillStyle = mark.color
      context.strokeStyle = '#0b1620'
      context.lineWidth = 2
      context.beginPath()
      context.arc(spot.x, spot.y, 7, 0, Math.PI * 2)
      context.fill()
      context.stroke()
      context.fillStyle = '#0b1620'
      context.font = 'bold 9px sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(mark.label, spot.x, spot.y + 0.5)
    }
    if (here !== null) {
      const spot = this.onBoard(here)
      if (spot.near) {
        context.fillStyle = '#6fd3c7'
        context.strokeStyle = '#0b1620'
        context.lineWidth = 2
        context.beginPath()
        context.arc(spot.x, spot.y, 5, 0, Math.PI * 2)
        context.fill()
        context.stroke()
      }
    }
  }

  private drag(event: PointerEvent): void {
    const press = this.press
    if (press?.id !== event.pointerId) return
    const dx = event.clientX - press.x
    const dy = event.clientY - press.y
    if (!press.moved && Math.hypot(dx, dy) < CLICK_SLOP) return
    press.moved = true
    press.x = event.clientX
    press.y = event.clientY
    this.element.classList.add('turning')
    // Drawn nearer, a pixel covers less of the planet, so it turns less.
    const turn = TURN_PER_PIXEL * ((this.camera.position.z - 1) / (FARTHEST - 1))
    const bounds = this.element.getBoundingClientRect()
    const scale = this.pixels / (bounds.width || this.pixels)
    const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * scale * turn, dx * scale * turn, 0))
    this.globe.quaternion.premultiply(spin)
    this.paint()
  }

  /** Pick the spot of the planet under the pointer, if it is over the planet. */
  private pick(event: PointerEvent): void {
    const bounds = this.element.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((event.clientY - bounds.top) / bounds.height) * 2,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(pointer, this.camera)
    const hit = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3())
    if (hit === null) return
    const out = hit.applyQuaternion(this.globe.quaternion.clone().invert()).normalize()
    this.onPick({ x: out.x, y: out.y, z: out.z })
  }
}

/** Points along the shorter way round the planet from one spot to another, a degree or two apart. */
function greatCircle(from: Vec3, to: Vec3): Vec3[] {
  const a = new THREE.Vector3(from.x, from.y, from.z).normalize()
  const b = new THREE.Vector3(to.x, to.y, to.z).normalize()
  const angle = a.angleTo(b)
  const steps = Math.max(1, Math.ceil(angle / 0.03))
  const sin = Math.sin(angle)
  const points: Vec3[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    // Nearly the same spot: a straight line is as good as the arc.
    const [wa, wb] = sin < 1e-6 ? [1 - t, t] : [Math.sin((1 - t) * angle) / sin, Math.sin(t * angle) / sin]
    points.push({ x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb })
  }
  return points
}
