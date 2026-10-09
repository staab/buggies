/**
 * What the big words across the middle of the screen say: a game starting,
 * counting down to its start, or over. A new `key` starts it over, its
 * animation and all.
 */
export interface BannerState {
  key: string
  title: string
  subtitle: string
  /** A line of detail under the subtitle, if any. */
  detail?: string
  /** What the countdown is at: `3`, `2`, `1` or `Go!`; nothing once it is gone. */
  countdown?: string
  /** A game starting, won by this player, lost by it, or over without it in it. */
  mood: 'start' | 'won' | 'lost' | 'over'
}

/** How many scraps of confetti a game won throws. */
const CONFETTI = 140
const CONFETTI_COLORS = ['#f6d23c', '#e04a3a', '#3fa7f0', '#5bd16a', '#c45bf0', '#ff8a3d', '#ffffff']
/** How many drops of rain fall over a game lost. */
const RAIN = 40

function div(className: string): HTMLDivElement {
  const element = document.createElement('div')
  element.className = className
  return element
}

/**
 * The big words across the middle of the screen, with confetti thrown over
 * a game won and a rain cloud over the drooping words of one lost. Nothing
 * on it is clicked: the keys go on driving the game underneath.
 */
export class Banner {
  private readonly title = div('banner-title')
  private readonly subtitle = div('banner-subtitle')
  private readonly detail = div('banner-detail')
  private readonly countdown = div('banner-countdown')
  private readonly weather = div('banner-weather')
  private shownKey = ''
  private shownCountdown = ''

  constructor(private readonly root: HTMLElement) {
    root.replaceChildren(this.weather, this.title, this.subtitle, this.detail, this.countdown)
    root.hidden = true
  }

  /** Show this, or nothing. */
  render(state: BannerState | undefined): void {
    this.root.hidden = state === undefined
    if (state === undefined) {
      this.shownKey = ''
      return
    }
    if (state.key !== this.shownKey) this.begin(state)
    const countdown = state.countdown ?? ''
    if (countdown !== this.shownCountdown) {
      this.shownCountdown = countdown
      this.countdown.textContent = countdown
      this.countdown.hidden = countdown === ''
      // Each number pops in afresh.
      this.countdown.classList.remove('pop')
      void this.countdown.offsetWidth
      this.countdown.classList.add('pop')
    }
  }

  private begin(state: BannerState): void {
    this.shownKey = state.key
    this.shownCountdown = ''
    this.root.className = `banner ${state.mood}`
    // Lost, the title's letters droop one after another.
    this.title.replaceChildren()
    if (state.mood === 'lost') {
      ;[...state.title].forEach((letter, index) => {
        const span = document.createElement('span')
        span.textContent = letter
        span.style.animationDelay = `${0.4 + index * 0.06}s`
        span.style.setProperty('--tilt', `${(index % 2 === 0 ? 1 : -1) * (6 + ((index * 7) % 9))}deg`)
        this.title.append(span)
      })
    } else this.title.textContent = state.title
    this.subtitle.textContent = state.subtitle
    this.detail.textContent = state.detail ?? ''
    this.detail.hidden = state.detail === undefined
    this.countdown.hidden = true
    this.weather.replaceChildren()
    if (state.mood === 'won') this.throwConfetti()
    if (state.mood === 'lost') this.rain()
  }

  private throwConfetti(): void {
    for (let k = 0; k < CONFETTI; k++) {
      const scrap = div('confetti')
      scrap.style.left = `${Math.random() * 100}vw`
      scrap.style.background = CONFETTI_COLORS[k % CONFETTI_COLORS.length]!
      scrap.style.animationDelay = `${Math.random() * 1.2}s`
      scrap.style.animationDuration = `${2.4 + Math.random() * 2}s`
      scrap.style.setProperty('--drift', `${(Math.random() - 0.5) * 30}vw`)
      scrap.style.setProperty('--spin', `${(Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 720)}deg`)
      this.weather.append(scrap)
    }
  }

  private rain(): void {
    const cloud = div('cloud')
    for (let k = 0; k < RAIN; k++) {
      const drop = div('drop')
      drop.style.left = `${5 + Math.random() * 90}%`
      drop.style.animationDelay = `${0.6 + Math.random() * 1.5}s`
      drop.style.animationDuration = `${0.6 + Math.random() * 0.4}s`
      cloud.append(drop)
    }
    this.weather.append(cloud)
  }
}
