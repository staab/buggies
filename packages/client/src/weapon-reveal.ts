import { WEAPONS, type Weapon } from '@buggies/game'

/** How long the roll runs, in seconds, and how long its first and last steps are. */
export const REVEAL_SECONDS = 2.4
const FIRST_STEP = 0.05
const LAST_STEP = 0.45

/**
 * What is shown of a car's weapon. Something won is not shown at once: the
 * names roll past, fast and then slower, and stop on it, like a fruit
 * machine. Nothing may be fired until they have. Something fired or spent
 * goes at once.
 */
export class WeaponReveal {
  /** The weapon, or during the roll whichever name is passing. */
  shown: Weapon = 'none'
  private known: Weapon = 'none'
  /** How far into the roll, or nothing when there is none. */
  private elapsed: number | null = null
  private untilStep = 0
  private step = 0

  get rolling(): boolean {
    return this.elapsed !== null
  }

  /** Whether what is carried may be fired: not before the roll has stopped on it. */
  get ready(): boolean {
    return this.elapsed === null && this.known !== 'none'
  }

  update(actual: Weapon, dt: number): void {
    if (actual !== this.known) {
      this.known = actual
      if (actual === 'none') {
        this.elapsed = null
        this.shown = 'none'
      } else {
        this.elapsed = 0
        this.untilStep = 0
      }
    }
    if (this.elapsed === null) return
    this.elapsed += dt
    if (this.elapsed >= REVEAL_SECONDS) {
      this.elapsed = null
      this.shown = this.known
      return
    }
    this.untilStep -= dt
    if (this.untilStep > 0) return
    this.step = (this.step + 1) % WEAPONS.length
    this.shown = WEAPONS[this.step] ?? this.known
    // Each step a little longer than the last, slowing to a stop.
    const along = this.elapsed / REVEAL_SECONDS
    this.untilStep = FIRST_STEP + (LAST_STEP - FIRST_STEP) * along * along
  }
}
