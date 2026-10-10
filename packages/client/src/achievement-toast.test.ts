import { ACHIEVEMENTS } from '@buggies/game'
import { describe, expect, it } from 'vitest'

import { ACHIEVEMENT_SECONDS, AchievementWatch } from './achievement-toast.ts'

describe('the achievement watch', () => {
  it('tells of each feat as its count goes up, for a while, with a chime', () => {
    let chimes = 0
    const watch = new AchievementWatch({ chime: () => chimes++ })
    // Nothing heard from the server yet, then a count brought through a portal: taken as it is.
    watch.update(0.1, { achievements: 0, lastAchievement: 0 }, false)
    watch.update(0.1, { achievements: 4, lastAchievement: 7 }, true)
    expect(watch.state()).toBeUndefined()
    // One more paid: told of.
    watch.update(0.1, { achievements: 5, lastAchievement: 12 }, true)
    expect(watch.state()?.achievement).toBe(ACHIEVEMENTS[12])
    expect(chimes).toBe(1)
    watch.update(ACHIEVEMENT_SECONDS, { achievements: 5, lastAchievement: 12 }, true)
    expect(watch.state()).toBeUndefined()
    // Counted around past 255.
    const around = new AchievementWatch({ chime: () => chimes++ })
    around.update(0.1, { achievements: 255, lastAchievement: 3 }, true)
    around.update(0.1, { achievements: 0, lastAchievement: 9 }, true)
    expect(around.state()?.achievement).toBe(ACHIEVEMENTS[9])
  })
})
