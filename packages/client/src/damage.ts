import { DAMAGE_SMOKING } from '@buggies/game'

/** How hard a car with this much damage smokes: nothing until it is half done, then more and more. */
export function smokeAmount(damage: number): number {
  return Math.min(Math.max((damage - DAMAGE_SMOKING) / (1 - DAMAGE_SMOKING), 0), 1)
}
