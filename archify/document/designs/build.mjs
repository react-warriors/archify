import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const css = ['report.css', 'content-graphs.css', 'purpose-layouts.css'].map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n');
const js = ['report.js', 'content-graphs.js'].map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('\n');
const designs = [
  { name: 'decision', title: '决策简报', label: 'DECISION BRIEF', rail: false },
  { name: 'analysis', title: '分析札记', label: 'ANALYSIS NOTES', rail: true },
  { name: 'review', title: '进展复盘', label: 'RETROSPECTIVE', rail: false },
];
const mark = fs.readFileSync(new URL('../../../docs/assets/archify-lockup-light.svg', import.meta.url), 'utf8').replaceAll('#111827', 'currentColor').replace('id="title"', '').replace('role="img" aria-labelledby="title"', 'aria-hidden="true"');
const controls = '<div class="tools"><span class="tool-label">阅读 / 汇报</span><button class="tool" data-action="appearance" aria-label="切换深浅配色" title="切换深浅配色"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/></svg></button><button class="tool" data-action="print" aria-label="打印或保存 PDF" title="打印或保存 PDF"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7ZM16 11h1"/></svg></button></div>';
const navigation = '<nav class="section-nav" aria-label="章节">' + [1, 2, 3].map((n) => `<a href="#chapter-${n}"><span class="nav-number" aria-hidden="true">0${n}</span><span>章节${n}</span></a>`).join('') + '</nav>';
const chapters = '<div class="chapters">' + [1, 2, 3].map((n) => `<section class="chapter"><header class="chapter-header"><span class="chapter-index" aria-hidden="true">0${n}</span><h2 id="chapter-${n}">章节${n}</h2></header><div class="chapter-body"><p>章节内容</p></div></section>`).join('\n') + '</div>';
for (const design of designs) {
  const report = `<main class="report"><header class="hero"><div class="eyebrow">${design.label} / ${design.title}</div><h1>文档标题</h1><p class="lede">文档引言</p>${design.name === 'review' ? '<div class="review-cues" aria-hidden="true"><span>回顾结果</span><span>核对偏差</span><span>跟进改进</span></div>' : ''}</header>${design.rail ? '' : navigation}${chapters}</main>`;
  const body = design.rail ? `<div class="reading-layout"><aside class="rail"><div class="rail-label">IN THIS DOCUMENT</div>${navigation}</aside>${report}</div>` : report;
  const html = `<!doctype html>\n<html lang="zh" class="${design.name}" data-report="${design.name}" data-appearance="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${design.title}</title><style>\n${css}\n</style></head><body><header class="toolbar"><div class="brand" role="img" aria-label="Archify">${mark}<span class="brand-label">DOCUMENT</span></div>${controls}</header>${body}<footer class="footer"><span>${design.label}</span><span>${design.name === 'review' ? '结果 · 差异 · 改进' : '观点 · 证据 · 下一步'}</span></footer><script>\n${js}\n</script></body></html>\n`;
  const output = path.join(directory, design.name + '.html');
  const normalized = html.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '');
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8').replace(/\r\n/g, '\n') !== normalized) {
      console.error(design.name + '.html is stale; run node archify/document/designs/build.mjs.');
      process.exitCode = 1;
    }
  } else fs.writeFileSync(output, normalized);
}
if (!process.exitCode) console.log(process.argv.includes('--check') ? 'Document report HTML is current.' : 'Built decision.html, analysis.html and review.html.');
