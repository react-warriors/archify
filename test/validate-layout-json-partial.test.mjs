import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-validate-layout-json-partial-'));

function feasibleWorkflow() {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: 'Feasible workflow for layout-json partial test',
      output: 'layout-json-feasible.html',
      legend: { mode: 'hidden' },
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b' }],
  };
}

function selfLoopWorkflow() {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: 'Self-loop workflow for layout-json partial test',
      output: 'layout-json-self-loop.html',
      legend: { mode: 'hidden' },
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [{ id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' }],
    edges: [{ id: 'self', from: 'a', to: 'a' }],
  };
}

function explicitPinConflictWorkflow() {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: 'Explicit pin conflict workflow for layout-json partial test',
      output: 'layout-json-explicit-pin.html',
      legend: { mode: 'hidden' },
      quality_profile: 'showcase',
    },
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'bottom', col: 0, type: 'backend', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', toSide: 'top' }],
    groups: [{
      id: 'g', label: 'Very long group label', lane: 'bottom', fromCol: 0, toCol: 0,
    }],
  };
}

function runValidate(workflow, { quality } = {}) {
  const input = path.join(tmp, `fixture-${Math.random().toString(36).slice(2)}.workflow.json`);
  fs.writeFileSync(input, JSON.stringify(workflow));
  const args = ['validate', 'workflow', input, '--layout-json'];
  if (quality) args.push('--quality', quality);
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`validate exited with ${result.status}\n${result.stderr}\n${result.stdout}`);
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('validate workflow --layout-json with a feasible pin returns the existing full layout (no partialLayout)', () => {
  const result = runValidate(feasibleWorkflow());
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.contract, 'readable-v2');
  // Existing receipt shape is preserved
  assert.ok(Array.isArray(receipt.columns) && receipt.columns.length > 0);
  assert.ok(Array.isArray(receipt.nodes) && receipt.nodes.length > 0);
  assert.ok(Array.isArray(receipt.edges) && receipt.edges.length > 0);
  assert.deepEqual(receipt.diagnostics, []);
  // partialLayout must be absent on the success path
  assert.equal(receipt.partialLayout, undefined,
    `successful validate --layout-json must not include partialLayout: ${JSON.stringify(receipt, null, 2)}`);
});

test('validate workflow --layout-json on a self-loop emits partialLayout with attempted candidates', () => {
  const result = runValidate(selfLoopWorkflow());
  assert.equal(result.status, 1, result.stderr);
  const receipt = JSON.parse(result.stdout);
  // contract and diagnostics stay byte-identical to the previous failure shape
  assert.equal(receipt.contract, 'readable-v2');
  assert.ok(Array.isArray(receipt.diagnostics) && receipt.diagnostics.length > 0);
  assert.equal(receipt.diagnostics[0].code, 'workflow/solver-budget-exhausted');
  // Additive partialLayout payload is present
  assert.ok(receipt.partialLayout, 'partialLayout must be present on a route-feasibility failure');
  assert.equal(receipt.partialLayout.partial, true);
  assert.ok(Array.isArray(receipt.partialLayout.columns) && receipt.partialLayout.columns.length > 0,
    `partialLayout.columns must contain at least one entry: ${JSON.stringify(receipt.partialLayout.columns)}`);
  assert.ok(Array.isArray(receipt.partialLayout.nodes) && receipt.partialLayout.nodes.length > 0,
    'partialLayout.nodes must contain at least one node frame');
  const nodeFrame = receipt.partialLayout.nodes[0];
  for (const field of ['id', 'x', 'y', 'width', 'height']) {
    assert.ok(field in nodeFrame, `node frame must include ${field}: ${JSON.stringify(nodeFrame)}`);
  }
  assert.ok(Array.isArray(receipt.partialLayout.edges) && receipt.partialLayout.edges.length > 0,
    'partialLayout.edges must contain at least one entry');
  const failedEdge = receipt.partialLayout.edges.find((edge) => (
    edge.id === 'self' && edge.from === 'a' && edge.to === 'a'
  ));
  assert.ok(failedEdge, `failed edge must be present: ${JSON.stringify(receipt.partialLayout.edges)}`);
  assert.ok(Array.isArray(failedEdge.attemptedCandidateFamilies)
    && failedEdge.attemptedCandidateFamilies.length > 0,
    'failed edge must include attemptedCandidateFamilies with at least one entry');
  const familiesWithPoints = failedEdge.attemptedCandidateFamilies.filter((entry) => (
    Array.isArray(entry.points) && entry.points.length > 0
  ));
  assert.ok(familiesWithPoints.length > 0,
    `attemptedCandidateFamilies must include at least one entry with points: ${JSON.stringify(failedEdge.attemptedCandidateFamilies)}`);
  for (const entry of familiesWithPoints) {
    assert.ok(typeof entry.family === 'string' && entry.family.length > 0,
      `attemptedCandidateFamily must include a family name: ${JSON.stringify(entry)}`);
  }
});

test('validate workflow --layout-json on an explicit-pin-conflict workflow emits partialLayout', () => {
  const result = runValidate(explicitPinConflictWorkflow(), { quality: 'showcase' });
  assert.equal(result.status, 1, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.contract, 'readable-v2');
  assert.ok(Array.isArray(receipt.diagnostics) && receipt.diagnostics.length > 0);
  assert.ok(receipt.diagnostics.some(({ code }) => code === 'workflow/explicit-pin-conflict'),
    `expected workflow/explicit-pin-conflict: ${JSON.stringify(receipt.diagnostics)}`);
  // Additive partialLayout payload is present
  assert.ok(receipt.partialLayout, 'partialLayout must be present on an explicit-pin-conflict failure');
  assert.equal(receipt.partialLayout.partial, true);
  assert.ok(Array.isArray(receipt.partialLayout.columns) && receipt.partialLayout.columns.length > 0);
  assert.ok(Array.isArray(receipt.partialLayout.nodes) && receipt.partialLayout.nodes.length > 0);
  assert.ok(Array.isArray(receipt.partialLayout.edges) && receipt.partialLayout.edges.length > 0);
  const failedEdge = receipt.partialLayout.edges.find((edge) => (
    edge.id === 'ab' && edge.from === 'a' && edge.to === 'b'
  ));
  assert.ok(failedEdge, `failed edge ab must be present: ${JSON.stringify(receipt.partialLayout.edges)}`);
  assert.ok(Array.isArray(failedEdge.attemptedCandidateFamilies)
    && failedEdge.attemptedCandidateFamilies.length > 0,
    'failed edge must include attemptedCandidateFamilies with at least one entry');
  const familiesWithPoints = failedEdge.attemptedCandidateFamilies.filter((entry) => (
    Array.isArray(entry.points) && entry.points.length > 0
  ));
  assert.ok(familiesWithPoints.length > 0,
    `attemptedCandidateFamilies must include at least one entry with points: ${JSON.stringify(failedEdge.attemptedCandidateFamilies)}`);
});

test('compileWorkflow exposes a partialLayout field on the result object (not inside receipt)', () => {
  const result = compileWorkflow({ workflow: selfLoopWorkflow(), qualityProfile: 'standard' });
  assert.equal(result.ok, false);
  // Existing receipt stays byte-identical (no partialLayout added inside it)
  assert.equal(result.receipt.partialLayout, undefined,
    `failure receipt must not gain partialLayout: ${JSON.stringify(result.receipt)}`);
  assert.equal(typeof result.receipt.contract, 'string');
  assert.ok(Array.isArray(result.receipt.diagnostics));
  // The partialLayout appears on the result object itself
  assert.ok(result.partialLayout, 'partialLayout must be a top-level field on the compile result');
  assert.equal(result.partialLayout.partial, true);
  assert.ok(Array.isArray(result.partialLayout.columns) && result.partialLayout.columns.length > 0);
  assert.ok(Array.isArray(result.partialLayout.nodes) && result.partialLayout.nodes.length > 0);
  assert.ok(Array.isArray(result.partialLayout.edges) && result.partialLayout.edges.length > 0);
});

process.on('exit', () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; the temp directory lives in the OS tempdir.
  }
});