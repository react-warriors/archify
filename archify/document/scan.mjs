import { inPage } from './dom.mjs';

// 只读取内容位置、包装结构和导航关系。
function readPage(dom, options = {}) {
  const { heading, pathOf, commonParent, levelOf, fail, excluded, slotsIn } = dom;
  let ignored = [];
  if (options?.excludeSelector) {
    try { ignored = [...document.querySelectorAll(options.excludeSelector)]; }
    catch { return fail('document/exclude-selector-invalid', { selector: options.excludeSelector }); }
  }
  const ignore = (node) => ignored.some((region) => region === node || region.contains(node));
  const roots = [...document.querySelectorAll('main,[role="main"]')].filter((el) => !excluded(el));
  const articles = [...document.querySelectorAll('article')].filter((el) => !excluded(el));
  let root = roots.length === 1 ? roots[0] : roots.length ? commonParent(roots)
    : articles.length === 1 ? articles[0] : document.body;
  if (options?.contentSelector) {
    let selected;
    try { selected = document.querySelectorAll(options.contentSelector); }
    catch { return fail('document/content-selector-invalid', { selector: options.contentSelector }); }
    if (selected.length !== 1) return fail('document/content-selector-ambiguous', { selector: options.contentSelector, matches: selected.length });
    root = selected[0];
  }
  if (ignore(root)) return fail('document/content-root-excluded');
  const slots = slotsIn(root, ignore);
  const crossing = slots.filter(node => ignored.some(region => node.contains(region)));
  if (crossing.length) return fail('document/exclusion-crosses-content', {
    paths: crossing.map(node => pathOf(node)),
    excluded: ignored.filter(region => crossing.some(node => node.contains(region))).map(node => pathOf(node)),
  });
  const candidates = [];
  for (const h of slots.filter((el) => levelOf(el))) {
    if (h === root) continue;
    for (let el = h.parentElement; el && el !== root; el = el.parentElement) {
      if (!el.matches('section,article,div')) continue;
      const local = slotsIn(el, ignore);
      const heads = local.filter((node) => levelOf(node));
      const level = Math.min(...heads.map(levelOf));
      if (level !== levelOf(h) || heads.filter((node) => levelOf(node) === level).length !== 1) continue;
      if (!local.some((node) => !levelOf(node) && (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))) continue;
      candidates.push({ el, level });
      break;
    }
  }
  const outer = candidates.filter(({ el }) => !candidates.some((other) => other.el !== el && other.el.contains(el)));
  const levels = [...new Set(outer.map((rec) => rec.level))];
  const level = levels.length ? Math.min(...levels) : 0;
  const units = outer.filter((rec) => rec.level === level).map((rec) => rec.el);
  const repeat = units.length > 1 || units[0]?.matches('section,article');
  const outside = repeat ? slots.filter((el) => !units.some((unit) => unit.contains(el))) : [];
  const preamble = outside.filter((el) => !!(el.compareDocumentPosition(units[0]) & Node.DOCUMENT_POSITION_FOLLOWING));
  if (repeat && outside.length !== preamble.length) return fail('document/unmapped-content-region', {
    paths: outside.filter((el) => !preamble.includes(el)).map((el) => pathOf(el)),
  });

  const tocGroups = new Map();
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    const target = document.getElementById(a.getAttribute('href').slice(1));
    const h = target?.matches(heading) ? target : target?.querySelector(heading);
    if (!h || !root.contains(h)) continue;
    const box = a.closest('nav,aside,[role="navigation"]');
    if (box) tocGroups.set(box, [...(tocGroups.get(box) || []), { a, h }]);
  }
  const tocs = [...tocGroups].map(([box, links]) => ({ path: pathOf(box),
    links: links.map(({ a, h }) => ({ path: pathOf(a), level: levelOf(h), label: h.textContent.trim() })),
  }));
  return { ok: true, mode: repeat ? 'repeat' : 'flat', level: repeat ? level : 0,
    root: pathOf(root), units: repeat ? units.map((el) => pathOf(el)) : [],
    preamble: preamble.map((el) => pathOf(el)), slots: slots.map((el) => pathOf(el)),
    tocs, actions: tocs.length ? ['toc'] : [], snapshot: root.outerHTML, excludeSelector: options?.excludeSelector,
  };
}

export const SCAN = inPage(readPage);

export function scanFixes(code) {
  if (code === 'document/exclusion-crosses-content')
    return ['move excluded controls outside replaceable content blocks, or exclude their entire containing block'];
  return ['select one content root with content_selector and preserve unrelated regions with exclude_selector'];
}

export async function scan(io, html, options = {}) {
  await io.load(html, { scripts: false });
  return io.run(options.contentSelector || options.excludeSelector ? inPage(readPage, options) : SCAN);
}
