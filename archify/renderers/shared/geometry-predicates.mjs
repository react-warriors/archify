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

// Preserve the existing finite determinant/tolerance behavior. Only overflowing
// products use exact IEEE754 dyadics; their exponent range bounds the BigInts.
export function crossProductSign(a, b, c) {
  const raw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Number.isFinite(raw)) return Math.abs(raw) > EPSILON ? Math.sign(raw) : 0;
  const values = [...a, ...b, ...c];
  if (!values.every(Number.isFinite)) return 0;
  const parts = values.map(dyadic);
  const power = Math.min(...parts.map(([, exponent]) => exponent));
  const [ax, ay, bx, by, cx, cy] = parts.map(([value, exponent]) => value << BigInt(exponent - power));
  const determinant = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (determinant === 0n) return 0;
  const [threshold, thresholdPower] = dyadic(EPSILON);
  const commonPower = Math.min(2 * power, thresholdPower);
  const magnitude = (determinant < 0n ? -determinant : determinant) << BigInt(2 * power - commonPower);
  const tolerance = threshold << BigInt(thresholdPower - commonPower);
  return magnitude > tolerance ? (determinant > 0n ? 1 : -1) : 0;
}
