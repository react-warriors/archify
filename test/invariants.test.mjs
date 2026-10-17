import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../archify/renderers/shared/validator.mjs';
import { validateCrossCollectionContracts } from '../archify/renderers/shared/cli.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = {
  architecture: ['production-deployment.architecture.json', 'components'],
  class: ['payment-processors.class.json', 'types'],
  dataflow: ['event-stream.dataflow.json', 'nodes'],
  erd: ['orders.erd.json', 'entities'],
  lifecycle: ['deployment-release.lifecycle.json', 'states'],
  sequence: ['async-job-roundtrip.sequence.json', 'participants'],
  timeline: ['payment-incident.timeline.json', 'events'],
  tree: ['archify-repository.tree.json', 'nodes'],
  waterfall: ['checkout-request.waterfall.json', 'spans'],
  workflow: ['holiday-planning.workflow.json', 'nodes'],
};

function fixture(name) {
  const [file] = fixtures[name];
  return JSON.parse(fs.readFileSync(path.join(root, 'archify', 'examples', file), 'utf8'));
}

test('invariants validate every diagram type against its renderable element collection', () => {
  for (const [type, [, collection]] of Object.entries(fixtures)) {
    const document = fixture(type);
    document.invariants = [{
      id: 'INV-1',
      statement: 'The referenced element remains part of this specification.',
      constrains: [document[collection][0].id],
    }];
    assert.doesNotThrow(() => validateSchema(type, document), type);
    assert.doesNotThrow(() => validateCrossCollectionContracts(type, document), type);
  }
});

test('invariants reject references to unknown elements with a diagnostic', () => {
  const document = fixture('workflow');
  document.invariants = [{
    id: 'INV-1',
    statement: 'An unknown node must not be silently accepted.',
    constrains: ['missing-node'],
  }];
  assert.throws(
    () => validateCrossCollectionContracts('workflow', document),
    (error) => error.archifyDiagnostics?.some((diagnostic) => (
      diagnostic.code === 'invariant/unknown-element'
      && diagnostic.supportedFixes.includes("use an id from the diagram's nodes collection")
    )),
  );
});

test('invariants reject duplicate stable IDs', () => {
  const document = fixture('workflow');
  document.invariants = [
    { id: 'INV-1', statement: 'First statement.', constrains: [document.nodes[0].id] },
    { id: 'INV-1', statement: 'Second statement.', constrains: [document.nodes[1].id] },
  ];
  assert.throws(
    () => validateCrossCollectionContracts('workflow', document),
    (error) => error.archifyDiagnostics?.some((diagnostic) => diagnostic.code === 'invariant/duplicate-id'),
  );
});

test('invariants remain schema constrained before semantic validation', () => {
  const document = fixture('architecture');
  document.invariants = [{ id: 'INV-1', statement: '', constrains: [] }];
  assert.throws(() => validateSchema('architecture', document), /schema validation failed/);
});
