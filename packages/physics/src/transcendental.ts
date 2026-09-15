// Ported from the seattle project (src/core/math). Kept in its original shape
// and formatting so the two can be compared and resynced; the arithmetic is
// what makes a simulation replay the same way on every machine.

const PI_HIGH = 3.141592653589793
const PI_LOW = 1.2246467991473532e-16
const PI_OVER_TWO = 1.5707963267948966
const PI_OVER_TWO_MID = 6.123233995736766e-17
const PI_OVER_TWO_LOW = -1.4973849048591698e-33
const PI_OVER_FOUR = 0.7853981633974483
const THREE_PI_OVER_FOUR = 2.356194490192345
const TWO_OVER_PI = 0.6366197723675814
const TWO_OVER_PI_LOW = -3.935735335036497e-17
const DEKKER_SPLITTER = 134217729
const RATIO_LIMIT = 1152921504606846976
const ATAN_LINEAR_LIMIT = 1.862645149230957e-9
const REDUCED_ANGLE_BOUND = 0.7853981633974484

const SIN_1 = -1.66666666666666324348e-1
const SIN_2 = 8.33333333332248946124e-3
const SIN_3 = -1.98412698298579493134e-4
const SIN_4 = 2.75573137070700676789e-6
const SIN_5 = -2.50507602534068634195e-8
const SIN_6 = 1.58969099521155010221e-10

const COS_1 = 4.16666666666666019037e-2
const COS_2 = -1.38888888888741095749e-3
const COS_3 = 2.48015872894767294178e-5
const COS_4 = -2.75573143513906633035e-7
const COS_5 = 2.08757232129817482790e-9
const COS_6 = -1.13596475577881948265e-11

const ATAN_HALF_HIGH = 4.63647609000806093515e-1
const ATAN_HALF_LOW = 2.26987774529616870924e-17
const ATAN_ONE_HIGH = 7.85398163397448278999e-1
const ATAN_ONE_LOW = 3.06161699786838301793e-17
const ATAN_THREE_HALVES_HIGH = 9.82793723247329054082e-1
const ATAN_THREE_HALVES_LOW = 1.39033110312309984516e-17
const ATAN_INFINITY_HIGH = 1.57079632679489655800e0
const ATAN_INFINITY_LOW = 6.12323399573676603587e-17

const ATAN_1 = 3.33333333333329318027e-1
const ATAN_2 = -1.99999999998764832476e-1
const ATAN_3 = 1.42857142725034663711e-1
const ATAN_4 = -1.11111104054623557880e-1
const ATAN_5 = 9.09088713343650656196e-2
const ATAN_6 = -7.69187620504482999495e-2
const ATAN_7 = 6.66107313738753120669e-2
const ATAN_8 = -5.83357013379057348645e-2
const ATAN_9 = 4.97687799461593236017e-2
const ATAN_10 = -3.65315727442169155270e-2
const ATAN_11 = 1.62858201153657823623e-2

function splitHigh(value: number): number {
  const scaled = DEKKER_SPLITTER * value

  return scaled - (scaled - value)
}

function productError(a: number, b: number, product: number): number {
  const aHigh = splitHigh(a)
  const aLow = a - aHigh
  const bHigh = splitHigh(b)
  const bLow = b - bHigh

  return aHigh * bHigh - product + aHigh * bLow + aLow * bHigh + aLow * bLow
}

function sumError(a: number, b: number, sum: number): number {
  const bVirtual = sum - a

  return a - (sum - bVirtual) + (b - bVirtual)
}

let reducedQuadrant = 0
let reducedHigh = 0
let reducedLow = 0

function reduceToQuarterTurn(x: number): void {
  const scaled = x * TWO_OVER_PI
  const scaledError = productError(x, TWO_OVER_PI, scaled) + x * TWO_OVER_PI_LOW

  let turns = Math.round(scaled)

  const residual = scaled - turns + scaledError

  if (residual > 0.5) turns += 1
  else if (residual < -0.5) turns -= 1

  reducedQuadrant = turns - 4 * Math.floor(turns / 4)

  const highProduct = turns * PI_OVER_TWO
  const highError = productError(turns, PI_OVER_TWO, highProduct)
  const afterHigh = x - highProduct
  const afterHighError = sumError(x, -highProduct, afterHigh)
  const midProduct = turns * PI_OVER_TWO_MID
  const midError = productError(turns, PI_OVER_TWO_MID, midProduct)
  const afterMid = afterHigh - midProduct
  const afterMidError = sumError(afterHigh, -midProduct, afterMid)
  const tail =
    afterHighError + afterMidError - highError - midError - turns * PI_OVER_TWO_LOW

  reducedHigh = afterMid + tail
  reducedLow = sumError(afterMid, tail, reducedHigh)

  if (!(reducedHigh >= -REDUCED_ANGLE_BOUND && reducedHigh <= REDUCED_ANGLE_BOUND)) {
    reducedQuadrant = 0
    reducedHigh = 0
    reducedLow = 0
  }
}

function sinNearZero(x: number, tail: number): number {
  const square = x * x
  const cube = square * x
  const series = SIN_2 + square * (SIN_3 + square * (SIN_4 + square * (SIN_5 + square * SIN_6)))

  return x - (square * (0.5 * tail - cube * series) - tail - cube * SIN_1)
}

function cosNearZero(x: number, tail: number): number {
  const square = x * x
  const series =
    square *
    (COS_1 +
      square *
        (COS_2 + square * (COS_3 + square * (COS_4 + square * (COS_5 + square * COS_6)))))
  const half = 0.5 * square
  const partial = 1 - half

  return partial + (1 - partial - half + (square * series - x * tail))
}

export function sin(x: number): number {
  if (x === 0) return x
  if (!Number.isFinite(x)) return NaN

  reduceToQuarterTurn(x)

  if (reducedQuadrant === 0) return sinNearZero(reducedHigh, reducedLow)
  if (reducedQuadrant === 1) return cosNearZero(reducedHigh, reducedLow)
  if (reducedQuadrant === 2) return -sinNearZero(reducedHigh, reducedLow)

  return -cosNearZero(reducedHigh, reducedLow)
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN

  reduceToQuarterTurn(x)

  if (reducedQuadrant === 0) return cosNearZero(reducedHigh, reducedLow)
  if (reducedQuadrant === 1) return -sinNearZero(reducedHigh, reducedLow)
  if (reducedQuadrant === 2) return -cosNearZero(reducedHigh, reducedLow)

  return sinNearZero(reducedHigh, reducedLow)
}

function atanOfMagnitude(ratio: number): number {
  if (ratio < ATAN_LINEAR_LIMIT) return ratio

  let reduced = ratio
  let offsetHigh = 0
  let offsetLow = 0

  if (ratio >= 0.4375) {
    if (ratio < 0.6875) {
      reduced = (2 * ratio - 1) / (2 + ratio)
      offsetHigh = ATAN_HALF_HIGH
      offsetLow = ATAN_HALF_LOW
    } else if (ratio < 1.1875) {
      reduced = (ratio - 1) / (ratio + 1)
      offsetHigh = ATAN_ONE_HIGH
      offsetLow = ATAN_ONE_LOW
    } else if (ratio < 2.4375) {
      reduced = (ratio - 1.5) / (1 + 1.5 * ratio)
      offsetHigh = ATAN_THREE_HALVES_HIGH
      offsetLow = ATAN_THREE_HALVES_LOW
    } else {
      reduced = -1 / ratio
      offsetHigh = ATAN_INFINITY_HIGH
      offsetLow = ATAN_INFINITY_LOW
    }
  }

  const square = reduced * reduced
  const fourth = square * square
  const oddSeries =
    square *
    (ATAN_1 +
      fourth *
        (ATAN_3 + fourth * (ATAN_5 + fourth * (ATAN_7 + fourth * (ATAN_9 + fourth * ATAN_11)))))
  const evenSeries =
    fourth *
    (ATAN_2 + fourth * (ATAN_4 + fourth * (ATAN_6 + fourth * (ATAN_8 + fourth * ATAN_10))))

  if (offsetHigh === 0) return reduced - reduced * (oddSeries + evenSeries)

  return offsetHigh - (reduced * (oddSeries + evenSeries) - offsetLow - reduced)
}

export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return NaN

  const negativeY = y < 0 || (y === 0 && 1 / y < 0)
  const negativeX = x < 0 || (x === 0 && 1 / x < 0)

  if (y === 0) return negativeX ? (negativeY ? -PI_HIGH : PI_HIGH) : y
  if (x === 0) return negativeY ? -PI_OVER_TWO : PI_OVER_TWO

  const magnitudeY = y < 0 ? -y : y
  const magnitudeX = x < 0 ? -x : x

  if (magnitudeX === Infinity) {
    if (magnitudeY === Infinity) {
      const diagonal = negativeX ? THREE_PI_OVER_FOUR : PI_OVER_FOUR

      return negativeY ? -diagonal : diagonal
    }

    if (negativeX) return negativeY ? -PI_HIGH : PI_HIGH

    return negativeY ? -0 : 0
  }

  if (magnitudeY === Infinity) return negativeY ? -PI_OVER_TWO : PI_OVER_TWO

  let angle = 0

  if (magnitudeY > magnitudeX * RATIO_LIMIT) angle = PI_OVER_TWO
  else if (!negativeX || magnitudeY * RATIO_LIMIT >= magnitudeX)
    angle = atanOfMagnitude(magnitudeY / magnitudeX)

  if (!negativeX) return negativeY ? -angle : angle

  return negativeY ? angle - PI_LOW - PI_HIGH : PI_HIGH - (angle - PI_LOW)
}

export function hypot(x: number, y: number): number {
  const magnitudeX = x < 0 ? -x : x
  const magnitudeY = y < 0 ? -y : y

  if (magnitudeX === Infinity || magnitudeY === Infinity) return Infinity
  if (magnitudeX !== magnitudeX || magnitudeY !== magnitudeY) return NaN

  const larger = magnitudeX > magnitudeY ? magnitudeX : magnitudeY
  const smaller = magnitudeX > magnitudeY ? magnitudeY : magnitudeX

  if (larger === 0) return 0

  const ratio = smaller / larger

  return larger * Math.sqrt(1 + ratio * ratio)
}
