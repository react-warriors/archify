const EPSILON = 1e-9;
const bits = new DataView(new ArrayBuffer(8));
const FRACTION_MASK = (1n << 52n) - 1n;

function dyadic(value) {
  bits.setFloat64(0, value);
  const encoded = bits.getBigUint64(0);
  const exponent = Number((encoded >> 52n) & 0x7ffn);
  const significand = (encoded & FRACTION_MASK) | (exponent ? 1n << 52n : 0n);
  return [encoded >> 63n ? -significand : significand, exponent ? exponent - 1075 : -1074];
}

function exactCoordinates(points) {
  const values = points.flat();
  if (!values.every(Number.isFinite)) return null;
  const parts = values.map(dyadic);
  const power = Math.min(...parts.map(([, exponent]) => exponent));
  return { power, coordinates: parts.map(([value, exponent]) => value << BigInt(exponent - power)) };
}

// Use the orient2d round-off bound for coordinate differences and products.
// Uncertain signs/tolerance comparisons use exact bounded IEEE754 dyadics.
export function crossProductSign(a, b, c) {
  const left = (b[0] - a[0]) * (c[1] - a[1]);
  const right = (b[1] - a[1]) * (c[0] - a[0]);
  const raw = left - right;
  const roundoff = (3 + 8 * Number.EPSILON) * (Number.EPSILON / 2) * (Math.abs(left) + Math.abs(right));
  if (Number.isFinite(raw) && Number.isFinite(roundoff)) {
    if (Math.abs(raw) > EPSILON + roundoff) return Math.sign(raw);
    if (Math.abs(raw) + roundoff < EPSILON) return 0;
  }
  const exact = exactCoordinates([a, b, c]);
  if (!exact) return 0;
  const { power, coordinates: [ax, ay, bx, by, cx, cy] } = exact;
  const determinant = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (determinant === 0n) return 0;
  const [threshold, thresholdPower] = dyadic(EPSILON);
  const commonPower = Math.min(2 * power, thresholdPower);
  const magnitude = (determinant < 0n ? -determinant : determinant) << BigInt(2 * power - commonPower);
  const tolerance = threshold << BigInt(thresholdPower - commonPower);
  return magnitude > tolerance ? (determinant > 0n ? 1 : -1) : 0;
}

// Convert a positive ratio below one without overflowing either integer or
// erasing a subnormal quotient. Round the exact fraction to nearest, ties-even.
function unitRatio(numerator, denominator) {
  let exponent = numerator.toString(2).length - denominator.toString(2).length;
  if ((numerator << BigInt(-exponent)) < denominator) exponent -= 1;
  const power = Math.max(exponent - 52, -1074);
  const scaled = numerator << BigInt(-power);
  let quotient = scaled / denominator;
  const remainder = scaled % denominator;
  if (2n * remainder > denominator || (2n * remainder === denominator && quotient % 2n === 1n)) quotient += 1n;
  return Number(quotient) * 2 ** power;
}

// The orientation gate has already accepted a proper crossing. If common
// normalization collapses a segment, recover its parameters from exact inputs.
export function exactProperIntersectionAmounts(a, b, c, d) {
  const exact = exactCoordinates([a, b, c, d]);
  if (!exact) return null;
  const [ax, ay, bx, by, cx, cy, dx, dy] = exact.coordinates;
  const abX = bx - ax, abY = by - ay, cdX = dx - cx, cdY = dy - cy;
  let denominator = abX * cdY - abY * cdX;
  if (denominator === 0n) return null;
  let numerator = (cx - ax) * cdY - (cy - ay) * cdX;
  let otherNumerator = (cx - ax) * abY - (cy - ay) * abX;
  if (denominator < 0n) {
    denominator = -denominator;
    numerator = -numerator;
    otherNumerator = -otherNumerator;
  }
  if (numerator <= 0n || numerator >= denominator || otherNumerator <= 0n || otherNumerator >= denominator) return null;
  return [unitRatio(numerator, denominator), unitRatio(otherNumerator, denominator)];
}
