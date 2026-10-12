import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exactProperIntersectionAmounts, exactProperIntersectionPoint,
  exactQuadraticTurningPoint } from '../archify/renderers/shared/geometry-predicates.mjs';

test('exact crossing coordinates round subnormal ties to even, preserving the underflow sign', () => {
  const tiny = Number.MIN_VALUE;
  for (const [end, expected] of [[tiny, 0], [-tiny, -0], [3 * tiny, 2 * tiny],
    [5 * tiny, 2 * tiny], [-3 * tiny, -2 * tiny]]) {
    assert.deepEqual(exactProperIntersectionPoint([0, 0], [end, 1], [-1, 0.5], [1, 0.5]), [expected, 0.5]);
  }
});

test('exact crossing coordinates stay finite when coordinate differences overflow', () => {
  const huge = Number.MAX_VALUE;
  assert.deepEqual(exactProperIntersectionPoint([-huge, -huge], [huge, huge],
    [-huge, huge], [huge, -huge]), [0, 0]);
  assert.deepEqual(exactProperIntersectionPoint([-huge, -Number.MIN_VALUE], [huge, Number.MIN_VALUE],
    [-huge, Number.MIN_VALUE], [huge, -Number.MIN_VALUE]), [0, 0]);
});

test('exact proper crossing bounds reject endpoints and parallel or nonfinite inputs', () => {
  for (const lines of [
    [[0, 0], [1, 1], [1, 1], [2, 0]],
    [[0, 0], [1, 1], [0, 1], [1, 2]],
    [[0, 0], [Infinity, 1], [0, 1], [1, 0]],
  ]) {
    assert.equal(exactProperIntersectionPoint(...lines), null);
    assert.equal(exactProperIntersectionAmounts(...lines), null);
  }
  assert.deepEqual(exactProperIntersectionAmounts([0, 0], [2, 2], [0, 2], [2, 0]), [0.5, 0.5]);
});

test('exact quadratic turning coordinates retain constant axes and huge finite cancellation', () => {
  assert.deepEqual(exactQuadraticTurningPoint([0, 1e14], [1, 1e14], [-3, 1e14], 0), [0.2, 1e14]);
  assert.deepEqual(exactQuadraticTurningPoint([Number.MAX_VALUE, 0], [-Number.MAX_VALUE, 0],
    [Number.MAX_VALUE, 0], 0), [0, 0]);
  assert.deepEqual(exactQuadraticTurningPoint([-1e308, 0], [1e291, 0], [0, 0], 0), [1e274, 0]);
});

test('exact quadratic bounds reject stationary endpoints and a constant derivative', () => {
  for (const points of [
    [[0, 0], [0, 0], [1, 0]],
    [[0, 0], [1, 0], [1, 0]],
    [[0, 0], [1, 0], [2, 0]],
  ]) assert.equal(exactQuadraticTurningPoint(...points, 0), null);
});
