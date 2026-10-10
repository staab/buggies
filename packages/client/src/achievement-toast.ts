import { ACHIEVEMENTS, type Achievement, type Seat } from '@buggies/game'

/** How long a feat is told of, in seconds: up until the next may be paid. */
export const ACHIEVEMENT_SECONDS = 2.8

/** A feat being told of; a new `key` starts its show over. */
export interface AchievementState {
  key: string
  achievement: Achievement
}

/**
 * Which of a seat's feats to tell of: the last one paid, each time the
 * count of them goes up by one. The count first heard from the server is
 * taken as it is, so feats brought through a portal are not told of again.
 */
export class AchievementWatch {
  private seen: number | null = null
  private shown: AchievementState | null = null
  private shownFor = 0
  private told = 0

  constructor(private readonly sound: { chime(): void }) {}

  /** `heard` once the server has said where the seat stands. */
  update(dt: number, own: Pick<Seat, 'achievements' | 'lastAchievement'>, heard: boolean): void {
    this.shownFor = Math.max(this.shownFor - dt, 0)
    if (this.shownFor === 0) this.shown = null
    if (!heard) return
    const before = this.seen
    this.seen = own.achievements
    if (before === null || own.achievements !== ((before + 1) & 0xff)) return
    const achievement = ACHIEVEMENTS[own.lastAchievement]
    if (achievement === undefined) return
    this.told += 1
    this.shown = { key: `achievement:${this.told}`, achievement }
    this.shownFor = ACHIEVEMENT_SECONDS
    this.sound.chime()
  }

  /** The feat being told of now, if any. */
  state(): AchievementState | undefined {
    return this.shown ?? undefined
  }
}

const CONFETTI_COLORS = ['#f6d23c', '#e04a3a', '#3fa7f0', '#5bd16a', '#c45bf0', '#ff8a3d', '#ffffff']
const SPARK_COLORS = ['#ffd24a', '#ff6b5a', '#6fd3c7', '#9d7bff', '#ffffff']

function div(className: string, text = ''): HTMLDivElement {
  const element = document.createElement('div')
  element.className = className
  element.textContent = text
  return element
}

const random = (low: number, high: number): number => low + Math.random() * (high - low)

/**
 * A feat told of: a card dropped in at the top of the screen with its icon,
 * its title, what it took and the bananas it paid, over a show of its own
 * across the whole screen. Nothing on it is clicked.
 */
export class AchievementToast {
  private readonly show = div('achievement-show')
  private readonly card = div('achievement-card')
  private readonly icon = div('achievement-icon')
  private readonly title = div('achievement-title')
  private readonly description = div('achievement-description')
  private readonly reward = div('achievement-reward')
  private shownKey = ''

  constructor(private readonly root: HTMLElement) {
    const words = div('achievement-words')
    words.append(div('achievement-kicker', 'Achievement unlocked'), this.title, this.description)
    this.card.append(this.icon, words, this.reward)
    root.replaceChildren(this.show, this.card)
    root.hidden = true
  }

  /** Show this, or nothing. */
  render(state: AchievementState | undefined): void {
    this.root.hidden = state === undefined
    if (state === undefined) {
      this.shownKey = ''
      return
    }
    if (state.key === this.shownKey) return
    this.shownKey = state.key
    const { achievement } = state
    this.icon.textContent = achievement.icon
    this.title.textContent = achievement.title
    this.description.textContent = achievement.description
    this.reward.textContent = `+${achievement.reward} 🍌`
    // The card drops in afresh.
    this.card.classList.remove('in')
    void this.card.offsetWidth
    this.card.classList.add('in')
    this.show.replaceChildren(...this.pieces(achievement))
  }

  /** What goes across the screen for a feat. */
  private pieces(achievement: Achievement): HTMLElement[] {
    const pieces: HTMLElement[] = []
    const many = (count: number, make: (index: number) => HTMLElement): void => {
      for (let k = 0; k < count; k++) pieces.push(make(k))
    }
    switch (achievement.show) {
      case 'confetti':
        many(120, (k) => {
          const scrap = div('confetti')
          scrap.style.left = `${random(0, 100)}vw`
          scrap.style.background = CONFETTI_COLORS[k % CONFETTI_COLORS.length]!
          this.fall(scrap)
          return scrap
        })
        break
      case 'bananas':
        many(40, () => {
          const banana = div('achievement-faller', '🍌')
          banana.style.left = `${random(0, 96)}vw`
          banana.style.fontSize = `${random(22, 48)}px`
          this.fall(banana)
          return banana
        })
        break
      case 'fireworks':
        many(5, (burst) => {
          const at = div('achievement-burst')
          at.style.left = `${random(15, 85)}vw`
          at.style.top = `${random(20, 60)}vh`
          at.style.animationDelay = `${burst * 0.35}s`
          const color = SPARK_COLORS[burst % SPARK_COLORS.length]!
          for (let k = 0; k < 18; k++) {
            const spark = div('achievement-spark')
            const angle = (k / 18) * 2 * Math.PI
            const far = random(70, 130)
            spark.style.background = color
            spark.style.boxShadow = `0 0 8px ${color}`
            spark.style.setProperty('--dx', `${Math.cos(angle) * far}px`)
            spark.style.setProperty('--dy', `${Math.sin(angle) * far}px`)
            spark.style.animationDelay = `${burst * 0.35}s`
            at.append(spark)
          }
          return at
        })
        break
      case 'balloons':
        many(14, () => {
          const balloon = div('achievement-riser', '🎈')
          balloon.style.left = `${random(2, 94)}vw`
          balloon.style.fontSize = `${random(34, 60)}px`
          balloon.style.animationDelay = `${random(0, 0.9)}s`
          balloon.style.animationDuration = `${random(2.2, 3)}s`
          balloon.style.setProperty('--sway', `${random(-8, 8)}vw`)
          return balloon
        })
        break
      case 'stars':
        many(24, (k) => {
          const star = div('achievement-star', k % 3 === 0 ? '🌟' : '⭐')
          const angle = (k / 24) * 2 * Math.PI + random(-0.1, 0.1)
          const far = random(25, 48)
          star.style.setProperty('--dx', `${Math.cos(angle) * far}vw`)
          star.style.setProperty('--dy', `${Math.sin(angle) * far}vh`)
          star.style.fontSize = `${random(18, 38)}px`
          star.style.animationDelay = `${random(0, 0.25)}s`
          return star
        })
        break
      case 'rainbow':
        pieces.push(div('achievement-rainbow'))
        many(8, (k) => {
          const sparkle = div('achievement-star', '✨')
          sparkle.style.left = `${10 + k * 11}vw`
          sparkle.style.top = `${random(30, 55)}vh`
          sparkle.style.setProperty('--dx', '0px')
          sparkle.style.setProperty('--dy', '-6vh')
          sparkle.style.animationDelay = `${0.6 + k * 0.08}s`
          return sparkle
        })
        break
      case 'bounce':
        pieces.push(div('achievement-bouncer', achievement.icon))
        break
      case 'spin':
        pieces.push(div('achievement-spinner', achievement.icon))
        break
    }
    return pieces
  }

  /** Something let fall from over the top of the screen, drifting and turning as it goes. */
  private fall(piece: HTMLElement): void {
    piece.style.animationDelay = `${random(0, 0.8)}s`
    piece.style.animationDuration = `${random(1.6, 2.6)}s`
    piece.style.setProperty('--drift', `${random(-12, 12)}vw`)
    piece.style.setProperty('--spin', `${(Math.random() < 0.5 ? -1 : 1) * random(180, 720)}deg`)
  }
}
