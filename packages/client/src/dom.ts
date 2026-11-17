/** The page's own namespace, for what is drawn rather than written: a dial, an icon, the mini-map. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** A new element of the page, of this tag, with these classes and, if any, these words. */
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag)
  if (className !== '') made.className = className
  if (text !== '') made.textContent = text
  return made
}

/** A new button of the page, of this class, saying this. Nothing on it is ever sent anywhere. */
export function button(text: string, className = ''): HTMLButtonElement {
  const made = element('button', className, text)
  made.type = 'button'
  return made
}

/** A new piece of something drawn, with these attributes. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const made = document.createElementNS(SVG_NAMESPACE, tag)
  for (const [name, value] of Object.entries(attributes)) made.setAttribute(name, String(value))
  return made
}

/**
 * What is written on an element, written only when it says something else:
 * the screens are filled in every frame, and most of what they say has not
 * changed since the last one.
 */
export function writeText(target: Element, words: string): void {
  if (target.textContent !== words) target.textContent = words
}

/** Show or hide an element, which is only told when it is not already so. */
export function setHidden(target: HTMLElement, hidden: boolean): void {
  if (target.hidden !== hidden) target.hidden = hidden
}

/** An attribute, set only when it is not already what it should be. */
export function writeAttribute(target: Element, name: string, value: string): void {
  if (target.getAttribute(name) !== value) target.setAttribute(name, value)
}

/** One of an element's own styles, set only when it is not already what it should be. */
export function writeStyle(target: HTMLElement | SVGElement, property: string, value: string): void {
  if (target.style.getPropertyValue(property) !== value) target.style.setProperty(property, value)
}

/** A class put on an element or taken off, which is only told when it changes. */
export function setClass(target: Element, name: string, on: boolean): void {
  if (target.classList.contains(name) !== on) target.classList.toggle(name, on)
}
