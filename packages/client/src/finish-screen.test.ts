import { describe, expect, it } from 'vitest'

import { finishLine, finishTime, ordinal } from './finish-screen.ts'

describe('a finish’s place', () => {
  it('says a place the way a place is said', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(4)).toBe('4th')
    expect(ordinal(7)).toBe('7th')
    expect(ordinal(8)).toBe('8th')
    // The awkward teens, and the places that end like them.
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(12)).toBe('12th')
    expect(ordinal(13)).toBe('13th')
    expect(ordinal(21)).toBe('21st')
    expect(ordinal(22)).toBe('22nd')
    expect(ordinal(23)).toBe('23rd')
    expect(ordinal(111)).toBe('111th')
    expect(ordinal(112)).toBe('112th')
  })

  it('never says a place below the first', () => {
    expect(ordinal(0)).toBe('1st')
    expect(ordinal(-4)).toBe('1st')
  })
})

describe('the line under the place', () => {
  it('wins, stands on the podium, or simply finishes', () => {
    expect(finishLine(1)).toBe('You win!')
    expect(finishLine(2)).toBe('Podium!')
    expect(finishLine(3)).toBe('Podium!')
    expect(finishLine(4)).toBe('Finished!')
    expect(finishLine(8)).toBe('Finished!')
  })
})

describe('a finish’s time', () => {
  it('counts the ticks of the race up in minutes, seconds and tenths', () => {
    // The race's clock runs at 60 ticks a second.
    expect(finishTime(0)).toBe('0:00.0')
    expect(finishTime(60)).toBe('0:01.0')
    expect(finishTime(135)).toBe('0:02.3')
    expect(finishTime(60 * 150)).toBe('2:30.0')
    expect(finishTime(60 * 60 * 12)).toBe('12:00.0')
    // A clock that ran backwards still says no time at all.
    expect(finishTime(-90)).toBe('0:00.0')
  })
})
