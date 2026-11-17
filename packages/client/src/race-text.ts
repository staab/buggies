import { FIXED_TIMESTEP } from '@buggies/game'

/** A place in words: "1st", "2nd", "3rd", and "11th" through "13th" for the awkward ones. Never below the first. */
export function ordinal(place: number): string {
  const whole = Math.max(Math.round(place), 1)
  const last = whole % 10
  const tens = whole % 100
  const ending = tens >= 11 && tens <= 13 ? 'th' : last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'
  return `${whole}${ending}`
}

/** Where a car stands in a race, among how many are in it: "2nd of 5". */
export function placeLabel(place: number, of: number): string {
  return `${ordinal(place)} of ${of}`
}

/** A clock, in seconds, as minutes and seconds: "1:05", and hours before those where it runs that long. Whole seconds, as a clock that is running. */
export function clockLabel(seconds: number): string {
  const whole = Math.max(Math.floor(seconds), 0)
  const padded = (value: number): string => String(value).padStart(2, '0')
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor(whole / 60) % 60
  return hours > 0 ? `${hours}:${padded(minutes)}:${padded(whole % 60)}` : `${minutes}:${padded(whole % 60)}`
}

/** A race time, in seconds, as minutes and seconds: "3:07". Rounded, as a time that is done. */
export function timeLabel(seconds: number): string {
  const whole = Math.max(Math.round(seconds), 0)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** A race time as minutes, seconds and tenths: `2:30.5`, from the race's own count of ticks. Ticks less than none are none. */
export function finishTime(ticks: number): string {
  const tenths = Math.max(Math.round(ticks * FIXED_TIMESTEP * 10), 0)
  const seconds = Math.floor((tenths % 600) / 10)
  return `${Math.floor(tenths / 600)}:${String(seconds).padStart(2, '0')}.${tenths % 10}`
}
