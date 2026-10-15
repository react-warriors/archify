import { createHash } from 'node:crypto';
import { compile } from './compile.mjs';
import { scan } from './scan.mjs';
import { fill, verify } from './fill.mjs';
import { plan } from './relation.mjs';
import { relocateHTML } from './html-source.mjs';

/** 标题划分内容范围，无标题的正文也保留。 */
export function sectionsOf(blocks, level) {
  const levelOf = (b) => Number((b.html.match(/^<h([1-6])/) || [])[1]) || 0;
  const levels = blocks.map(levelOf).filter((n) => n > 1);
  level ??= levels.length ? Math.min(...levels) : 1;
  const result = [];
  for (const b of blocks) {
    if (levelOf(b) === level || !result.length) result.push({ id: levelOf(b) === level ? b.id : null, blocks: [] });
    result[result.length - 1].blocks.push(b);
  }
  return result;
}

/** load(html, { scripts }) 加载独立页面；run 在页面中求值并返回结果。 */
export async function render(io, pageHtml, md, options = {}) {
  const compiled = compile(md);
  if (new Set(compiled.blocks.map((b) => b.id)).size !== compiled.blocks.length) {
    return { html: null, report: { ok: false, unmet: [{ code: 'document/source-identity-duplicate' }] }, sections: 0 };
  }
  const design = options.designURL ? (await relocateHTML(io, pageHtml, options.designURL)).html : pageHtml;
  const place = await scan(io, design, { contentSelector: options.contentSelector, excludeSelector: options.excludeSelector });
  if (!place.ok) return { html: null, report: place, sections: 0 };
  const requirements = plan(compiled, place.actions);
  if (!requirements.ok) return { html: null, report: requirements, sections: 0 };
  const generated = new Set(compiled.derived.map((rec) => rec.id));
  const blocks = compiled.blocks.map((b) => ({ id: b.id, construct: b.construct, html: b.html,
    headingId: generated.has(b.id) ? undefined : b.id }));
  const level = place.level && blocks.some((b) => b.html.startsWith('<h' + place.level + ' ')) ? place.level : undefined;
  const sections = sectionsOf(blocks, level);
  const introduction = place.mode === 'repeat' && place.preamble.length && sections[0]?.id === null ? sections.shift() : null;
  const marker = 'data-render-' + createHash('sha256').update(pageHtml + String(md)).digest('hex').slice(0, 16);
  const output = await fill(io, { place, blocks, sections, introduction, marker,
    sourceURL: options.sourceURL, designURL: options.designURL, title: options.title, designOptions: options.designOptions });
  if (!output.ok) return { html: null, report: output, sections: sections.length };
  await io.load(output.validationHtml, { scripts: true });
  const execution = await verify(io, { marker, expected: output.expected });
  const declarations = await io.run(`(() => {
    try {
      const entries = [...document.querySelectorAll('script[type="application/json"][data-document-diagnostics]')].flatMap(node => {
        const rows = JSON.parse(node.textContent);
        if (!Array.isArray(rows) || rows.some(row => !row || typeof row.code !== 'string' || typeof row.message !== 'string' || !['warning','error'].includes(row.severity))) throw Error('Invalid design diagnostics');
        return rows;
      });
      return {entries};
    } catch (error) { return {entries:[{code:'document/design-diagnostics-invalid',severity:'error',message:error.message}]}; }
  })()`);
  const unmet = [...execution.unmet, ...declarations.entries.filter(row => row.severity === 'error'), ...(io.errors ? await io.errors() : []).map((message) => ({ code: 'document/runtime-error', message }))];
  const report = { ok: unmet.length === 0, mode: output.mode, units: output.units, toc: output.toc,
    ...(options.designOptions === undefined ? {} : { designOptionsApplied: output.optionsApplied }),
    requirements: requirements.rows, warnings: declarations.entries.filter(row => row.severity === 'warning'), unmet };
  return { html: report.ok ? output.html : null, report, sections: sections.length };
}
