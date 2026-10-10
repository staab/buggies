import { FIXED_TIMESTEP, type Vec3 } from '@buggies/physics'
import type { BuildingKind, World } from '@buggies/terrain'

import { CEILING } from './sky.ts'
import { WEAPONS, WEAPON_LABELS, type Weapon } from './weapons.ts'

/**
 * Feats a player is paid for once a session, from when it sits down: so
 * many bananas collected, cars wrecked, robots brought down, races won,
 * so long in the air, every weapon tried, every landmark driven up to, and
 * a few more. Each pays its bananas once and puts on a show of its own.
 */

/** What goes across the screen for a feat: confetti, bananas raining down, fireworks, balloons going up, a burst of stars, a rainbow, its icon bouncing across, or spinning up big. */
export type AchievementShow = 'confetti' | 'bananas' | 'fireworks' | 'balloons' | 'stars' | 'rainbow' | 'bounce' | 'spin'

export interface Achievement {
  readonly id: number
  readonly title: string
  /** What it took, in a line. */
  readonly description: string
  /** How many bananas it pays. */
  readonly reward: number
  /** An emoji for it. */
  readonly icon: string
  readonly show: AchievementShow
  /** Whether a seat has done it. */
  met(progress: AchievementProgress, seat: AchievementSeat): boolean
}

/** What of a seat the feats are told by, besides its progress. */
export interface AchievementSeat {
  readonly collected: number
  readonly kills: number
  readonly robotKills: number
  readonly score: number
}

/** The landmarks a feat is had by driving up to, each with its name and what kind of building it is. */
export const LANDMARKS: readonly { kind: BuildingKind; name: string; icon: string }[] = [
  { kind: 'observatory', name: 'the observatory', icon: '🔭' },
  { kind: 'lighthouse', name: 'the lighthouse', icon: '🗼' },
  { kind: 'pyramid', name: 'a pyramid', icon: '🔺' },
  { kind: 'clocktower', name: 'a clock tower', icon: '🕰️' },
  { kind: 'church', name: 'a church', icon: '⛪' },
  { kind: 'steeple', name: 'a steeple', icon: '🔔' },
  { kind: 'watertower', name: 'a water tower', icon: '💧' },
  { kind: 'turbine', name: 'a wind turbine', icon: '🌬️' },
  { kind: 'silo', name: 'a silo', icon: '🌾' },
  { kind: 'barn', name: 'a barn', icon: '🐄' },
  { kind: 'crane', name: 'a crane', icon: '🏗️' },
  { kind: 'fountain', name: 'a fountain', icon: '⛲' },
  { kind: 'statue', name: 'a statue', icon: '🗽' },
  { kind: 'stone', name: 'the standing stones', icon: '🪨' },
  { kind: 'station', name: 'a filling station', icon: '⛽' },
  { kind: 'pylon', name: 'a pylon', icon: '⚡' },
  { kind: 'shop', name: 'a shop', icon: '🛒' },
  { kind: 'boat', name: 'a moored boat', icon: '⛵' },
  { kind: 'flag', name: "the moon's flag", icon: '🚩' },
  { kind: 'lander', name: 'the moon lander', icon: '🌙' },
]

/** How near, past a landmark's own half-width, a car has to come to it to have been there. */
export const LANDMARK_REACH = 25

/** How long a car has to be off the ground before it counts as flying, in seconds. */
export const FLIGHT_AFTER = 0.3

/** How long after one feat is paid the next may be, in ticks: each gets its moment on the screen. */
export const ACHIEVEMENT_GAP_TICKS = Math.round(3 / FIXED_TIMESTEP)

/** How often a car is looked for near the landmarks, in ticks. */
const LANDMARK_EVERY_TICKS = 15

/** What a seat has done toward its feats since it sat down, and which it has been paid for. */
export interface AchievementProgress {
  /** Cars of any kind its weapons have wrecked, the cars nobody drives as well. */
  carsWrecked: number
  /** Games and races won, and races alone. */
  wins: number
  racesWon: number
  /** Ticks in the air all told, and the most in one go. */
  airTicks: number
  longestAirTicks: number
  /** The fastest it has gone, in m/s, and the most bananas it has held. */
  topSpeed: number
  mostHeld: number
  /** The weapons it has used, a bit each by key, and the landmarks it has been to, a bit each as `LANDMARKS` lists them. */
  weaponsTried: number
  landmarks: number
  /** Trips through a portal. */
  portals: number
  /** Driven into the water, and up to the ceiling over the clouds. */
  splashed: boolean
  ceiling: boolean
  /** Paid for, by feat. */
  earned: Uint8Array
  /** The tick before which no feat is paid. */
  readyTick: number
  /** How many games it had won when last looked at, counted around past 255, to count its wins on from. */
  gamesWonSeen: number
}

export function createAchievementProgress(): AchievementProgress {
  return {
    carsWrecked: 0,
    wins: 0,
    racesWon: 0,
    airTicks: 0,
    longestAirTicks: 0,
    topSpeed: 0,
    mostHeld: 0,
    weaponsTried: 0,
    landmarks: 0,
    portals: 0,
    splashed: false,
    ceiling: false,
    earned: new Uint8Array(ACHIEVEMENTS.length),
    readyTick: 0,
    gamesWonSeen: 0,
  }
}

/** Start again from nothing, as a seat sat down in does. */
export function clearAchievementProgress(progress: AchievementProgress): void {
  Object.assign(progress, createAchievementProgress())
}

/** A copy of a seat's progress, to take through a portal. */
export function copyAchievementProgress(progress: AchievementProgress): AchievementProgress {
  return { ...progress, earned: progress.earned.slice() }
}

const seconds = (ticks: number): number => ticks * FIXED_TIMESTEP
const bits = (mask: number): number => {
  let count = 0
  for (let rest = mask; rest !== 0; rest &= rest - 1) count++
  return count
}
const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

type Definition = Omit<Achievement, 'id'>

/** A rising run of feats for one count: a title, an icon, a show and a reward at each step of it. */
function tiers(
  steps: readonly (readonly [count: number, title: string, reward: number, icon: string, show: AchievementShow])[],
  describe: (count: number) => string,
  count: (progress: AchievementProgress, seat: AchievementSeat) => number,
): Definition[] {
  return steps.map(([at, title, reward, icon, show]) => ({ title, description: describe(at), reward, icon, show, met: (progress, seat) => count(progress, seat) >= at }))
}

const WEAPON_ICONS: Readonly<Record<Weapon, string>> = {
  none: '',
  rocket: '🚀',
  machineGun: '🔫',
  mines: '💣',
  engine: '🔥',
  wings: '🪽',
  magnet: '🧲',
  plow: '🚜',
  laser: '🔦',
  shockwave: '💥',
}

const WEAPON_TITLES: Readonly<Record<Weapon, string>> = {
  none: '',
  rocket: 'Rocket Man',
  machineGun: 'Rat-a-tat-tat',
  mines: 'Minesweeper, Reversed',
  engine: 'Afterburner',
  wings: 'Wing It',
  magnet: 'Attractive Personality',
  plow: 'Snow Day',
  laser: 'Pew Pew',
  shockwave: 'Good Vibrations',
}

const LANDMARK_SHOWS: readonly AchievementShow[] = ['stars', 'rainbow', 'balloons', 'bounce', 'spin', 'fireworks']

const DEFINITIONS: readonly Definition[] = [
  ...tiers(
    [
      [1, 'First Banana', 2, '🍌', 'bounce'],
      [10, 'Bunch', 5, '🍌', 'bananas'],
      [25, 'Hand of Bananas', 8, '🍌', 'bananas'],
      [50, 'Banana Split', 10, '🍨', 'bananas'],
      [100, 'Top Banana', 20, '👑', 'bananas'],
      [150, 'Going Bananas', 25, '🙈', 'bananas'],
      [250, 'Plantation Owner', 35, '🌴', 'bananas'],
      [400, 'Banana Republic', 50, '🏛️', 'bananas'],
      [600, 'Potassium Overload', 60, '⚗️', 'bananas'],
      [800, 'Monkey Business', 75, '🐒', 'bananas'],
      [1000, 'Banana Millennium', 100, '🎉', 'fireworks'],
      [1500, 'King Kong', 150, '🦍', 'fireworks'],
    ],
    (count) => `Collect ${plural(count, 'banana', 'bananas')}.`,
    (_, seat) => seat.collected,
  ),
  ...tiers(
    [
      [50, 'Nest Egg', 10, '🥚', 'bounce'],
      [100, 'Hoarder', 15, '🐿️', 'bananas'],
      [250, 'Banana Bank', 30, '🏦', 'bananas'],
      [500, 'Banana Baron', 50, '🎩', 'fireworks'],
    ],
    (count) => `Hold ${plural(count, 'banana', 'bananas')} at once.`,
    (progress) => progress.mostHeld,
  ),
  ...tiers(
    [
      [1, 'Fender Bender', 5, '🚗', 'spin'],
      [2, 'Double Trouble', 8, '✌️', 'stars'],
      [3, 'Hat Trick', 10, '🎩', 'stars'],
      [5, 'Demolition Derby', 15, '💥', 'fireworks'],
      [10, 'Scrapyard', 25, '🔧', 'confetti'],
      [25, 'Junkyard Dog', 40, '🐕', 'confetti'],
      [40, 'Insurance Nightmare', 50, '📋', 'fireworks'],
      [60, 'Car Crusher', 70, '🗜️', 'fireworks'],
      [100, 'Road Rage Legend', 100, '😤', 'fireworks'],
    ],
    (count) => `Wreck ${plural(count, 'car', 'cars')} with your weapons.`,
    (progress) => progress.carsWrecked,
  ),
  ...tiers(
    [
      [1, 'Rebel Without a Cause', 10, '🎸', 'stars'],
      [3, 'Bully', 20, '😈', 'confetti'],
      [5, 'Menace', 30, '👹', 'fireworks'],
      [10, 'Public Enemy', 50, '🚨', 'fireworks'],
    ],
    (count) => `Wreck ${plural(count, "other player's car", "other players' cars")}.`,
    (_, seat) => seat.kills,
  ),
  ...tiers(
    [
      [1, 'Robot Rumble', 10, '🤖', 'spin'],
      [2, 'Rust in Peace', 12, '🔩', 'stars'],
      [3, 'Bolt Cutter', 15, '⚙️', 'bounce'],
      [5, 'Terminator', 25, '🕶️', 'fireworks'],
      [12, 'Scrap Metal', 40, '🗑️', 'confetti'],
      [20, 'Uprising Quelled', 60, '🛡️', 'fireworks'],
      [30, 'Robot Overlord', 80, '👾', 'fireworks'],
      [50, 'Singularity Averted', 120, '🧠', 'fireworks'],
    ],
    (count) => `Bring down ${plural(count, 'robot', 'robots')}.`,
    (_, seat) => seat.robotKills,
  ),
  ...tiers(
    [
      [1, 'Checkered Flag', 20, '🏁', 'confetti'],
      [2, 'Back to Back', 25, '🏎️', 'confetti'],
      [3, 'Podium Regular', 30, '🥇', 'fireworks'],
      [5, 'Speed Demon', 40, '😈', 'fireworks'],
      [7, 'Lucky Seven', 50, '🎰', 'stars'],
      [10, 'Champion', 75, '🏆', 'fireworks'],
      [15, 'Dynasty', 100, '👑', 'fireworks'],
      [25, 'Hall of Fame', 150, '🌟', 'fireworks'],
    ],
    (count) => `Win ${plural(count, 'race', 'races')}.`,
    (progress) => progress.racesWon,
  ),
  ...tiers(
    [
      [1, 'Game On', 10, '🎮', 'confetti'],
      [3, 'Gamer', 20, '🕹️', 'stars'],
      [5, 'Overachiever', 30, '📈', 'fireworks'],
    ],
    (count) => `Win ${plural(count, 'game', 'games')} of score, kills or robots.`,
    (progress) => progress.wins - progress.racesWon,
  ),
  ...tiers(
    [
      [3, 'Hang Time', 5, '🪂', 'balloons'],
      [10, 'Frequent Flyer', 10, '✈️', 'balloons'],
      [30, 'Up, Up and Away', 15, '🎈', 'balloons'],
      [60, 'Mile High', 25, '☁️', 'rainbow'],
      [120, 'Cloud Surfer', 35, '🏄', 'rainbow'],
      [240, 'Air Ace', 50, '🛩️', 'fireworks'],
      [900, 'Never Touched Down', 100, '🦅', 'fireworks'],
    ],
    (count) => `Spend ${count} seconds in the air, all told.`,
    (progress) => seconds(progress.airTicks),
  ),
  ...tiers(
    [
      [2, 'Big Air', 5, '🦘', 'bounce'],
      [4, 'Lift Off', 10, '🛫', 'balloons'],
      [8, 'Soaring', 20, '🦅', 'rainbow'],
      [15, 'Gliding Along', 30, '🪁', 'rainbow'],
      [30, 'Long Haul Flight', 60, '🌍', 'fireworks'],
    ],
    (count) => `Stay in the air for ${count} seconds in one go.`,
    (progress) => seconds(progress.longestAirTicks),
  ),
  ...WEAPONS.map(
    (weapon, index): Definition => ({
      title: WEAPON_TITLES[weapon],
      description: `Use the ${WEAPON_LABELS[weapon].toLowerCase()}.`,
      reward: 5,
      icon: WEAPON_ICONS[weapon],
      show: index % 2 === 0 ? 'spin' : 'stars',
      met: (progress) => (progress.weaponsTried & (1 << index)) !== 0,
    }),
  ),
  {
    title: 'Armed to the Teeth',
    description: 'Use every one of the nine weapons.',
    reward: 50,
    icon: '🦷',
    show: 'fireworks',
    met: (progress) => bits(progress.weaponsTried) >= WEAPONS.length,
  },
  ...LANDMARKS.map(
    ({ name, icon }, index): Definition => ({
      title: `Sightseer: ${name.replace(/^(the|a) /, '').replace(/^\w/, (letter) => letter.toUpperCase())}`,
      description: `Drive up to ${name}.`,
      reward: 10,
      icon,
      show: LANDMARK_SHOWS[index % LANDMARK_SHOWS.length]!,
      met: (progress) => (progress.landmarks & (1 << index)) !== 0,
    }),
  ),
  ...tiers(
    [
      [5, 'Tourist', 20, '📸', 'confetti'],
      [10, 'Explorer', 40, '🧭', 'rainbow'],
      [15, 'Globetrotter', 75, '🗺️', 'fireworks'],
    ],
    (count) => `Drive up to ${count} different kinds of landmark.`,
    (progress) => bits(progress.landmarks),
  ),
  ...tiers(
    [
      [30, 'Speeding Ticket', 5, '🚓', 'stars'],
      [45, 'Ludicrous Speed', 15, '💨', 'rainbow'],
      [60, 'Sound of Speed', 30, '🔊', 'fireworks'],
    ],
    (count) => `Go faster than ${Math.round(count * 3.6)} km/h.`,
    (progress) => progress.topSpeed,
  ),
  ...tiers(
    [
      [1, 'Portal Hopper', 10, '🌀', 'spin'],
      [5, 'Interplanetary Commuter', 30, '🪐', 'rainbow'],
    ],
    (count) => `Go through ${plural(count, 'portal', 'portals')}.`,
    (progress) => progress.portals,
  ),
  {
    title: 'Splashdown',
    description: 'Drive into the sea.',
    reward: 5,
    icon: '🌊',
    show: 'bounce',
    met: (progress) => progress.splashed,
  },
  {
    title: 'Sky Is the Limit',
    description: 'Climb all the way up over the clouds.',
    reward: 25,
    icon: '🌤️',
    show: 'rainbow',
    met: (progress) => progress.ceiling,
  },
]

/** Every feat there is, numbered as it is listed. */
export const ACHIEVEMENTS: readonly Achievement[] = DEFINITIONS.map((definition, id) => ({ id, ...definition }))

/** A seat as the feats are kept for: its own counts, its progress, and its car. */
export interface AchievingSeat extends AchievementSeat {
  readonly occupied: boolean
  readonly npc: boolean
  readonly gamesWon: number
  readonly submersion: number
  /** How many feats it has been paid for, and the last. */
  achievements: number
  lastAchievement: number
  score: number
  readonly progress: AchievementProgress
  readonly vehicle: {
    readonly wrecked: boolean
    readonly speed: number
    readonly airborneTime: number
    readonly frame: { readonly position: Vec3 }
  }
}

/** The landmarks of a world, by where they stand and how near is near them, with their place in `LANDMARKS`. */
const landmarksOf = new WeakMap<World, { at: Vec3; reach: number; index: number }[]>()

function landmarks(planet: World): { at: Vec3; reach: number; index: number }[] {
  let found = landmarksOf.get(planet)
  if (found === undefined) {
    found = []
    for (const building of planet.buildings) {
      const index = LANDMARKS.findIndex((landmark) => landmark.kind === building.kind)
      if (index >= 0) found.push({ at: building.at, reach: Math.max(building.width, building.depth) / 2 + LANDMARK_REACH, index })
    }
    landmarksOf.set(planet, found)
  }
  return found
}

/**
 * A step of every driven seat's feats: what it has done this tick counted,
 * and the first feat it has done and not been paid for paid, its bananas
 * added, unless it was paid for one too lately. Done by whoever has the
 * last word on the arena, so a feat is paid once; the feats paid, and to
 * whom, are returned.
 */
export function awardAchievements<S extends AchievingSeat>(arena: { readonly planet: World; readonly seats: readonly S[]; readonly tick: number }): { seat: S; achievement: Achievement }[] {
  const paid: { seat: S; achievement: Achievement }[] = []
  for (const seat of arena.seats) {
    if (!seat.occupied || seat.npc) continue
    track(arena.planet, seat, arena.tick)
    if (arena.tick < seat.progress.readyTick) continue
    const achievement = ACHIEVEMENTS.find((feat) => seat.progress.earned[feat.id] === 0 && feat.met(seat.progress, seat))
    if (achievement === undefined) continue
    seat.progress.earned[achievement.id] = 1
    seat.progress.readyTick = arena.tick + ACHIEVEMENT_GAP_TICKS
    seat.score += achievement.reward
    seat.achievements = (seat.achievements + 1) & 0xff
    seat.lastAchievement = achievement.id
    paid.push({ seat, achievement })
  }
  return paid
}

/** Count what a seat has done this tick toward its feats. */
function track(planet: World, seat: AchievingSeat, tick: number): void {
  const { progress, vehicle } = seat
  progress.wins += (seat.gamesWon - progress.gamesWonSeen) & 0xff
  progress.gamesWonSeen = seat.gamesWon
  progress.mostHeld = Math.max(progress.mostHeld, seat.score)
  if (vehicle.wrecked) return
  progress.topSpeed = Math.max(progress.topSpeed, Math.abs(vehicle.speed))
  if (seat.submersion > 0.5) progress.splashed = true
  // In the air: off the ground a moment, and not afloat.
  if (vehicle.airborneTime > FLIGHT_AFTER && seat.submersion === 0) {
    progress.airTicks += 1
    progress.longestAirTicks = Math.max(progress.longestAirTicks, Math.round((vehicle.airborneTime - FLIGHT_AFTER) / FIXED_TIMESTEP))
  }
  const { x, y, z } = vehicle.frame.position
  if (Math.sqrt(x * x + y * y + z * z) > planet.radius + CEILING - 2) progress.ceiling = true
  if (tick % LANDMARK_EVERY_TICKS !== 0) return
  for (const landmark of landmarks(planet)) {
    if ((progress.landmarks & (1 << landmark.index)) !== 0) continue
    const dx = x - landmark.at.x
    const dy = y - landmark.at.y
    const dz = z - landmark.at.z
    if (dx * dx + dy * dy + dz * dz <= landmark.reach * landmark.reach) progress.landmarks |= 1 << landmark.index
  }
}
