/**
 * What a game is played by: whether weapons are had at all, and whether there
 * are bananas out to be taken, which are what a weapon costs. It is read by
 * whatever a race's cars do besides driving, which is why it is kept where both
 * the arena and the weapons can read it.
 */

/** What a game is played by: whether weapons are had at all, and whether there are bananas out to be taken. */
export interface ArenaRules {
  readonly weapons: boolean
  readonly bananas: boolean
}

/** A game with everything on: weapons, and the bananas that pay for them. */
export const OPEN_RULES: ArenaRules = { weapons: true, bananas: true }
