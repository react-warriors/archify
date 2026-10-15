import { inPage } from './dom.mjs';

function fillPage(dom, request) {
  const { pathOf, atPath, commonParent, levelOf, roleOf, textOf, resourcesOf, fail, slotsIn } = dom;
  const { place, blocks, sections, introduction, marker, sourceURL, designURL } = request;
  const root = atPath(place.root);
  if (!root || root.outerHTML !== place.snapshot) return fail('document/design-changed');
  const units = place.units.map((path) => atPath(path));
  const ignored = new WeakSet(place.excludeSelector ? document.querySelectorAll(place.excludeSelector) : []);
  const ignore = (node) => { for (let parent = node; parent; parent = parent.parentElement) if (ignored.has(parent)) return true; return false; };
  const preamble = place.preamble.map((path) => atPath(path));
  const navigation = place.tocs.map((rec) => ({ el: atPath(rec.path), links: rec.links.map((link) => ({ ...link, el: atPath(link.path) })) }));
  const expected = [];
  const headings = [];
  const references = new Map();
  const markdownTargets = new Map(), headingCounts = new Map();
  const freshId = (id) => {
    let value = id, n = 1;
    while (document.getElementById(value)) value = id + '-' + ++n;
    return value;
  };

  const makeBlock = (b, prototype, reused) => {
    const template = document.createElement('template'); template.innerHTML = b.html;
    const el = template.content.firstElementChild;
    if (!el) return null;
    for (const node of [el, ...el.querySelectorAll('[data-src]')]) node.removeAttribute('data-src');
    if (b.construct === 'table') for (const cell of el.querySelectorAll('[data-cell]')) cell.removeAttribute('data-cell');
    if (sourceURL) for (const node of [el, ...el.querySelectorAll('[href],[src]')]) for (const attr of ['href', 'src']) {
      const value = node.getAttribute(attr);
      if (value && !value.startsWith('#')) {
        try { node.setAttribute(attr, new URL(value, sourceURL).href); } catch {}
      }
    }
    if (prototype && roleOf(el) === roleOf(prototype)) {
      for (const attr of prototype.attributes) {
        if (attr.name === marker || (attr.name === 'id' && !reused)) continue;
        if (!el.hasAttribute(attr.name)) el.setAttribute(attr.name, attr.value);
      }
      for (const child of el.querySelectorAll('*')) {
        const old = atPath(pathOf(child, el), prototype);
        if (old?.tagName === child.tagName) for (const attr of ['class', 'style']) {
          if (old.hasAttribute(attr) && !child.hasAttribute(attr)) child.setAttribute(attr, old.getAttribute(attr));
        }
      }
    }
    const key = b.id;
    el.setAttribute(marker, key);
    expected.push({ key, id: b.id, text: textOf(el), resources: resourcesOf(el) });
    if (levelOf(el)) {
      const oldId = reused?.id;
      if (b.headingId) el.id = b.headingId;
      if (!el.id) el.id = freshId(b.id);
      const anchor = el.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
      const count = headingCounts.get(anchor) || 0; headingCounts.set(anchor, count + 1);
      markdownTargets.set(anchor + (count ? '-' + count : ''), el.id);
      if (b.headingId) markdownTargets.set(b.headingId, el.id);
      if (oldId && oldId !== el.id) references.set(oldId, el.id);
      const inheritedHeading = headings.find((rec) => rec.el === prototype);
      const designLevel = inheritedHeading
        ? levelOf(prototype) === levelOf(el) ? inheritedHeading.designLevel : levelOf(el)
        : levelOf(prototype) || levelOf(el);
      headings.push({ el, designLevel, authoredId: b.headingId });
    }
    return el;
  };

  // 标题划分正文范围；额外正文留在该范围原有的包装中。
  const fillBlocks = (old, incoming, container) => {
    if (!old.includes(container) && !incoming.some((b) => /^<h[1-6]\b/.test(b.html))) {
      for (const el of old.filter((el) => levelOf(el))) el.remove();
      old = old.filter((el) => !levelOf(el));
    }
    let cursor = 0, previous = null;
    let local = [];
    for (const b of incoming) {
      const isHeading = /^<h[1-6]\b/.test(b.html);
      if (isHeading) {
        const headingAt = old.findIndex((el, i) => i >= cursor && levelOf(el));
        if (headingAt >= 0) while (cursor < headingAt) old[cursor++].remove();
        const next = old.findIndex((el, i) => i > cursor && levelOf(el));
        local = old.slice(cursor + 1, next < 0 ? undefined : next);
      }
      const reused = cursor < old.length && (!!levelOf(old[cursor]) === isHeading) ? old[cursor++] : null;
      const template = document.createElement('template'); template.innerHTML = b.html;
      const role = roleOf(template.content.firstElementChild);
      const prototype = reused || [...local].reverse().find((el) => roleOf(el) === role) || (previous && roleOf(previous) === role ? previous : null);
      const el = makeBlock(b, prototype, reused);
      if (!el) continue;
      if (reused) reused.replaceWith(el);
      else if (isHeading && old[cursor]?.isConnected) old[cursor].before(el);
      else if (previous) previous.after(el);
      else if (old[cursor]?.isConnected) old[cursor].before(el);
      else container.append(el);
      previous = el;
    }
    for (const el of old.slice(cursor)) el.remove();
  };

  if (place.mode === 'flat') fillBlocks(place.slots.map((path) => atPath(path)), blocks, root);
  else {
    const sample = units[units.length - 1].cloneNode(true);
    const sampleIgnored = [...units[units.length - 1].querySelectorAll('*')].filter((node) => ignored.has(node)).map((node) => pathOf(node, units[units.length - 1]));
    let last = units[units.length - 1];
    for (let i = 0; i < sections.length; i++) {
      let unit = units[i];
      if (!unit) {
        unit = sample.cloneNode(true);
        for (const path of sampleIgnored) ignored.add(atPath(path, unit));
        const ids = new Map();
        for (const el of [unit, ...unit.querySelectorAll('[id]')]) if (el.id) {
          const oldId = el.id; el.id = freshId(oldId + '-' + (i + 1)); ids.set(oldId, el.id);
        }
        for (const el of [unit, ...unit.querySelectorAll('*')]) for (const attr of ['href', 'for', 'aria-labelledby', 'aria-describedby', 'aria-controls']) {
          const value = el.getAttribute(attr);
          if (value) el.setAttribute(attr, value.split(/\s+/).map((id) => id.startsWith('#') ? '#' + (ids.get(id.slice(1)) || id.slice(1)) : ids.get(id) || id).join(' '));
        }
        last.after(unit); last = unit;
      }
      fillBlocks(slotsIn(unit, ignore), sections[i].blocks, unit);
    }
    for (const unit of units.slice(sections.length)) unit.remove();
    fillBlocks(preamble, introduction?.blocks || [], root);
  }
  for (const block of document.querySelectorAll('[' + marker + ']')) for (const a of block.querySelectorAll('a[href^="#"]')) {
    const fragment = a.getAttribute('href').slice(1);
    let target = markdownTargets.get(fragment);
    if (!target) { try { target = markdownTargets.get(decodeURIComponent(fragment)); } catch {} }
    if (target) a.setAttribute('href', '#' + target);
  }
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    const id = references.get(a.getAttribute('href').slice(1));
    if (id) a.setAttribute('href', '#' + id);
  }

  // 导航条目由原链接指向的标题范围决定，其他链接保持原样。
  let tocCount = 0;
  for (const { el: box, links } of navigation) {
    if (!box?.isConnected || !links.length) continue;
    const holder = commonParent(links.map((rec) => rec.el));
    const itemOf = (a) => { let el = a; while (el.parentElement !== holder) el = el.parentElement; return el; };
    const items = [...new Set(links.map((rec) => itemOf(rec.el)))];
    const entries = headings.filter((rec) => links.some((link) => link.level === rec.designLevel));
    let previous = null;
    for (const entry of entries) {
      const rec = links.find((link) => link.level === entry.designLevel) || links[0];
      const sample = itemOf(rec.el);
      const node = sample.cloneNode(true);
      const a = atPath(pathOf(rec.el, sample), node);
      // 克隆当前条目时，移除其他章节的嵌套目录条目。
      const obsolete = links.filter((link) => link !== rec && sample.contains(link.el))
        .map((link) => atPath(pathOf(link.el, sample), node));
      for (const link of obsolete) {
        const item = link.closest('li');
        if (item && node.contains(item) && !item.contains(a)) item.remove();
        else link.remove();
      }
      for (const list of [...node.querySelectorAll('ul,ol')].reverse()) if (!list.children.length) list.remove();
      for (const el of [node, ...node.querySelectorAll('[id]')]) el.removeAttribute('id');
      a.setAttribute('href', '#' + entry.el.id);
      const walker = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
      let label = null;
      while (walker.nextNode()) if (walker.currentNode.textContent.trim() === rec.label) { label = walker.currentNode; break; }
      if (label) label.textContent = entry.el.textContent; else a.textContent = entry.el.textContent;
      if (previous) previous.after(node); else items[0].before(node);
      previous = node; tocCount++;
    }
    for (const node of items) node.remove();
  }

  const title = headings.find((rec) => levelOf(rec.el) === 1);
  if (title) document.title = title.el.textContent.trim();
  else if (request.title) document.title = request.title;
  // 调用参数只写入模板声明的 JSON 配置节点。
  let optionsApplied = false;
  if (request.designOptions !== undefined) for (const entry of document.querySelectorAll('script[type="application/json"][data-document-options]')) {
    let defaults;
    try { defaults = JSON.parse(entry.textContent); }
    catch { return fail('document/design-options-invalid', { reason: 'The declared configuration is not valid JSON.' }); }
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) return fail('document/design-options-invalid', { reason: 'The declared configuration must be a JSON object.' });
    entry.textContent = JSON.stringify({ ...defaults, ...request.designOptions }).replaceAll('<', '\\u003c');
    optionsApplied = true;
  }
  const base = designURL || document.baseURI;
  for (const el of document.querySelectorAll('link[href],script[src],img[src],audio[src],video[src],source[src],iframe[src],object[data]')) {
    for (const attr of ['href', 'src', 'data']) if (el.hasAttribute(attr)) {
      try { el.setAttribute(attr, new URL(el.getAttribute(attr), base).href); } catch {}
    }
  }
  const byKey = new Map(expected.map((rec) => [rec.key, rec]));
  for (const el of document.querySelectorAll('[' + marker + ']')) {
    const record = byKey.get(el.getAttribute(marker));
    record.path = pathOf(el); record.resources = resourcesOf(el);
  }
  const copy = document.documentElement.cloneNode(true);
  for (const el of copy.querySelectorAll('[' + marker + ']')) el.removeAttribute(marker);
  const placed = new Set(expected.map((rec) => rec.id));
  const missing = blocks.filter((b) => !placed.has(b.id)).map((b) => b.id);
  const ids = new Map(); for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) || 0) + 1);
  const conflicts = headings.filter(rec => rec.authoredId && ids.get(rec.authoredId) > 1).map(rec => ({code:'document/heading-id-conflict',id:rec.authoredId}));
  return { ok: missing.length === 0 && conflicts.length === 0, mode: place.mode, units: place.mode === 'flat' ? 1 : sections.length,
    toc: tocCount, optionsApplied, expected, html: '<!doctype html>\n' + copy.outerHTML,
    validationHtml: '<!doctype html>\n' + document.documentElement.outerHTML,
    unmet: [...missing.map((id) => ({ code: 'document/source-not-placed', id })), ...conflicts] };
}

function verifyPage(dom, request) {
  const { textOf, resourcesOf, atPath } = dom;
  const nodes = new Map([...document.querySelectorAll('[' + request.marker + ']')].map((el) => [el.getAttribute(request.marker), el]));
  const unmet = request.expected.flatMap(({ key, id, text, resources, path }) => {
    const node = nodes.get(key) || atPath(path);
    const actual = node ? textOf(node) : null;
    if (actual !== text) return [{ code: 'document/runtime-content-changed', id, expected: text.slice(0, 160), actual: actual?.slice(0, 160) ?? null }];
    const actualResources = resourcesOf(node).map(value => JSON.stringify(value));
    const preserved = resources.every(value => {
      const index = actualResources.indexOf(JSON.stringify(value));
      if (index < 0) return false;
      actualResources.splice(index, 1); return true;
    });
    return preserved ? [] : [{code:'document/runtime-resource-changed',id}];
  });
  return { ok: unmet.length === 0, unmet };
}

export function fill(io, request) {
  return io.run(inPage(fillPage, request));
}

export function verify(io, request) {
  return io.run(inPage(verifyPage, request));
}
