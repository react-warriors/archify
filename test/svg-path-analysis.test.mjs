import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSvgPath } from '../archify/renderers/shared/svg-path-analysis.mjs';

function parsed(source) {
  const result = analyzeSvgPath(source);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.subpaths;
}

test('empty data and move-only subpaths do not invent drawing segments', () => {
  assert.deepEqual(parsed(' \n\t'), []);
  const [first, second] = parsed('M20 20 M100 100');
  assert.deepEqual(first.points, [[20, 20]]);
  assert.deepEqual(second.points, [[100, 100]]);
  assert.deepEqual(first.segments, []);
  assert.deepEqual(second.straightSegments, []);
});

test('a move starts a separate subpath while subsequent pairs draw implicit lines', () => {
  const [first, second] = parsed('M20 20 100 20 M100 100 200 100');
  assert.deepEqual(first.segments, [{ start: [20, 20], end: [100, 20] }]);
  assert.deepEqual(second.segments, [{ start: [100, 100], end: [200, 100] }]);
  assert.deepEqual(first.straightSegments, first.segments);
});

test('relative repetitions and closepath restore the current subpath origin', () => {
  const [first, second] = parsed('m10 20 30 0 h20 v10 l-20 0 z m100 0 20 0');
  assert.deepEqual(first.points, [[10, 20], [40, 20], [60, 20], [60, 30], [40, 30], [10, 20]]);
  assert.equal(first.closed, true);
  assert.deepEqual(second.points, [[110, 20], [130, 20]]);
  assert.equal(second.closed, false);
});

test('each closepath uses its own most recent move and can be followed by drawing', () => {
  const paths = parsed('M20 20 H100 V60 H20 Z M160 20 H240 V60 H160 Z l0 40');
  assert.deepEqual(paths[0].segments.at(-1), { start: [20, 60], end: [20, 20] });
  assert.deepEqual(paths[1].segments.at(-1), { start: [160, 60], end: [160, 20] });
  assert.deepEqual(paths[2].segments, [{ start: [160, 20], end: [160, 60] }]);
});

test('legal number spellings preserve coordinates instead of dropping exponent letters', () => {
  const absolute = parsed('M100 20 V100');
  assert.deepEqual(parsed('M1e2 2e1 V1e2'), absolute);
  assert.deepEqual(parsed('M1E2 2E1 V1E2'), absolute);
  assert.deepEqual(parsed('M+1e+2,+2E+1 V100.'), absolute);
  assert.deepEqual(parsed('M.5-.5 l.5.5')[0].points, [[0.5, -0.5], [1, 0]]);
});

test('quadratic sampling and exact collinear primitives retain their separate meanings', () => {
  const [curve] = parsed('M0 0 Q10 0 10 10 L20 10');
  assert.equal(curve.segments.length, 9);
  assert.deepEqual(curve.points[4], [7.5, 2.5]);
  assert.deepEqual(curve.straightSegments, [{ start: [10, 10], end: [20, 10] }]);
  assert.deepEqual(parsed('M0 0 q10 0 10 10 l10 0')[0], curve);
  assert.deepEqual(parsed('M0 0 Q10 0 20 0')[0].straightSegments, [{ start: [0, 0], end: [20, 0] }]);
});

for (const source of [
  'M20', 'M20 20 Q30 30 40', 'M20 20 L', 'M20 20 Q',
  'M20 20 L30 Z', 'M20 20 Q30 30 L40 40', 'M20 20 Z30 40',
  'L20 20', 'Z', 'M,20 20', 'M20,,20', 'M20 20,', 'M20 20,L30 30',
  'M20 20 R30 30', 'M20 NaN', 'M20 Infinity', 'M20 1e', 'M20 1e+',
  'M20 1e999', 'M1e308 0 l1e308 0', 'M20 20;L30 30', 'M20\u00a020',
]) {
  test(`malformed data terminates with a source offset: ${JSON.stringify(source)}`, () => {
    const result = analyzeSvgPath(source);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'artifact/svg-path-malformed');
    assert.ok(Number.isInteger(result.error.tokenOffset));
    assert.ok(result.error.tokenOffset >= 0 && result.error.tokenOffset <= source.length);
    assert.equal(typeof result.error.reason, 'string');
    assert.equal(result.subpaths, undefined, '不把部分解析当作可信几何返回');
  });
}

test('missing parameters point to the incomplete group or interrupting command', () => {
  assert.equal(analyzeSvgPath('M20').error.tokenOffset, 3);
  assert.equal(analyzeSvgPath('M20 L30 30').error.tokenOffset, 4);
});

for (const command of ['A', 'a', 'C', 'c', 'S', 's', 'T', 't']) {
  test(`recognized unsupported command ${command} is not silently reinterpreted`, () => {
    const result = analyzeSvgPath(`M20 20 ${command} 30 30 40 40 0 50 50`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'artifact/svg-path-unsupported');
    assert.equal(result.error.command, command);
    assert.equal(result.error.tokenOffset, 7);
  });
}

test('backtracking quadratic curves do not masquerade as straight frame edges', () => {
  for (const source of ['M0 0 Q40 0 10 0', 'M10 0 Q-30 0 0 0', 'M0 0 Q40 0 0 0', 'M0 0 Q0 40 0 10']) {
    const [curve] = parsed(source);
    assert.equal(curve.straightSegments.length, 2);
    const [outbound, returning] = curve.straightSegments;
    assert.deepEqual(outbound.start, curve.points[0]);
    assert.deepEqual(returning.end, curve.points.at(-1));
    assert.deepEqual(outbound.end, returning.start);
    assert.ok(Math.max(Math.abs(outbound.end[0]), Math.abs(outbound.end[1])) > 10);
    assert.equal(curve.segments.length, 8);
    assert.ok(curve.points.some(point => Math.max(Math.abs(point[0]), Math.abs(point[1])) > 10));
  }
});

test('finite huge collinear quadratic retains its actual reversal', () => {
  const [curve] = parsed('M0 0 Q1e308 0 0 0');
  assert.deepEqual(curve.straightSegments, [
    { start: [0, 0], end: [5e307, 0] }, { start: [5e307, 0], end: [0, 0] },
  ]);
  assert.ok(curve.points.every(point => point.every(Number.isFinite)));
});

test('near-collinear quadratic preserves the tolerated chord without inventing straight reversals', () => {
  const [curve] = parsed('M0 0 Q300 0.001 0.000001 0');
  assert.deepEqual(curve.straightSegments, [{ start: [0, 0], end: [0.000001, 0] }]);
  assert.ok(curve.points.some(point => point[1] > 0));
});

for (const source of ['M0 .006 Q60 .009 20 .007', 'M0 0 Q8e307 20 1e307 2.5']) {
  test(`collinear reversal survives decimal round-off or overflowing products: ${source}`, () => {
    const [curve] = parsed(source);
    assert.equal(curve.straightSegments.length, 2);
    assert.ok(curve.straightSegments.every(segment => [...segment.start, ...segment.end].every(Number.isFinite)));
    assert.ok(curve.straightSegments[0].end[0] > curve.points.at(-1)[0]);
  });
}

test('translated collinear quadratic keeps its reversal in the local coordinate frame', () => {
  const [curve] = parsed('M1000000 0 Q1000060 3 1000020 1');
  assert.deepEqual(curve.straightSegments, [
    { start: [1000000, 0], end: [1000036, 1.8] },
    { start: [1000036, 1.8], end: [1000020, 1] },
  ]);
});

test('a constant translated quadratic axis stays exactly constant at its turning point', () => {
  const [curve] = parsed('M0 100000000000000 Q1 100000000000000 -3 100000000000000');
  assert.equal(curve.straightSegments.length, 2);
  assert.ok(curve.straightSegments.every(segment => segment.start[1] === 100000000000000
    && segment.end[1] === 100000000000000));
  assert.equal(curve.straightSegments[0].end[0], 0.2);
});

test('round-off allowance does not split a genuinely non-collinear huge quadratic', () => {
  const [curve] = parsed('M0 0 Q2000000000000000 1000000000000000 1000000000000000 500000000000001');
  assert.deepEqual(curve.straightSegments, []);
  assert.equal(curve.segments.length, 8, 'the existing sampled curve remains available');
});


test('non-collinear quadratic retains raw evidence when normalized control offsets underflow', () => {
  const [curve] = parsed('M0 0 Q1e-316 2e-316 1e308 1e308');
  assert.deepEqual(curve.straightSegments, []);
  assert.equal(curve.segments.length, 8);
  assert.ok(curve.points.every(point => point.every(Number.isFinite)));
});


test('finite large curvature is not hidden by relative round-off allowance', () => {
  const [curve] = parsed('M0 0 Q1000000000000000 1000000000000000 500000000000000 500000000000000.3');
  assert.deepEqual(curve.straightSegments, []);
  assert.equal(curve.segments.length, 8);
  const [collinear] = parsed('M0 0 Q1000000000000000 1000000000000000 500000000000000 500000000000000');
  assert.equal(collinear.straightSegments.length, 2, 'exact large collinearity still retains the reversal');
});


test('overflowing products retain genuine curvature and exact collinear controls', () => {
  const [curved] = parsed('M0 0 Q1e308 1e308 5e307 5.000000000000001e307');
  assert.deepEqual(curved.straightSegments, []);
  assert.equal(curved.segments.length, 8);
  const [collinear] = parsed('M0 0 Q1e308 1e308 5e307 5e307');
  assert.equal(collinear.straightSegments.length, 2);
});

test('canceled finite products retain exact quadratic curvature', () => {
  const [curved] = parsed('M0 0 Q1.5430730396329725e308 0.019999999999999997 7.715365198164863e307 0.01');
  assert.deepEqual(curved.straightSegments, []);
  assert.equal(curved.segments.length, 8);
  const [collinear] = parsed('M0 0 Q1.5430730396329725e308 0.02 7.715365198164863e307 0.01');
  assert.equal(collinear.straightSegments.length, 2, 'the exact collinear reversal remains visible');
});

for (const [name, source, vertex] of [
  ['horizontal', 'M-1e308 0 Q1e291 0 0 0', [1e274, 0]],
  ['horizontal reversed', 'M0 0 Q1e291 0 -1e308 0', [1e274, 0]],
  ['vertical', 'M0 -1e308 Q0 1e291 0 0', [0, 1e274]],
  ['vertical reversed', 'M0 0 Q0 1e291 0 -1e308', [0, 1e274]],
]) {
  test(`collinear quadratic retains its exact excursion when the turning parameter rounds to an endpoint: ${name}`, () => {
    const [curve] = parsed(source);
    assert.equal(curve.straightSegments.length, 2);
    assert.deepEqual(curve.straightSegments[0].end, vertex);
    assert.deepEqual(curve.straightSegments[1].start, vertex);
    assert.ok(curve.straightSegments.every(segment => [...segment.start, ...segment.end].every(Number.isFinite)));
    assert.equal(curve.segments.length, 8, 'the existing sampled path contract remains unchanged');
  });
}

test('tolerated curvature with an underflowing normalized endpoint retains only its chord', () => {
  const [curve] = parsed('M0 0 Q1e308 1 1e-16 0');
  assert.deepEqual(curve.straightSegments, [{ start: [0, 0], end: [1e-16, 0] }]);
});

test('translated decimal collinear reversal includes subtraction round-off', () => {
  const [curve] = parsed('M2200.5 71.8 Q2432 -30.7 2246.8 51.3');
  assert.equal(curve.straightSegments.length, 2);
  assert.ok(curve.straightSegments[0].end[0] > 2329);
});

for (const [name, source, start, end] of [
  ['local', 'M0 0 Q100 .03125 1.4901161193847656e-8 0', [0, 0], [2 ** -26, 0]],
  ['translated', 'M67108864 0 Q67108964 .03125 67108864.00000001490116119384765625 0', [2 ** 26, 0], [2 ** 26 + 2 ** -26, 0]],
  ['translated reversed', 'M67108864.00000001490116119384765625 0 Q67108964 .03125 67108864 0', [2 ** 26 + 2 ** -26, 0], [2 ** 26, 0]],
]) {
  test(`exact translation does not turn tolerated curvature into reversal segments: ${name}`, () => {
    const [curve] = parsed(source);
    assert.deepEqual(curve.straightSegments, [{ start, end }]);
    assert.equal(curve.segments.length, 8);
  });
}

for (const [name, source] of [
  ['absolute', 'M0 1000.12345678901234 Q300 1000.12716049268270 100 1000.12469135690246'],
  ['reversed', 'M100 1000.12469135690246 Q300 1000.12716049268270 0 1000.12345678901234'],
  ['relative', 'M0 1000.12345678901234 q300 .00370370367036 100 .00123456789012'],
  ['relative move', 'm0 1000.12345678901234 q300 .00370370367036 100 .00123456789012'],
  ['horizontal start', 'M-10 1000.12345678901234 H0 Q300 1000.12716049268270 100 1000.12469135690246'],
  ['vertical start', 'M0 0 V1000.12345678901234 Q300 1000.12716049268270 100 1000.12469135690246'],
  ['closepath start', 'M0 1000.12345678901234 L1 1000.12345678901234 Z Q300 1000.12716049268270 100 1000.12469135690246'],
]) {
  test(`source decimal collinearity survives number conversion and path state: ${name}`, () => {
    const curves = parsed(source);
    const segments = curves.at(-1).straightSegments.slice(-2);
    assert.equal(segments.length, 2);
    assert.equal(segments[0].end[0], 180);
    assert.deepEqual(segments[0].end, segments[1].start);
  });
}

test('extreme decimal spellings keep bounded advisory evidence without rejecting finite geometry', () => {
  for (const source of [
    'M0 0 Q1e-1000000000 0 1 0',
    `M0 0 Q0.${'0'.repeat(4200)}1 0 1 0`,
  ]) {
    const [curve] = parsed(source);
    assert.deepEqual(curve.straightSegments, [{ start: [0, 0], end: [1, 0] }]);
    assert.equal(curve.segments.length, 8);
  }
});
