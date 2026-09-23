/** What a read that should have found something throws when it finds nothing. */
export class MissingError extends Error {
  constructor(what: string, index: number) {
    super(`no ${what} at ${index}`)
    this.name = 'MissingError'
  }
}

/**
 * An indexed read that has to find something: where nothing is there the
 * generation has gone wrong, and it says so rather than handing back an
 * undefined to fail on somewhere else.
 */
export function at<T>(items: ArrayLike<T>, index: number, what: string): T {
  const item = items[index]
  if (item === undefined) throw new MissingError(what, index)
  return item
}
