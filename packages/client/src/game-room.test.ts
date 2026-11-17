import { SLOTS_MOST, type GameOptions, type GameSlotView, type GameView } from '@buggies/net'
import { describe, expect, it } from 'vitest'

import { mayAddSlot, mayChooseCar, mayEdit, mayRemoveSlot, mayStart, ownMember, roomStatus, slotName } from './game-room.ts'

function slot(patch: Partial<GameSlotView> = {}): GameSlotView {
  return { slot: 0, bot: false, member: 1, name: 'Ada', vehicle: 'sportsCar', ready: false, driving: false, ...patch }
}

function bot(index: number, name: string, vehicle: GameSlotView['vehicle'] = 'raceCar', patch: Partial<GameSlotView> = {}): GameSlotView {
  return slot({ slot: index, bot: true, member: 0, name, vehicle, ready: true, ...patch })
}

function game(patch: Partial<GameView> = {}, options: Partial<GameOptions> = {}): GameView {
  return {
    id: 2,
    status: 'open',
    host: 1,
    options: { mode: 'race', seed: 5, weapons: true, bananas: true, raceLength: 3, ...options },
    slots: [slot()],
    you: 1,
    drivePass: 40,
    fault: null,
    ...patch,
  }
}

describe('a game’s room', () => {
  it('lets the host set the world and the rules of a race only while it waits', () => {
    expect(mayEdit(game(), true)).toBe(true)
    expect(mayEdit(game(), false)).toBe(false)
    expect(mayEdit(game({ status: 'preparing' }), true)).toBe(false)
    expect(mayEdit(game({ status: 'racing' }), true)).toBe(false)
  })

  it('lets a free drive’s host set them only while nobody has driven in', () => {
    expect(mayEdit(game({}, { mode: 'free' }), true)).toBe(true)
    expect(mayEdit(game({ slots: [slot({ ready: true, driving: true })] }, { mode: 'free' }), true)).toBe(false)
  })

  it('starts a race only by its host, once every player in it is ready', () => {
    expect(mayStart(game({ slots: [slot({ ready: true })] }), true)).toBe(true)
    expect(mayStart(game({ slots: [slot({ ready: true })] }), false)).toBe(false)
    expect(mayStart(game(), true)).toBe(false)
    // A bot is always ready, and never holds the start up.
    expect(mayStart(game({ slots: [slot(), bot(1, 'Axle')] }), true)).toBe(false)
    expect(mayStart(game({ slots: [slot({ ready: true }), bot(1, 'Axle')] }), true)).toBe(true)
    // One of two players not ready holds the race.
    expect(mayStart(game({ slots: [slot({ ready: true }), slot({ slot: 1, member: 2, name: 'Bo' })] }), true)).toBe(false)
    expect(mayStart(game({ slots: [slot({ ready: true }), slot({ slot: 1, member: 2, name: 'Bo', ready: true })] }), true)).toBe(true)
    // Nobody to race with, and nothing to start once it has.
    expect(mayStart(game({ slots: [] }), true)).toBe(false)
    expect(mayStart(game({ status: 'preparing', slots: [slot({ ready: true })] }), true)).toBe(false)
    // There is no Start in a free drive: a player driving is what enters the world.
    expect(mayStart(game({ slots: [slot({ ready: true })] }, { mode: 'free' }), true)).toBe(false)
  })

  it('adds bots’ slots up to the most a game has, and takes them away again', () => {
    const four = game({ slots: [slot(), bot(1, 'Axle'), bot(2, 'Bolt'), bot(3, 'Cinder')] })
    expect(mayAddSlot(four, true)).toBe(true)
    expect(mayAddSlot(four, false)).toBe(false)
    const full = game({ slots: [slot(), ...Array.from({ length: SLOTS_MOST - 1 }, (_, at) => bot(at + 1, `Bot ${at}`))] })
    expect(full.slots).toHaveLength(SLOTS_MOST)
    expect(mayAddSlot(full, true)).toBe(false)
    // Only while the game may still be set up: a race started has its seats.
    expect(mayAddSlot(game({ status: 'starting', slots: four.slots }), true)).toBe(false)

    expect(mayRemoveSlot(four, true, 1)).toBe(true)
    expect(mayRemoveSlot(four, false, 1)).toBe(false)
    // A player's slot is nobody's to take: they leave it themselves.
    expect(mayRemoveSlot(four, true, 0)).toBe(false)
    // At least one slot stays.
    expect(mayRemoveSlot(game({ slots: [bot(0, 'Axle')] }), true, 0)).toBe(false)
    expect(mayRemoveSlot(four, true, 9)).toBe(false)
  })

  it('lets a player choose their own car, and a bot’s for the host alone', () => {
    const view = game({ you: 1, slots: [slot(), slot({ slot: 1, member: 2, name: 'Bo' }), bot(2, 'Axle')] })
    expect(mayChooseCar(view, true, view.slots[0]!)).toBe(true)
    expect(mayChooseCar(view, false, view.slots[1]!)).toBe(false)
    expect(mayChooseCar(view, true, view.slots[2]!)).toBe(true)
    expect(mayChooseCar(view, false, view.slots[2]!)).toBe(false)
    // Only looking on, with no slot of one's own, there is no car to choose.
    expect(mayChooseCar(game({ you: 0 }), true, slot())).toBe(false)
  })

  it('finds this tab’s own slot, and nothing of a bot’s or when only looking on', () => {
    const view = game({ you: 2, slots: [slot(), bot(1, 'Axle'), slot({ slot: 2, member: 2, name: 'Bo', vehicle: 'tank' })] })
    expect(ownMember(view)?.name).toBe('Bo')
    expect(ownMember(view)?.vehicle).toBe('tank')
    expect(ownMember(game({ you: 9 }))).toBeNull()
    // A spectator has no slot at all, though bots sit in slots whose member is nothing.
    expect(ownMember(game({ you: 0, slots: [slot(), bot(1, 'Axle')] }))).toBeNull()
  })

  it('says who a slot is', () => {
    expect(slotName(slot(), 1)).toBe('👑 Ada')
    expect(slotName(slot({ member: 2, name: 'Bo' }), 1)).toBe('Bo')
    expect(slotName(bot(1, 'Axle'), 1)).toBe('🤖 Axle')
  })
})

describe('the room’s heading', () => {
  it('names the host and says what the game waits for', () => {
    const two = [slot(), slot({ slot: 1, member: 2, name: 'Bo', ready: true })]
    expect(roomStatus(game({ slots: two }))).toBe('hosted by Ada · 1 of 2 ready')
    expect(roomStatus(game({ slots: two.map((each) => ({ ...each, ready: true })) }))).toBe('hosted by Ada · everyone is ready')
    // A bot is ready from the moment it is seated.
    expect(roomStatus(game({ slots: [slot(), bot(1, 'Axle')] }))).toBe('hosted by Ada · 1 of 2 ready')
    expect(roomStatus(game({ slots: [slot({ ready: true }), bot(1, 'Axle')] }))).toBe('hosted by Ada · everyone is ready')
    expect(roomStatus(game({ status: 'preparing' }))).toBe('hosted by Ada · preparing the course…')
    expect(roomStatus(game({ status: 'starting' }))).toBe('hosted by Ada · lining up…')
  })

  it('says how much of a free drive is out in the world, and who nobody is without a host', () => {
    const free = (driving: boolean): GameView =>
      game({ slots: [slot({ ready: driving, driving }), slot({ slot: 1, member: 2, name: 'Bo' })], ...(driving ? {} : { host: 0 }) }, { mode: 'free' })
    expect(roomStatus(free(false))).toBe('hosted by nobody · nobody is driving yet')
    expect(roomStatus(free(true))).toBe('hosted by Ada · 1 of 2 driving')
  })
})
