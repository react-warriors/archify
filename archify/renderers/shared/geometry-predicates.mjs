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

// Shortest decimal coordinates retain exact-zero evidence for decimal-authored
// lines. This does not recover the original SVG spelling or relax the absolute
// curvature tolerance applied by the caller.
function canonicalDecimalCollinear(a, b, c) {
  const parts = [a, b, c].flat().map(value => {
    const [mantissa, exponent = '0'] = String(value).split('e');
    const [whole, fraction = ''] = mantissa.split('.');
    return [BigInt(whole + fraction), Number(exponent) - fraction.length];
  });
  const power = Math.min(...parts.map(([, exponent]) => exponent));
  const [ax, ay, bx, by, cx, cy] = parts.map(([value, exponent]) => value * 10n ** BigInt(exponent - power));
  return (bx - ax) * (cy - ay) === (by - ay) * (cx - ax);
}

// Compare relative collinearity without scaling nonzero offsets/products to
// zero. Local product round-off cannot grow merely because of translation.
// Canonical decimal exact-zero evidence also preserves decimal-authored lines.
// The caller separately enforces the existing absolute curvature tolerance.
export function collinearWithinRoundoff(a, b, c) {
  const exact = exactCoordinates([a, b, c]);
  if (!exact) return false;
  const [ax, ay, bx, by, cx, cy] = exact.coordinates;
  const abs = value => value < 0n ? -value : value;
  const ux = bx - ax, uy = by - ay, vx = cx - ax, vy = cy - ay;
  const left = ux * vy, right = uy * vx;
  return (abs(left - right) << 51n) <= abs(left) + abs(right)
    || canonicalDecimalCollinear(a, b, c);
}

// Round a signed rational times a binary power once, to nearest, ties-even.
// Shift integers before division so cancellation and subnormals are preserved.
function rationalNumber(numerator, denominator, binaryPower = 0) {
  if (numerator === 0n) return 0;
  const negative = numerator < 0n;
  if (negative) numerator = -numerator;
  let exponent = numerator.toString(2).length - denominator.toString(2).length;
  if (exponent < 0 ? (numerator << BigInt(-exponent)) < denominator
    : numerator < (denominator << BigInt(exponent))) exponent -= 1;
  const power = Math.max(exponent + binaryPower - 52, -1074);
  const shift = binaryPower - power;
  if (shift >= 0) numerator <<= BigInt(shift);
  else denominator <<= BigInt(-shift);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (2n * remainder > denominator || (2n * remainder === denominator && quotient % 2n === 1n)) quotient += 1n;
  return (negative ? -Number(quotient) : Number(quotient)) * 2 ** power;
}

function properIntersection(a, b, c, d) {
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
  return { ...exact, numerator, otherNumerator, denominator };
}

export function exactProperIntersectionAmounts(a, b, c, d) {
  const intersection = properIntersection(a, b, c, d);
  if (!intersection) return null;
  const { numerator, otherNumerator, denominator } = intersection;
  return [rationalNumber(numerator, denominator), rationalNumber(otherNumerator, denominator)];
}

// The orientation gate has already accepted a proper crossing. Evaluate its
// coordinates exactly before rounding; rounded interior parameters can lose
// small coordinates near a large endpoint even on the shorter segment.
export function exactProperIntersectionPoint(a, b, c, d) {
  const intersection = properIntersection(a, b, c, d);
  if (!intersection) return null;
  const { power, coordinates, numerator, denominator } = intersection;
  return [0, 1].map(axis => rationalNumber(coordinates[axis] * denominator
    + (coordinates[axis + 2] - coordinates[axis]) * numerator, denominator, power));
}

// Test the turning parameter's strict bounds as integers, then evaluate the
// Bernstein polynomial exactly. A true interior parameter can round to 0/1.
export function exactQuadraticTurningPoint(start, control, end, axis) {
  const exact = exactCoordinates([start, control, end]);
  if (!exact) return null;
  const { power, coordinates } = exact;
  let numerator = coordinates[axis] - coordinates[axis + 2];
  let denominator = coordinates[axis] - 2n * coordinates[axis + 2] + coordinates[axis + 4];
  if (denominator < 0n) {
    denominator = -denominator;
    numerator = -numerator;
  }
  if (numerator <= 0n || numerator >= denominator) return null;
  const remaining = denominator - numerator;
  return [0, 1].map(index => rationalNumber(remaining * remaining * coordinates[index]
    + 2n * remaining * numerator * coordinates[index + 2]
    + numerator * numerator * coordinates[index + 4], denominator * denominator, power));
}
