import type { VehicleProfileId } from '@buggies/game'

/**
 * All the sound is made here, from oscillators and noise: there are no
 * recordings to load or to credit. An engine is a voice that is kept
 * running and steered by speed and throttle; everything else is a one-off.
 */

/** What an engine sounds like: its wave, how low it idles, how high it revs, and how it chugs. */
export interface EngineTimbre {
  wave: OscillatorType
  /** The fundamental at idle, in Hz, and how much revving adds to it. */
  idle: number
  span: number
  /** How bright it is: the low-pass filter's cutoff at full revs, in Hz. */
  cutoff: number
  volume: number
  /** How much a diesel's beat comes through at idle, 0 to 1, and how fast it beats. */
  chug: number
  chugRate: number
}

export const ENGINE_TIMBRES: Readonly<Record<VehicleProfileId, EngineTimbre>> = Object.freeze({
  sportsCar: { wave: 'sawtooth', idle: 55, span: 230, cutoff: 1100, volume: 0.34, chug: 0, chugRate: 0 },
  raceCar: { wave: 'sawtooth', idle: 95, span: 560, cutoff: 2600, volume: 0.3, chug: 0, chugRate: 0 },
  police: { wave: 'sawtooth', idle: 60, span: 250, cutoff: 1000, volume: 0.34, chug: 0, chugRate: 0 },
  firetruck: { wave: 'square', idle: 34, span: 90, cutoff: 480, volume: 0.4, chug: 0.5, chugRate: 22 },
  pickup: { wave: 'sawtooth', idle: 42, span: 150, cutoff: 700, volume: 0.38, chug: 0.25, chugRate: 18 },
  smallCar: { wave: 'square', idle: 72, span: 270, cutoff: 1300, volume: 0.26, chug: 0, chugRate: 0 },
  tank: { wave: 'square', idle: 26, span: 48, cutoff: 360, volume: 0.46, chug: 0.7, chugRate: 12 },
  ambulance: { wave: 'sawtooth', idle: 40, span: 130, cutoff: 650, volume: 0.36, chug: 0.3, chugRate: 20 },
  semi: { wave: 'square', idle: 30, span: 70, cutoff: 420, volume: 0.42, chug: 0.6, chugRate: 14 },
  goKart: { wave: 'square', idle: 120, span: 620, cutoff: 3200, volume: 0.28, chug: 0, chugRate: 0 },
})

/** How far away a sound can be heard from at all, in metres. */
export const EARSHOT = 140

/**
 * How hard an engine is working, 0 idling to 1 flat out: mostly how fast it
 * is going, but the throttle revs it from a standstill too.
 */
export function engineRev(speed: number, maxSpeed: number, throttle: number): number {
  const going = Math.min(Math.abs(speed) / Math.max(maxSpeed, 1), 1)
  const revving = Math.max(throttle, 0) * 0.35 * (1 - going)
  return Math.min(going + revving, 1)
}

/** The fundamental an engine runs at for a rev. */
export function engineFrequency(timbre: EngineTimbre, rev: number): number {
  return timbre.idle + timbre.span * rev
}

/** How loud something this far off is, 0 to 1. */
export function earshot(distance: number): number {
  const near = Math.max(1 - distance / EARSHOT, 0)
  return near * near
}

/** How smoothly an engine follows its rev, in seconds. */
const ENGINE_FOLLOW = 0.08

/** How loud engines are against everything else: they run all the time, so they sit well back. */
const ENGINE_LEVEL = 0.6

/** The tyres' grip curve, as far as the squeal needs it: where the grip stops rising, and how far past that it falls. */
export interface SkidTuning {
  lateralPlateauEndSlip: number
  lateralFalloffRange: number
}

/** How far into the grip's fall-off the squeal is at its loudest, as a fraction of the fall-off. */
const SKID_FULL_FALLOFF = 0.5

/**
 * How hard the tyres are sliding, 0 to 1: the worst of the wheels on the
 * ground, and only once it is past the end of its grip and letting go. A
 * tyre working hard in a bend is still gripping, and makes no noise.
 * Wheels in the air make none either, whatever they are doing.
 */
export function skidAmount(
  wheels: readonly { grounded: boolean; slipSpeedLateral: number }[],
  tuning: SkidTuning,
): number {
  let worst = 0
  for (const wheel of wheels) {
    if (wheel.grounded) worst = Math.max(worst, Math.abs(wheel.slipSpeedLateral))
  }
  const start = tuning.lateralPlateauEndSlip
  const full = start + tuning.lateralFalloffRange * SKID_FULL_FALLOFF
  return Math.min(Math.max((worst - start) / (full - start), 0), 1)
}

/** How quickly a squeal comes and goes, in seconds. */
const SKID_FOLLOW = 0.05

/** An engine kept running: told each frame how hard it works and how far off it is. */
export class EngineVoice {
  /** The wave, and the ratio to the engine's frequency each is kept at. */
  private readonly voices: { oscillator: OscillatorNode; ratio: number }[]
  private readonly filter: BiquadFilterNode
  private readonly gain: GainNode
  private readonly chug: GainNode
  private readonly beat: OscillatorNode | null
  private readonly beatDepth: GainNode | null
  private stopped = false

  constructor(
    private readonly context: AudioContext,
    private readonly timbre: EngineTimbre,
    output: AudioNode,
  ) {
    const now = context.currentTime
    this.filter = context.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = timbre.cutoff * 0.3
    this.filter.Q.value = 1.2
    this.chug = context.createGain()
    this.chug.gain.value = 1
    this.gain = context.createGain()
    this.gain.gain.value = 0
    this.filter.connect(this.chug).connect(this.gain).connect(output)
    // Two of the wave a fifth apart, one a hair off tune, so it is not a pure buzz.
    this.voices = [1, 1.5, 1.003].map((ratio, index) => {
      const oscillator = context.createOscillator()
      oscillator.type = timbre.wave
      oscillator.frequency.value = timbre.idle * ratio
      const level = context.createGain()
      level.gain.value = index === 0 ? 1 : 0.35
      oscillator.connect(level).connect(this.filter)
      oscillator.start(now)
      return { oscillator, ratio }
    })
    if (timbre.chug > 0) {
      this.beat = context.createOscillator()
      this.beat.type = 'sine'
      this.beat.frequency.value = timbre.chugRate
      this.beatDepth = context.createGain()
      this.beatDepth.gain.value = timbre.chug * 0.5
      this.beat.connect(this.beatDepth).connect(this.chug.gain)
      this.beat.start(now)
    } else {
      this.beat = null
      this.beatDepth = null
    }
  }

  /** How hard it works, 0 to 1, and how far off it is. */
  set(rev: number, distance = 0): void {
    if (this.stopped) return
    const { timbre, context } = this
    const now = context.currentTime
    const frequency = engineFrequency(timbre, rev)
    for (const { oscillator, ratio } of this.voices) {
      oscillator.frequency.setTargetAtTime(frequency * ratio, now, ENGINE_FOLLOW)
    }
    this.filter.frequency.setTargetAtTime(timbre.cutoff * (0.3 + 0.7 * rev), now, ENGINE_FOLLOW)
    const loudness = ENGINE_LEVEL * timbre.volume * (0.45 + 0.55 * rev) * earshot(distance)
    this.gain.gain.setTargetAtTime(loudness, now, ENGINE_FOLLOW)
    if (this.beat !== null && this.beatDepth !== null) {
      // The beat is a diesel's idle: it smooths out as the revs come up.
      this.beat.frequency.setTargetAtTime(timbre.chugRate * (0.6 + 1.4 * rev), now, ENGINE_FOLLOW)
      this.beatDepth.gain.setTargetAtTime(timbre.chug * 0.5 * (1 - rev), now, ENGINE_FOLLOW)
    }
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    const now = this.context.currentTime
    this.gain.gain.setTargetAtTime(0, now, 0.05)
    const stopAt = now + 0.3
    for (const { oscillator } of this.voices) oscillator.stop(stopAt)
    this.beat?.stop(stopAt)
    setTimeout(() => this.gain.disconnect(), 400)
  }
}

/**
 * Tyres sliding sideways: a low, breathy squeal that rises and hardens with
 * the slip. Kept well down the range, and broad, so it reads as rubber on
 * a road rather than a whistle.
 */
export class SkidVoice {
  private readonly hiss: AudioBufferSourceNode
  private readonly band: BiquadFilterNode
  private readonly tone: OscillatorNode
  private readonly gain: GainNode
  private stopped = false

  constructor(
    private readonly context: AudioContext,
    noise: AudioBuffer,
    output: AudioNode,
  ) {
    const now = context.currentTime
    this.gain = context.createGain()
    this.gain.gain.value = 0
    this.gain.connect(output)
    this.band = context.createBiquadFilter()
    this.band.type = 'bandpass'
    this.band.frequency.value = 800
    this.band.Q.value = 1.6
    this.hiss = context.createBufferSource()
    this.hiss.buffer = noise
    this.hiss.loop = true
    this.hiss.connect(this.band).connect(this.gain)
    this.hiss.start(now)
    this.tone = context.createOscillator()
    this.tone.type = 'sawtooth'
    this.tone.frequency.value = 380
    const mellow = context.createBiquadFilter()
    mellow.type = 'lowpass'
    mellow.frequency.value = 1400
    const toneLevel = context.createGain()
    toneLevel.gain.value = 0.1
    this.tone.connect(mellow).connect(toneLevel).connect(this.gain)
    this.tone.start(now)
  }

  /** How hard the tyres are sliding, 0 to 1, and how far off. */
  set(slip: number, distance = 0): void {
    if (this.stopped) return
    const now = this.context.currentTime
    this.gain.gain.setTargetAtTime(0.3 * slip * earshot(distance), now, SKID_FOLLOW)
    this.band.frequency.setTargetAtTime(800 + 450 * slip, now, SKID_FOLLOW)
    this.tone.frequency.setTargetAtTime(380 + 220 * slip, now, SKID_FOLLOW)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    const now = this.context.currentTime
    this.gain.gain.setTargetAtTime(0, now, 0.05)
    this.hiss.stop(now + 0.3)
    this.tone.stop(now + 0.3)
    setTimeout(() => this.gain.disconnect(), 400)
  }
}

/**
 * A rocket engine burning: a deep, roaring rush that swells up when it is
 * lit and dies away when it is not.
 */
export class ThrustVoice {
  private readonly rush: AudioBufferSourceNode
  private readonly rumble: OscillatorNode
  private readonly gain: GainNode
  private stopped = false

  constructor(
    private readonly context: AudioContext,
    noise: AudioBuffer,
    output: AudioNode,
  ) {
    const now = context.currentTime
    this.gain = context.createGain()
    this.gain.gain.value = 0
    this.gain.connect(output)
    const low = context.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 520
    this.rush = context.createBufferSource()
    this.rush.buffer = noise
    this.rush.loop = true
    this.rush.connect(low).connect(this.gain)
    this.rush.start(now)
    this.rumble = context.createOscillator()
    this.rumble.type = 'sawtooth'
    this.rumble.frequency.value = 48
    const rumbleLevel = context.createGain()
    rumbleLevel.gain.value = 0.25
    this.rumble.connect(rumbleLevel).connect(this.gain)
    this.rumble.start(now)
  }

  /** How hard it is burning, 0 to 1, and how far off. */
  set(burn: number, distance = 0): void {
    if (this.stopped) return
    this.gain.gain.setTargetAtTime(0.5 * burn * earshot(distance), this.context.currentTime, 0.08)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    const now = this.context.currentTime
    this.gain.gain.setTargetAtTime(0, now, 0.05)
    this.rush.stop(now + 0.3)
    this.rumble.stop(now + 0.3)
    setTimeout(() => this.gain.disconnect(), 400)
  }
}

/** A second of white noise, for bangs and thuds. */
function noiseBuffer(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

/** The three notes of a banana taken: a bright little rising chime. */
const CHIME = [1318.5, 1661.2, 1975.5]

/**
 * The sound of the game. It has to be unlocked by something the player does
 * before a browser will let it be heard, so the first key or click does that.
 */
export class Sound {
  private readonly context: AudioContext
  private readonly master: GainNode
  private readonly noise: AudioBuffer
  private mutedNow = false

  constructor(context: AudioContext = new AudioContext()) {
    this.context = context
    this.master = context.createGain()
    this.master.gain.value = 0.6
    this.master.connect(context.destination)
    this.noise = noiseBuffer(context)
  }

  /** Called from a click or a key: browsers hold sound back until then. */
  unlock(): void {
    if (this.context.state === 'suspended') void this.context.resume()
  }

  get muted(): boolean {
    return this.mutedNow
  }

  set muted(muted: boolean) {
    this.mutedNow = muted
    this.master.gain.setTargetAtTime(muted ? 0 : 0.6, this.context.currentTime, 0.03)
  }

  /** An engine of this vehicle's kind, running until stopped. */
  engine(profile: VehicleProfileId): EngineVoice {
    return new EngineVoice(this.context, ENGINE_TIMBRES[profile], this.master)
  }

  /** A set of tyres, silent until they slide. */
  skid(): SkidVoice {
    return new SkidVoice(this.context, this.noise, this.master)
  }

  /** A rocket engine, silent until lit. */
  thrust(): ThrustVoice {
    return new ThrustVoice(this.context, this.noise, this.master)
  }

  /** Something blowing up, this far off: a bang, a rumble, and a thump underneath. */
  boom(distance = 0): void {
    const loudness = earshot(distance)
    if (loudness <= 0) return
    const { context } = this
    const now = context.currentTime
    const bang = context.createBufferSource()
    bang.buffer = this.noise
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(2600, now)
    filter.frequency.exponentialRampToValueAtTime(90, now + 1.3)
    const gain = context.createGain()
    gain.gain.setValueAtTime(1.0 * loudness, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5)
    bang.connect(filter).connect(gain).connect(this.master)
    bang.start(now)
    bang.stop(now + 1.5)
    const thump = context.createOscillator()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(70, now)
    thump.frequency.exponentialRampToValueAtTime(28, now + 0.7)
    const thumpGain = context.createGain()
    thumpGain.gain.setValueAtTime(0.9 * loudness, now)
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8)
    thump.connect(thumpGain).connect(this.master)
    thump.start(now)
    thump.stop(now + 0.8)
  }

  /** A banana taken, this far off: a rising chime. */
  chime(distance = 0): void {
    const loudness = earshot(distance)
    if (loudness <= 0) return
    const { context } = this
    const now = context.currentTime
    CHIME.forEach((frequency, index) => {
      const at = now + index * 0.07
      const note = context.createOscillator()
      note.type = 'sine'
      note.frequency.value = frequency
      const overtone = context.createOscillator()
      overtone.type = 'triangle'
      overtone.frequency.value = frequency * 2
      const gain = context.createGain()
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.25 * loudness, at + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.28)
      const soft = context.createGain()
      soft.gain.value = 0.25
      note.connect(gain)
      overtone.connect(soft).connect(gain)
      gain.connect(this.master)
      note.start(at)
      overtone.start(at)
      note.stop(at + 0.3)
      overtone.stop(at + 0.3)
    })
  }

  /** One round out of the gun, this far off: a short crack with a little weight under it. */
  shot(distance = 0): void {
    const loudness = 0.45 * earshot(distance)
    if (loudness <= 0.01) return
    const { context } = this
    const now = context.currentTime
    const crack = context.createBufferSource()
    crack.buffer = this.noise
    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 1500
    filter.Q.value = 0.7
    const gain = context.createGain()
    gain.gain.setValueAtTime(loudness, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07)
    crack.connect(filter).connect(gain).connect(this.master)
    crack.start(now)
    crack.stop(now + 0.08)
    const thump = context.createOscillator()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(170, now)
    thump.frequency.exponentialRampToValueAtTime(60, now + 0.05)
    const thumpGain = context.createGain()
    thumpGain.gain.setValueAtTime(0.5 * loudness, now)
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06)
    thump.connect(thumpGain).connect(this.master)
    thump.start(now)
    thump.stop(now + 0.06)
  }

  /** A rocket going, this far off: a rush of air that rises and tails away. */
  whoosh(distance = 0): void {
    const loudness = 0.7 * earshot(distance)
    if (loudness <= 0.01) return
    const { context } = this
    const now = context.currentTime
    const rush = context.createBufferSource()
    rush.buffer = this.noise
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(300, now)
    filter.frequency.exponentialRampToValueAtTime(3200, now + 0.2)
    filter.frequency.exponentialRampToValueAtTime(350, now + 0.8)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(loudness, now + 0.06)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85)
    rush.connect(filter).connect(gain).connect(this.master)
    rush.start(now)
    rush.stop(now + 0.9)
  }

  /** A knock, this hard (0 to 1) and this far off: a thud with a little crunch on it. */
  thud(strength: number, distance = 0): void {
    const loudness = Math.min(Math.max(strength, 0), 1) * earshot(distance)
    if (loudness <= 0.01) return
    const { context } = this
    const now = context.currentTime
    const crunch = context.createBufferSource()
    crunch.buffer = this.noise
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(600 + 1400 * loudness, now)
    filter.frequency.exponentialRampToValueAtTime(120, now + 0.18)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.7 * loudness, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
    crunch.connect(filter).connect(gain).connect(this.master)
    crunch.start(now)
    crunch.stop(now + 0.25)
    const thump = context.createOscillator()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(90, now)
    thump.frequency.exponentialRampToValueAtTime(40, now + 0.2)
    const thumpGain = context.createGain()
    thumpGain.gain.setValueAtTime(0.6 * loudness, now)
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
    thump.connect(thumpGain).connect(this.master)
    thump.start(now)
    thump.stop(now + 0.25)
  }
}
