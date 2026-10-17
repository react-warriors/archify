import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimumReadableSourceTextPx } from '../archify/renderers/shared/desktop-readability.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-boundary-endpoints-'));
let sequence = 0;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(doc, command = 'render') {
  const input = path.join(tmp, `input-${sequence++}.json`);
  const output = input.replace(/\.json$/, '.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  const args = command === 'render' ? [output] : ['--layout-json', '--json'];
  const result = spawnSync(process.execPath, [cli, command, 'architecture', input, ...args], { encoding: 'utf8' });
  assert.ifError(result.error);
  return {
    ...result,
    svg: result.status === 0 && command === 'render'
      ? fs.readFileSync(output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/)[0]
      : null,
  };
}

function render(doc) {
  const result = run(doc);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.svg;
}

function inspect(doc) {
  const result = run(doc, 'validate');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function diagram(connection = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Boundary endpoints', output: 'boundary-endpoints.html', quality_profile: 'standard' },
    components: [
      { id: 'left', type: 'backend', label: 'Left', pos: [120, 140], size: [120, 60] },
      { id: 'right', type: 'database', label: 'Right', pos: [620, 140], size: [120, 60] },
    ],
    boundaries: [
      { id: 'left-scope', kind: 'region', label: 'Left scope', wraps: ['left'], pad: 24 },
      { id: 'right-scope', kind: 'security-group', label: 'Right scope', wraps: ['right'], pad: 24 },
    ],
    connections: [{ id: 'between', from: 'left-scope', to: 'right-scope', ...connection }],
  };
}

function frameRect(svg, label) {
  const match = svg.match(new RegExp(
    `<rect data-graph-role="structural-frame"[^>]*data-composition-frame-label="${label}"[^>]*x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`,
  ));
  assert.ok(match, `missing boundary ${label}`);
  const [x, y, width, height] = match.slice(1).map(Number);
  return { x, y, width, height };
}

function connectionPoints(svg, id = 'between') {
  const identity = id ? `data-edge-id="${id}"[^>]*` : '';
  const match = svg.match(new RegExp(`${identity}data-composition-points="([^"]+)"`));
  assert.ok(match, 'missing boundary connection');
  return match[1].split(';').map((point) => point.split(',').map(Number));
}

function assertFrameEndpoint(points, frame, endpoint, expectedSide) {
  const [port, neighbor] = endpoint === 'source'
    ? points : [points.at(-1), points.at(-2)];
  const [x, y] = port;
  const right = frame.x + frame.width;
  const bottom = frame.y + frame.height;
  const close = (left, right) => Math.abs(left - right) < 0.01;
  assert.ok(x >= frame.x && x <= right && y >= frame.y && y <= bottom,
    `${endpoint} must attach to the visible frame: ${JSON.stringify({ port, frame })}`);
  const side = close(x, frame.x) ? 'left' : close(x, right) ? 'right'
    : close(y, frame.y) ? 'top' : close(y, bottom) ? 'bottom' : null;
  assert.ok(side, `${endpoint} must lie on the visible frame border`);
  if (expectedSide) assert.equal(side, expectedSide);
  const vertical = side === 'top' || side === 'bottom';
  assert.ok(close(neighbor[vertical ? 0 : 1], port[vertical ? 0 : 1]),
    `${endpoint} must meet its ${side} border perpendicularly`);
  const delta = neighbor[vertical ? 1 : 0] - port[vertical ? 1 : 0];
  assert.ok(side === 'top' || side === 'left' ? delta < 0 : delta > 0,
    `${endpoint} must connect from outside its ${side} border`);
  return side;
}

for (const [route, fromSide, toSide, targetPos] of [
  ['auto', 'right', 'left', [620, 300]],
  ['straight', 'right', 'left', [620, 140]],
  ['orthogonal-h', 'right', 'left', [620, 300]],
  ['orthogonal-v', 'bottom', 'top', [620, 380]],
]) {
  test(`architecture: ${route} connections join the visible boundary frames`, () => {
    const doc = diagram({ route, fromSide, toSide });
    doc.components[1].pos = targetPos;
    const svg = render(doc);
    const left = frameRect(svg, 'Left scope');
    const right = frameRect(svg, 'Right scope');
    const points = connectionPoints(svg);
    assert.deepEqual(points[0], fromSide === 'right'
      ? [left.x + left.width, left.y + left.height / 2]
      : [left.x + left.width / 2, left.y + left.height]);
    assert.deepEqual(points.at(-1), toSide === 'left'
      ? [right.x, right.y + right.height / 2]
      : [right.x + right.width / 2, right.y]);
    for (let index = 1; index < points.length; index += 1) {
      assert.ok(points[index][0] === points[index - 1][0] || points[index][1] === points[index - 1][1]);
    }
    for (const boundary of doc.boundaries) {
      assert.match(svg, new RegExp(`data-node-id="${boundary.id}"[^>]*data-node-kind="${boundary.kind}"`));
    }
    assert.deepEqual(
      [...svg.matchAll(/data-legend-semantic-kind="([^"]+)"/g)].map((match) => match[1]),
      ['backend', 'database'],
      'boundary kinds must not become component legend entries',
    );
    const layout = inspect(doc);
    assert.deepEqual(layout.components.map(({ id }) => id), ['left', 'right']);
    assert.equal(layout.connections.length, 1);
    assert.deepEqual(layout.connections[0].points, points);
  });
}

for (const [from, to] of [['left', 'right-scope'], ['left-scope', 'right']]) {
  test(`architecture: mixed endpoints ${from} -> ${to} share component routing`, () => {
    const doc = diagram({ from, to });
    const svg = render(doc);
    const points = connectionPoints(svg);
    const componentRect = ({ pos: [x, y], size: [width, height] }) => ({ x, y, width, height });
    const source = from === 'left' ? componentRect(doc.components[0]) : frameRect(svg, 'Left scope');
    const target = to === 'right' ? componentRect(doc.components[1]) : frameRect(svg, 'Right scope');
    assertFrameEndpoint(points, source, 'source');
    assertFrameEndpoint(points, target, 'target');
  });
}

test('architecture: boundary anchors use the final title-expanded frame', () => {
  const doc = diagram({ route: 'straight', fromSide: 'right', toSide: 'left' });
  doc.boundaries[0].label = 'Disaster recovery ownership boundary';
  doc.boundaries[0].pad = 0;
  const svg = render(doc);
  const frame = frameRect(svg, doc.boundaries[0].label);
  assert.ok(frame.width > doc.components[0].size[0], 'title must expand the component-derived frame');
  assert.deepEqual(connectionPoints(svg)[0], [frame.x + frame.width, frame.y + frame.height / 2]);
});

for (const [name, labelOptions, expected] of [
  ['explicit labelAt', { labelAt: [430, 285], labelDx: 25, labelDy: 30 }, [430, 285]],
  ['labelSegment and offsets', { labelSegment: 1, labelDx: 15, labelDy: 5 }, [355, 228]],
]) {
  test(`architecture: boundary routes preserve authored via and ${name}`, () => {
    const via = [[340, 168], [340, 298], [520, 298], [520, 168]];
    const doc = diagram({
      label: 'handoff',
      fromSide: 'right',
      toSide: 'left',
      via,
      ...labelOptions,
    });
    const layout = inspect(doc);
    assert.deepEqual(layout.connections[0].points.slice(1, -1), via);
    assert.deepEqual(layout.connections[0].labelAt, expected);
    assert.deepEqual(layout.labels[0].labelAt, expected);
    const svg = render(doc);
    assert.deepEqual(connectionPoints(svg).slice(1, -1), via);
  });
}

test('architecture: assigning boundary ids leaves legacy component geometry unchanged', () => {
  const doc = JSON.parse(fs.readFileSync(
    path.join(skillRoot, '..', 'test/fixtures/v1-baseline/web-app.architecture.json'), 'utf8',
  ));
  const legacy = inspect(doc);
  doc.boundaries.forEach((boundary, index) => { boundary.id = `scope-${index}`; });
  const identified = inspect(doc);
  assert.deepEqual(identified.components, legacy.components);
  assert.deepEqual(identified.connections, legacy.connections);
  assert.deepEqual(identified.labels, legacy.labels);
  assert.deepEqual(identified.viewBox, legacy.viewBox);
  assert.deepEqual(identified.boundaries.map(({ id, ...boundary }) => boundary), legacy.boundaries);
});

for (const [name, mutate] of [
  ['duplicate boundary ids', (doc) => { doc.boundaries[1].id = 'left-scope'; }],
  ['component and boundary id collision', (doc) => { doc.boundaries[0].id = 'left'; }],
]) {
  test(`architecture: ${name} are rejected without a renderer crash`, () => {
    const doc = diagram();
    doc.connections = [];
    mutate(doc);
    const result = run(doc, 'validate');
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /ids must be unique/i);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /TypeError|Cannot read/);
  });
}

test('architecture: boundary endpoints retain component obstacle validation', () => {
  const doc = diagram({ route: 'straight', fromSide: 'right', toSide: 'left' });
  doc.components.push({ id: 'obstacle', type: 'backend', label: 'Obstacle', pos: [380, 140], size: [120, 60] });
  const result = run(doc, 'validate');
  assert.notEqual(result.status, 0);
  const receipt = JSON.parse(result.stdout);
  const diagnostic = receipt.diagnostics.find(({ code }) => code === 'clean-flow/edge-through-node');
  assert.ok(diagnostic, JSON.stringify(receipt));
  assert.equal(diagnostic.evidence.obstacleId, 'obstacle');
});

test('architecture: boundary wraps remain component references', () => {
  const doc = diagram();
  doc.connections = [];
  doc.boundaries[1].wraps = ['left-scope'];
  const result = run(doc, 'validate');
  assert.notEqual(result.status, 0);
  assert.match(JSON.parse(result.stdout).error, /wraps unknown component "left-scope"/);
});

for (const [name, mutate] of [
  ['member component', (doc) => { doc.connections[0].to = 'left'; }],
  ['nested boundary', (doc) => {
    doc.boundaries.push({ id: 'outer', kind: 'region', label: 'Outer scope', wraps: ['left'], pad: 64 });
    doc.connections[0].from = 'outer';
    doc.connections[0].to = 'left-scope';
  }],
]) {
  test(`architecture: a boundary connected to its ${name} has a repairable diagnostic`, () => {
    const doc = diagram();
    mutate(doc);
    const result = run(doc, 'validate');
    assert.notEqual(result.status, 0);
    const receipt = JSON.parse(result.stdout);
    const diagnostic = receipt.diagnostics.find(({ code }) => code === 'architecture/boundary-endpoint-contained');
    assert.ok(diagnostic, JSON.stringify(receipt));
    assert.ok(diagnostic.supportedFixes.length > 0);
  });
}

test('architecture: boundary routing and title sizing share the label-expanded canvas', () => {
  const doc = diagram({
    route: 'straight', fromSide: 'right', toSide: 'left',
    label: 'replicate the transaction journal with retries and ownership checks',
    labelDx: 1000, labelDy: 150,
  });
  doc.meta.quality_profile = 'showcase';
  doc.boundaries[0].label = 'Disaster recovery ownership boundary';
  doc.boundaries.forEach((boundary) => { boundary.pad = 8; });
  const svg = render(doc);
  const width = Number(svg.match(/viewBox="0 0 ([\d.]+) [\d.]+"/)[1]);
  const mask = svg.match(/<g data-detail="context"[^>]*>\s*<rect x="([\d.-]+)"[^>]*width="([\d.]+)"/);
  assert.ok(mask, 'expected the boundary connection label mask');
  const labelRight = Number(mask[1]) + Number(mask[2]);
  const componentRight = Math.max(...doc.components.map(({ pos, size }) => pos[0] + size[0]));
  assert.ok(labelRight > componentRight, 'the connection label must enlarge the component-derived canvas');
  assert.ok(labelRight <= width, `label right edge ${labelRight} exceeds the ${width}px canvas`);
  const minimumFontSize = minimumReadableSourceTextPx(width);
  const fonts = [...svg.matchAll(/data-boundary-label=""[^>]*font-size="([\d.]+)"/g)]
    .map(([, fontSize]) => Number(fontSize));
  assert.equal(fonts.length, 2);
  assert.ok(fonts.every((fontSize) => fontSize + 1e-6 >= minimumFontSize),
    `boundary title fonts ${fonts} are below the ${minimumFontSize}px floor`);
  const source = frameRect(svg, doc.boundaries[0].label);
  const target = frameRect(svg, doc.boundaries[1].label);
  const points = connectionPoints(svg);
  assert.ok(source.width > doc.components[0].size[0] + doc.boundaries[0].pad * 2,
    'the long title must expand its frame beyond the padded component');
  assert.deepEqual(points[0], [source.x + source.width, source.y + source.height / 2]);
  assert.deepEqual(points.at(-1), [target.x, target.y + target.height / 2]);
  const layout = inspect(doc);
  assert.deepEqual(layout.connections[0].points, points);
  assert.deepEqual(layout.labels[0].labelAt, [
    Math.round((points[0][0] + points.at(-1)[0]) / 2 + doc.connections[0].labelDx),
    Math.round(points[0][1] - 10 + doc.connections[0].labelDy),
  ]);

  doc.meta.viewBox = [1000, 500];
  const pinned = run(doc, 'validate');
  assert.notEqual(pinned.status, 0);
  const diagnostic = JSON.parse(pinned.stdout).diagnostics
    .find(({ code }) => code === 'composition/label-canvas-containment');
  assert.ok(diagnostic, pinned.stdout);
  assert.ok(diagnostic.supportedFixes.length > 0);
});

for (const [name, sides] of [
  ['automatic sides', {}],
  ['authored top-to-bottom sides', { fromSide: 'top', toSide: 'bottom' }],
]) {
  test(`architecture: offset boundary endpoints validate with ${name}`, () => {
    const doc = {
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'Boundary endpoint auto side-inference repro', output: 'boundary-inference.html', quality_profile: 'standard' },
      components: [
        { id: 'top_a', type: 'backend', label: 'Top A', pos: [330, 40], size: [160, 60] },
        { id: 'top_b', type: 'backend', label: 'Top B', pos: [730, 40], size: [160, 60] },
        { id: 'bottom_leaf', type: 'database', label: 'Bottom Leaf', pos: [40, 150], size: [400, 60] },
      ],
      boundaries: [
        { id: 'top-zone', kind: 'region', label: 'Top Zone', wraps: ['top_a', 'top_b'], pad: 18 },
        { id: 'bottom-zone', kind: 'region', label: 'Bottom Zone', wraps: ['bottom_leaf'], pad: 18 },
      ],
      connections: [{ from: 'bottom-zone', to: 'top-zone', ...sides }],
    };
    const layout = inspect(doc);
    assert.equal(layout.ok, true);
    assert.deepEqual(layout.components.map(({ pos }) => pos), doc.components.map(({ pos }) => pos));
    assert.deepEqual(layout.components.map(({ width, height }) => [width, height]),
      doc.components.map(({ size }) => size));
    assert.deepEqual(layout.connections.map(({ from, to }) => [from, to]), [['bottom-zone', 'top-zone']]);
    const svg = render(doc);
    const points = connectionPoints(svg, null);
    assertFrameEndpoint(points, frameRect(svg, 'Bottom Zone'), 'source', sides.fromSide);
    assertFrameEndpoint(points, frameRect(svg, 'Top Zone'), 'target', sides.toSide);
    assert.deepEqual(layout.connections[0].points, points);
  });
}

test('architecture: boundary fan-out keeps distinct stable ports clear of frame corners', () => {
  const doc = diagram();
  doc.components[0].pos = [320, 140];
  doc.components[1].pos = [140, 540];
  doc.components.push({ id: 'third', type: 'backend', label: 'Third', pos: [500, 540], size: [120, 60] });
  doc.boundaries.push({ id: 'third-scope', kind: 'region', label: 'Third scope', wraps: ['third'], pad: 24 });
  doc.connections.push({ id: 'branch', from: 'left-scope', to: 'third-scope' });
  const svg = render(doc);
  const source = frameRect(svg, 'Left scope');
  const starts = doc.connections.map(({ id }) => connectionPoints(svg, id)[0]);
  assert.notDeepEqual(starts[0], starts[1], 'shared boundary ports must remain distinct');
  for (const { id } of doc.connections) {
    const points = connectionPoints(svg, id);
    const side = assertFrameEndpoint(points, source, 'source');
    const [x, y] = points[0];
    assert.ok(side === 'top' || side === 'bottom'
      ? x >= source.x + 16 && x <= source.x + source.width - 16
      : y >= source.y + 16 && y <= source.y + source.height - 16,
    'ports must clear the corners');
  }
  doc.connections.reverse();
  const reversed = render(doc);
  for (const { id } of doc.connections) {
    assert.deepEqual(connectionPoints(reversed, id)[0], connectionPoints(svg, id)[0]);
  }
});

test('architecture: naming an unrelated boundary does not make its frame a routing obstacle', () => {
  const doc = diagram();
  doc.components[0].pos = [120, 94];
  doc.components[1].pos = [620, 300];
  doc.components.push({ id: 'neighbor', type: 'backend', label: 'X', pos: [430, 220], size: [40, 60] });
  doc.boundaries.push({ kind: 'region', label: 'Unrelated scope', wraps: ['neighbor'], pad: 100 });
  const anonymous = render(doc);
  doc.boundaries[2].id = 'unrelated-scope';
  const named = render(doc);
  const frame = frameRect(named, 'Unrelated scope');
  const points = connectionPoints(named);
  assert.ok(points.slice(1).some(([x, y], index) => {
    const [previousX, previousY] = points[index];
    return x === previousX
      ? x > frame.x && x < frame.x + frame.width
        && Math.max(y, previousY) > frame.y && Math.min(y, previousY) < frame.y + frame.height
      : y === previousY && y > frame.y && y < frame.y + frame.height
        && Math.max(x, previousX) > frame.x && Math.min(x, previousX) < frame.x + frame.width;
  }), 'the route must exercise the unrelated frame interior');
  assert.deepEqual(connectionPoints(named), connectionPoints(anonymous));
});
