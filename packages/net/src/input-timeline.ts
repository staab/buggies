import {
  NEUTRAL_INPUT,
  copyVehicleInput,
  createVehicleInput,
  type VehicleInput,
} from '@buggies/game'

import { INPUT_TIMELINE_TICKS, NO_TICK } from './protocol.ts'

/**
 * One player's inputs, keyed by the tick they are meant for. Clients send
 * ahead of the server clock; the server takes each tick's input out as it
 * gets there, and holds the last one it had over any tick that never arrived
 * in time, which is what a driver would do too.
 */
export class InputTimeline {
  private readonly slots: VehicleInput[] = []
  private readonly slotTicks = new Int32Array(INPUT_TIMELINE_TICKS).fill(-1)
  private readonly current: VehicleInput = createVehicleInput()
  private consumedTick: number

  /** The newest tick an input has arrived for, late or not. What gets acknowledged. */
  receivedTick = NO_TICK
  applied = 0
  held = 0
  late = 0
  ahead = 0

  constructor(startTick: number) {
    this.consumedTick = startTick - 1
    for (let i = 0; i < INPUT_TIMELINE_TICKS; i++) this.slots.push(createVehicleInput())
    copyVehicleInput(this.current, NEUTRAL_INPUT)
  }

  get appliedInput(): VehicleInput {
    return this.current
  }

  record(tick: number, input: VehicleInput): void {
    if (tick > this.consumedTick + INPUT_TIMELINE_TICKS) {
      this.ahead += 1
      return
    }
    if (this.receivedTick === NO_TICK || tick > this.receivedTick) this.receivedTick = tick
    if (tick <= this.consumedTick) {
      this.late += 1
      return
    }
    const index = tick % INPUT_TIMELINE_TICKS
    copyVehicleInput(this.slots[index]!, input)
    this.slotTicks[index] = tick
  }

  consume(tick: number): VehicleInput {
    const index = tick % INPUT_TIMELINE_TICKS
    if (this.slotTicks[index] === tick) {
      copyVehicleInput(this.current, this.slots[index]!)
      this.applied += 1
    } else {
      this.held += 1
    }
    this.consumedTick = tick
    return this.current
  }
}
