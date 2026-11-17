import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  it("keeps each key's achievements and bananas across a restart", () => {
    dir = mkdtempSync(join(tmpdir(), 'buggies-players-'))
    const path = join(dir, 'kept', 'players.json')
    const before = new PlayerFile(path)
    expect(before.bananas(KEY)).toBe(0)
    before.record(KEY, 7)
    before.record(KEY, 2)
    before.keepBananas(KEY, 37)
    before.flush()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ [KEY]: { achievements: [2, 7], bananas: 37 } })

    const after = new PlayerFile(path)
    expect([...after.earned(KEY)].sort()).toEqual([2, 7])
    expect(after.bananas(KEY)).toBe(37)
    expect(after.earned('cd'.repeat(32)).size).toBe(0)
  })

  it('reads a file kept from before bananas were, as none kept', () => {
    dir = mkdtempSync(join(tmpdir(), 'buggies-players-'))
    const path = join(dir, 'players.json')
    writeFileSync(path, JSON.stringify({ [KEY]: { achievements: [1], bananas: 2 } }))
    const kept = new PlayerFile(path)
    expect([...kept.earned(KEY)]).toEqual([1])
    expect(kept.bananas(KEY)).toBe(2)
  })

  it('reads a file kept from before gems went, and keeps it no gems', () => {
    dir = mkdtempSync(join(tmpdir(), 'buggies-players-'))
    const path = join(dir, 'players.json')
    writeFileSync(path, JSON.stringify({ [KEY]: { achievements: [3], gems: 9, bananas: 4 } }))
    const kept = new PlayerFile(path)
    expect([...kept.earned(KEY)]).toEqual([3])
    expect(kept.bananas(KEY)).toBe(4)
    kept.record(KEY, 5)
    kept.flush()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ [KEY]: { achievements: [3, 5], bananas: 4 } })
  })
})
