import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { PlayerFile } from './player-file.ts'

const KEY = 'ab'.repeat(32)
let dir: string | null = null

afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('the players file', () => {
  it("keeps each key's achievements and gems across a restart", () => {
    dir = mkdtempSync(join(tmpdir(), 'buggies-players-'))
    const path = join(dir, 'kept', 'players.json')
    const before = new PlayerFile(path)
    expect(before.gems(KEY)).toBe(0)
    before.record(KEY, 7)
    before.record(KEY, 2)
    expect(before.addGems(KEY, 3)).toBe(3)
    expect(before.addGems(KEY, 2)).toBe(5)
    before.flush()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ [KEY]: { achievements: [2, 7], gems: 5 } })

    const after = new PlayerFile(path)
    expect([...after.earned(KEY)].sort()).toEqual([2, 7])
    expect(after.gems(KEY)).toBe(5)
    expect(after.earned('cd'.repeat(32)).size).toBe(0)
  })
})
