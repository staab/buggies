import { NAME_MOST, cleanName } from '@buggies/net'

import { button, element } from './dom.ts'

/** What the screen tells the app: what the player is to be known by. */
export type NameChosen = (name: string) => void

/**
 * The first page: what the player goes by. It is up when the page is opened
 * with no name kept from last time, and again from the start screen, for a
 * player who wants to be known by something else.
 */
export class NameScreen {
  private readonly panel: HTMLElement
  private readonly field: HTMLInputElement
  private readonly go: HTMLButtonElement

  constructor(root: HTMLElement, onName: NameChosen) {
    this.panel = element('div', 'panel')
    this.panel.hidden = true

    this.field = element('input')
    this.field.type = 'text'
    this.field.name = 'name'
    this.field.placeholder = 'Your name'
    this.field.maxLength = NAME_MOST
    this.field.autocomplete = 'off'
    this.field.setAttribute('aria-label', 'Your name')
    // The game is listening to the keys too: they are the player's, not the car's, here.
    this.field.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key !== 'Enter') return
      event.preventDefault()
      this.confirm(onName)
    })
    this.field.addEventListener('input', () => {
      const cleaned = cleanName(this.field.value)
      if (cleaned !== this.field.value) this.field.value = cleaned
      this.go.disabled = this.field.value === ''
    })

    this.go = button('Continue', 'go')
    this.go.disabled = true
    this.go.addEventListener('click', () => this.confirm(onName))

    const nav = element('div', 'nav')
    nav.append(this.go)
    this.panel.append(element('h1', '', 'Buggies'), element('p', 'blurb', 'The name everyone on the road knows you by.'), this.field, nav)
    root.append(this.panel)
  }

  /** Ask for a name, with the one last given in the field. */
  show(name: string): void {
    this.field.value = cleanName(name)
    this.go.disabled = this.field.value === ''
    this.panel.hidden = false
    this.field.focus()
    this.field.select()
  }

  hide(): void {
    this.panel.hidden = true
  }

  private confirm(onName: NameChosen): void {
    const name = cleanName(this.field.value)
    if (name === '') return
    onName(name)
  }
}
