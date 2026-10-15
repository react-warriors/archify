import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compile } from '../archify/document/compile.mjs';
import { render, sectionsOf } from '../archify/document/render.mjs';
import { scan } from '../archify/document/scan.mjs';
import { fill } from '../archify/document/fill.mjs';
import { plan } from '../archify/document/relation.mjs';
import { resolve } from '../archify/document/resolve.mjs';
import { documentBrowser } from '../archify/document/browser.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';
import { findChrome } from '../archify/bin/visual-check.mjs';

test('section grouping retains introductions and documents without second-level headings', () => {
  for (const source of ['正文，没有标题。', '# 标题\n\n前言\n\n### 一节\n\n正文', '# 标题\n\n前言\n\n## 一节\n\n正文']) {
    const compiled = compile(source);
    const grouped = sectionsOf(compiled.blocks);
    const ids = grouped.flatMap((s) => s.blocks.map((b) => b.id));
    assert.deepEqual(ids, compiled.blocks.map((b) => b.id));
  }
});

test('navigation accepts documents without headings and reports missing or unknown inputs', () => {
  assert.equal(plan(compile('正文'), ['toc']).ok, true);
  assert.equal(plan(compile(''), ['toc']).ok, true);
  assert.deepEqual(plan({}, ['toc']).unmet[0].missing, ['blocks']);
  assert.equal(plan(compile('正文'), ['unknown']).unmet[0].code, 'document/action-inputs-unknown');
});

test('inline anchors count decoded text once and keep nested offsets in the owning block', () => {
  const source = '前&amp;中\\*后\n尾 [链*甲*](https://example.com)。';
  const compiled = compile(source);
  const [id, entry] = Object.entries(compiled.map)[0];
  for (const [at, expected] of [[1, '&amp;'], [3, '\\*'], [5, '\n']]) {
    const range = resolve(compiled.map, { src: id, at, len: 1 });
    assert.equal(source.slice(range.start, range.end), expected);
  }
  const emphasis = entry.inline.find((a) => a.construct === 'emph');
  assert.equal(emphasis.at, 9);
  assert.equal(source.slice(emphasis.start, emphasis.end), '*甲*');
});

test('source ranges retain original CRLF offsets', () => {
  const source = '# 标题\r\n\r\n前&amp;中\r\n后。';
  const compiled = compile(source);
  const block = compiled.blocks.find((b) => b.construct === 'paragraph');
  assert.equal(source.slice(block.start, block.end), '前&amp;中\r\n后。');
  for (const [at, expected] of [[1, '&amp;'], [3, '\r\n'], [4, '后']]) {
    const range = resolve(compiled.map, { src: block.id, at, len: 1 });
    assert.equal(source.slice(range.start, range.end), expected);
  }
});

test('table and heading inline ranges belong to their actual source blocks', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = ['#   *Title*', '', '  **Section**', '=======', '', '| a | **b** |', '| - | - |', '| 1 | *c* |'].join(newline);
    const compiled = compile(source);
    const [heading, setext, table] = compiled.blocks;
    for (const [block, expected] of [[heading, '*Title*'], [setext, '**Section**']]) {
      const range = resolve(compiled.map, {src:block.id, at:0});
      assert.equal(source.slice(range.start, range.end), expected);
      assert.equal(compiled.map[block.id].inline.length, 1);
    }
    const anchors = compiled.map[table.id].inline;
    assert.deepEqual(anchors.map(anchor => source.slice(anchor.start, anchor.end)), ['**b**', '*c*']);
    for (const anchor of anchors) assert.ok(anchor.start >= table.start && anchor.end <= table.end);
    const range = resolve(compiled.map, {src:table.id, cell:[0,1]});
    assert.equal(source.slice(range.start, range.end), '**b**');
  }
});

test('trailing text after nested inline constructs resolves to its source character', () => {
  for (const [source, at] of [['[a*b*](u)c',2], ['*a **b** d*e',5], ['[**a**](u)[b*c*](v)d',3]]) {
    const compiled = compile(source);
    const range = resolve(compiled.map, {src:compiled.blocks[0].id, at});
    assert.equal(source.slice(range.start, range.end), source.at(-1));
    assert.equal(range.start, source.length - 1);
  }
});

test('HTML input renders through its own DOM in Chrome', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-html-render-'));
  const file = path.join(directory, 'design.html');
  fs.writeFileSync(file, '<!doctype html><body></body>');
  const browser = desktopBrowser(findChrome());
  t.after(async () => {
    await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const io = await documentBrowser(browser, file);
  const panel = (name, level = 2) => `<section class="panel"><header class="panel-head"><h${level} id="${name}">${name}</h${level}></header><div class="panel-body"><p class="copy">示例正文 ${name}</p></div></section>`;
  const page = (body) => `<!doctype html><html><head><style>.panel-body{padding:13px}.copy{color:rgb(12,34,56)}</style></head><body>${body}<script>window.designScript=true</script></body></html>`;

  await t.test('scanning preserves the page and stale positions are rejected before filling', async () => {
    const design = page('<main><p class="copy">旧正文</p></main>');
    await io.load(design, { scripts: false });
    const before = await io.run('document.documentElement.outerHTML');
    const place = await scan(io, design);
    assert.equal(place.ok, true);
    assert.equal(await io.run('document.documentElement.outerHTML'), before);
    await io.run('document.querySelector("main p").textContent="编辑后的正文"');
    const result = await fill(io, { place });
    assert.equal(result.ok, false);
    assert.equal(result.unmet[0].code, 'document/design-changed');
    assert.equal(await io.run('document.querySelector("main p").textContent'), '编辑后的正文');
  });

  await t.test('flat prose retains the design and does not add annotation data', async () => {
    const source = '新正文 &amp; **强调**。';
    const result = await render(io, page('<main><article><p class="copy">旧正文</p></article></main>'), source);
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.doesNotMatch(result.html, /arc-source|arc-map|arc-derived|arc-untouchable|data-src=|data-render-/);
    assert.match(result.html, /window.designScript=true/);
    assert.equal(await io.run('document.querySelector("main p").className'), 'copy');
    assert.equal(await io.run('document.querySelectorAll("main > article").length'), 1);
    assert.equal(await io.run('document.querySelector("main").textContent.includes("旧正文")'), false);
  });

  await t.test('a selected content block is replaced without retaining stale or nested copy', async () => {
    for (const content of ['<p id="copy" class="copy">Old copy</p>', '<h2 id="copy">Old copy</h2>', '<blockquote id="copy"><p>Old copy</p></blockquote>']) {
      const result = await render(io, page('<main><p id="fixed">Outside copy</p>' + content + '<p id="tail">Tail copy</p></main>'), 'First paragraph.\n\nSecond paragraph.', {contentSelector:'#copy'});
      assert.equal(result.report.ok, true, JSON.stringify(result.report));
      await io.load(result.html, {scripts:true});
      assert.deepEqual(await io.run('[...document.querySelectorAll("main p")].map(node=>node.textContent)'), ['Outside copy', 'First paragraph.', 'Second paragraph.', 'Tail copy']);
      assert.equal(await io.run('document.querySelector("main").textContent.includes("Old copy")'), false);
      assert.equal(await io.run('document.querySelectorAll("p p").length'), 0);
    }
    const result = await render(io, page('<main><blockquote id="copy"><p id="fixed">Fixed copy</p><p>Old copy</p></blockquote></main>'), 'New copy', {contentSelector:'#copy',excludeSelector:'#fixed'});
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('document.querySelector("#fixed").textContent'), 'Fixed copy');
    assert.equal(await io.run('document.querySelector("#copy").textContent.includes("Old copy")'), false);
  });

  await t.test('raw Markdown script, style and pre blocks survive blank lines and initialization', async () => {
    const source = '<script>\nwindow.rawStarted=true;\n\nwindow.rawFinished=true;\n</script>\n\n<style>\n.raw {\n\ncolor:rgb(12,34,56);\n}\n</style>\n\n<pre>first\n\nsecond</pre>\n\n<!-- note --> trailing\n\nAfter.';
    const result = await render(io, page('<main class="raw"><p>Old copy</p></main>'), source);
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('window.rawStarted && window.rawFinished'), true);
    assert.equal(await io.run('document.querySelector("main pre").textContent'), 'first\n\nsecond');
    assert.equal(await io.run('getComputedStyle(document.querySelector("main")).color'), 'rgb(12, 34, 56)');
    assert.equal(await io.run('document.querySelector("main p").textContent'), 'After.');
    assert.equal(await io.run('document.querySelector("main").textContent.includes("trailing")'), true);
  });

  await t.test('title, introduction and every chapter remain present', async () => {
    const source = '# 新标题\n\n新前言\n\n## 新章一\n\n新正文一\n\n## 新章二\n\n新正文二';
    const result = await render(io, page('<main><header><h1>旧标题</h1></header><div class="intro"><p>旧前言</p></div><div class="panels">' + panel('old1') + panel('old2') + '</div></main>'), source);
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    const text = await io.run('document.querySelector("main").textContent');
    for (const word of ['新标题', '新前言', '新章一', '新正文一', '新章二', '新正文二']) assert.ok(text.includes(word), word);
    assert.equal(await io.run('document.querySelector("main > header h1")?.textContent'), '新标题');
    assert.equal(await io.run('document.querySelector(".intro")?.textContent'), '新前言');
    assert.equal(await io.run('document.querySelectorAll(".panels > .panel").length'), 2);
    assert.equal(await io.run('document.title'), '新标题');
  });

  await t.test('hidden templates and date labels are not inferred as content inputs', async () => {
    const source = '# 新标题\n\n' + ['甲', '乙', '丙'].map((s) => '## ' + s + '\n\n正文').join('\n\n');
    const design = page('<main><h1>旧标题</h1>' + ['甲', '乙'].map((s, i) =>
      `<section id="panel-${i}"><header><time datetime="${i + 2024}-01-01">${i + 2024}</time><h2>旧${s}</h2></header><div><p>旧正文</p></div></section>`).join('') + '</main><textarea hidden># 旧标题\n\n邮件模板</textarea>');
    const result = await render(io, design, source);
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('document.querySelector("textarea").value'), '# 旧标题\n\n邮件模板');
    assert.deepEqual(await io.run('[...document.querySelectorAll("time")].map(e=>({text:e.textContent,date:e.getAttribute("datetime")}))'), [
      { text: '2024', date: '2024-01-01' }, { text: '2025', date: '2025-01-01' }, { text: '2025', date: '2025-01-01' },
    ]);
    assert.equal(await io.run('document.querySelectorAll("main section[id]").length'), 3);
  });

  await t.test('same classes outside the content region remain untouched', async () => {
    const source = '## 新章一\n\n新正文一\n\n## 新章二\n\n新正文二';
    const side = '<aside>' + panel('side1') + panel('side2') + '</aside>';
    await io.load(page(side + '<main>' + panel('old1') + panel('old2') + '</main>'));
    const before = await io.run('document.querySelector("aside").outerHTML');
    const result = await render(io, page(side + '<main>' + panel('old1') + panel('old2') + '</main>'), source);
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('document.querySelector("aside").outerHTML'), before);
  });

  await t.test('added chapters keep order, heading style and complete TOC item wrappers', async () => {
    const source = ['甲', '乙', '丙', '丁'].map((s) => '## ' + s + '\n\n正文' + s).join('\n\n');
    const nav = '<nav><ul><li class="entry"><a href="#old1"><span class="icon">•</span><span>old1</span></a></li><li class="entry"><a href="#old2">old2</a></li></ul></nav>';
    const result = await render(io, page(nav + '<main>' + panel('old1') + panel('old2') + '</main>'), source);
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.deepEqual(await io.run('[...document.querySelectorAll("main .panel h2")].map(e=>e.textContent)'), ['甲', '乙', '丙', '丁']);
    assert.equal(await io.run('document.querySelectorAll("nav ul > li.entry").length'), 4);
    assert.equal(await io.run('[...document.querySelectorAll("nav a")].every(a=>!!document.getElementById(a.hash.slice(1)))'), true);
    assert.equal(await io.run('new Set([...document.querySelectorAll("[id]")].map(e=>e.id)).size === document.querySelectorAll("[id]").length'), true);
  });

  await t.test('flat designs with a TOC and third-level chapter designs both work', async () => {
    const source = '### 甲\n\n正文甲\n\n### 乙\n\n正文乙';
    const nav = '<nav><a href="#old1">old1</a><a href="#old2">old2</a></nav>';
    for (const body of ['<article><h3 id="old1">old1</h3><p>旧一</p><h3 id="old2">old2</h3><p>旧二</p></article>', panel('old1', 3) + panel('old2', 3)]) {
      const result = await render(io, page(nav + '<main>' + body + '</main>'), source);
      assert.equal(result.report.ok, true, JSON.stringify(result.report));
      assert.deepEqual(await io.run('[...document.querySelectorAll("main h3")].map(e=>e.textContent)'), ['甲', '乙']);
      assert.equal(await io.run('[...document.querySelectorAll("nav a")].every(a=>!!document.getElementById(a.hash.slice(1)))'), true);
    }
    const result = await render(io, page('<main>' + panel('old1') + panel('old2') + '</main>'), source);
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('document.querySelectorAll("main section").length'), 2);
  });

  await t.test('nested TOCs drop old child entries while retaining item decoration', async () => {
    const nav = '<nav><ul><li class="entry"><a href="#old1"><span class="icon">•</span><span>old1</span></a><ul><li><a href="#child">child</a></li></ul></li><li><a href="#old2">old2</a></li></ul></nav>';
    const design = page(nav + '<main><section><h2 id="old1">old1</h2><p>旧一</p><h3 id="child">child</h3><p>旧子</p></section>' + panel('old2') + '</main>');
    const result = await render(io, design, '## 新甲\n\n正文甲\n\n## 新乙\n\n正文乙');
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('document.querySelectorAll("nav a").length'), 2);
    assert.equal(await io.run('document.querySelectorAll("nav .icon").length'), 2);
    assert.equal(await io.run('document.querySelector("nav").textContent.includes("child")'), false);
    assert.equal(await io.run('[...document.querySelectorAll("nav a")].every(a=>!!document.getElementById(a.hash.slice(1)))'), true);
  });

  await t.test('footnote blocks are replaced as content and ordinary sidebars stay intact', async () => {
    const design = page('<main><p>旧正文</p><aside class="notes"><aside id="note" role="doc-footnote"><a href="#old">1</a><p>旧脚注</p></aside></aside><aside class="sidebar"><p>侧栏说明</p></aside></main>');
    const result = await render(io, design, '新正文');
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('document.querySelector("main").textContent'), '新正文侧栏说明');
    assert.equal(await io.run('document.querySelector("#note")'), null);
  });

  await t.test('different chapter contents and prose without headings use the existing containers', async () => {
    const mixed = page('<main><section><h2>甲</h2><p>旧正文</p></section><section><h2>乙</h2><ul><li>旧项</li></ul></section></main>');
    const result = await render(io, mixed, '## 新甲\n\n正文甲\n\n## 新乙\n\n- 新项');
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('document.querySelectorAll("main > section").length'), 2);
    const wrapped = page('<main><section><h2>甲</h2><div><p>旧正文</p></div></section><section><h2>乙</h2><div><p>旧正文</p></div></section></main>');
    const prose = await render(io, wrapped, '没有标题的正文');
    assert.equal(prose.report.ok, true, JSON.stringify(prose.report));
    assert.equal(await io.run('document.querySelector("main section div").textContent'), '没有标题的正文');
  });

  await t.test('a chapter starting with a subheading fills its body rather than the title wrapper', async () => {
    const source = '## 新章\n\n### 子节一\n\n正文一\n\n### 子节二\n\n- 条目二';
    const nav = '<nav><a href="#old1">old1</a><a href="#old2">old2</a></nav>';
    const result = await render(io, page(nav + '<main>' + panel('old1') + panel('old2') + '</main>'), source);
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.deepEqual(await io.run('[...document.querySelectorAll(".panel-head h2,.panel-head h3")].map(node=>node.textContent)'), ['新章']);
    assert.deepEqual(await io.run('[...document.querySelectorAll(".panel-body h3")].map(node=>node.textContent)'), ['子节一', '子节二']);
    assert.equal(await io.run('document.querySelector(".panel-body p").textContent'), '正文一');
    assert.equal(await io.run('document.querySelector(".panel-body li").textContent'), '条目二');
    assert.deepEqual(await io.run('[...document.querySelectorAll("nav a")].map(node=>node.textContent)'), ['新章']);
  });

  await t.test('existing computations execute without a component allowlist', async () => {
    const design = '<main><p>旧正文</p><canvas width="1" height="1"></canvas><input type="search"></main><script>document.querySelector("canvas").getContext("2d").fillRect(0,0,1,1);document.querySelector("input").dataset.index=document.querySelector("p").textContent</script>';
    const result = await render(io, design, '新正文');
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('document.querySelector("input").dataset.index'), '新正文');
    assert.equal(await io.run('document.querySelector("canvas").getContext("2d").getImageData(0,0,1,1).data[3]'), 255);
  });

  await t.test('included code highlighting executes after content mapping', async () => {
    const design = '<main><pre><code class="language-js"><span class="token">旧代码</span></code></pre></main><script>window.hljs={highlightElement(el){const token=document.createElement("span");token.className="token";token.textContent=el.textContent;el.replaceChildren(token)}};document.querySelectorAll("pre code").forEach(hljs.highlightElement)</script>';
    const result = await render(io, design, '```js\nconst value = 2;\n```');
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('document.querySelector("pre code .token").textContent'), 'const value = 2;');
  });

  await t.test('runtime content replacement and runtime exceptions are reported', async () => {
    const result = await render(io, '<main><p>旧正文</p></main><script>document.querySelector("main").textContent="旧计算结果"</script>', '新正文');
    assert.equal(result.html, null);
    assert.equal(result.report.unmet[0].code, 'document/runtime-content-changed');
    const thrown = await render(io, '<main><p>旧正文</p></main><script>throw new Error("missing input")</script>', '新正文');
    assert.equal(thrown.html, null);
    assert.equal(thrown.report.unmet[0].code, 'document/runtime-error');
  });

  await t.test('initialization cannot silently change a link destination or image while retaining its label', async () => {
    for (const action of ['document.querySelector("main a").href="https://example.test/wrong"','document.querySelector("main img").alt="Wrong image"']) {
      const result=await render(io,'<main><p>Old</p></main><script>'+action+'</script>','[Reference](https://example.test/source) ![Original image](data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E)');
      assert.equal(result.html,null);assert.equal(result.report.unmet[0].code,'document/runtime-resource-changed');
    }
    const added=await render(io,'<main><p title="Old">Old</p></main><script>const p=document.querySelector("p");p.title="Computed hint";const img=document.createElement("img");img.src="data:image/svg+xml,%3Csvg/%3E";img.alt="Generated badge";p.append(img)</script>','[Reference](https://example.test/source)');
    assert.equal(added.report.ok,true,JSON.stringify(added.report));
  });

  await t.test('an HTML design can return structured warnings and blocking diagnostics', async () => {
    const make=(rows)=>'<main><p>Old</p></main><script type="application/json" data-document-diagnostics>'+JSON.stringify(rows)+'</script>';
    const warning={code:'design/fallback',severity:'warning',message:'The design retained ordinary paragraphs.'};
    const result=await render(io,make([warning]),'New');
    assert.equal(result.report.ok,true);assert.deepEqual(result.report.warnings,[warning]);
    const failure=await render(io,make([{...warning,severity:'error'}]),'New');
    assert.equal(failure.html,null);assert.equal(failure.report.unmet[0].code,'design/fallback');
    const invalid=await render(io,make({code:'bad'}),'New');
    assert.equal(invalid.html,null);assert.equal(invalid.report.unmet[0].code,'document/design-diagnostics-invalid');
  });

  await t.test('Markdown heading links follow inherited HTML IDs, repeated titles and Unicode fragments', async () => {
    const source='# Document\n\n[First](#release-notes) [Second](#release-notes-1) [中文](#%E8%BF%9B%E5%B1%95)\n\n## Release notes\n\nFirst.\n\n## Release notes\n\nSecond.\n\n## 进展\n\n正文。';
    const result=await render(io,page('<main><header><h1>Old</h1><p>Old intro</p></header>'+panel('old1')+panel('old2')+'</main>'),source);
    assert.equal(result.report.ok,true,JSON.stringify(result.report));
    assert.deepEqual(await io.run('[...document.querySelectorAll("main header p a")].map(a=>document.getElementById(a.getAttribute("href").slice(1))?.textContent)'),['Release notes','Release notes','进展']);
    assert.notEqual(await io.run('document.querySelectorAll("main header p a")[0].getAttribute("href")'),await io.run('document.querySelectorAll("main header p a")[1].getAttribute("href")'));
  });

  await t.test('explicit Markdown IDs cannot collide with preserved HTML controls', async () => {
    const result=await render(io,'<button id="settings">Settings</button><main><h2>Old</h2><p>Old</p></main>','## Heading {#settings}\n\nBody');
    assert.equal(result.html,null);assert.equal(result.report.unmet[0].code,'document/heading-id-conflict');
    const reused=await render(io,'<main><h2 id="settings">Old</h2><p>Old</p></main>','## Heading {#settings}\n\nBody');
    assert.equal(reused.report.ok,true);
  });

  await t.test('distinct paragraph positions retain their own wrappers and styles', async () => {
    const design = '<main><header><h1>旧标题</h1><p class="lead">旧前言</p></header><div class="content"><p class="body">旧正文</p></div></main>';
    const result = await render(io, design, '# 新标题\n\n新前言\n\n新正文');
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('document.querySelector("main>header p.lead").textContent'), '新前言');
    assert.equal(await io.run('document.querySelector(".content p.body").textContent'), '新正文');
  });

  await t.test('DOM replacement that preserves the mapped content is accepted', async () => {
    const design = '<main><p>旧正文</p></main><script>const old=document.querySelector("p");const next=document.createElement("p");next.textContent=old.textContent;old.replaceWith(next)</script>';
    const result = await render(io, design, '新正文');
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('document.querySelector("main p").textContent'), '新正文');
  });

  await t.test('chapter containers remain usable across separate layout rows', async () => {
    const design = page('<main><div class="row">' + panel('one') + panel('two') + '</div><div class="row">' + panel('three') + panel('four') + '</div></main>');
    const result = await render(io, design, ['甲', '乙', '丙', '丁'].map((s) => '## ' + s + '\n\n正文').join('\n\n'));
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.equal(await io.run('document.querySelectorAll("main>.row").length'), 2);
  });

  await t.test('existing page data is preserved even when it uses familiar IDs', async () => {
    const data = '<script id="arc-map" type="application/json">{"theme":"dark"}</script>';
    const result = await render(io, '<main><p>旧正文</p></main>' + data, '新正文');
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    assert.ok(result.html.includes(data));
    assert.equal(await io.run('document.querySelectorAll("script[id]").length'), 1);
  });

  await t.test('page scripts initialize once after the saved artifact is opened', async () => {
    const design = '<main><p>旧正文</p></main><script>document.querySelector("main").append(document.createElement("button"))</script>';
    const result = await render(io, design, '新正文');
    assert.equal(result.report.ok, true);
    await io.load(result.html, { scripts: true });
    assert.equal(await io.run('document.querySelectorAll("main button").length'), 1);
  });
});

test('the public CLI accepts an HTML design and preserves the output on incomplete rendering', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-html-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'draft.md');
  const design = path.join(directory, 'design.html');
  const output = path.join(directory, 'result.html');
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  const source = '# 新标题\n\n新正文';
  fs.writeFileSync(input, source);
  fs.writeFileSync(design, '<html><head><style>p{color:green}</style></head><body><main><h1>旧标题</h1><p>旧正文</p></main><script>document.querySelector("main").append(document.createElement("button"))</script></body></html>');
  const invoke = (args) => spawnSync(process.execPath, [cli, 'document', input, ...args], { encoding: 'utf8' });
  const success = invoke([output, '--design', design]);
  assert.equal(success.status, 0, success.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /新正文/);
  assert.doesNotMatch(html, /arc-source|arc-map|data-render-/);
  assert.match(html, /p\{color:green\}/);
  assert.doesNotMatch(html, /<button/);
  const originalDesign = fs.readFileSync(design, 'utf8');
  assert.notEqual(invoke([design, '--design', design]).status, 0);
  assert.equal(fs.readFileSync(design, 'utf8'), originalDesign);
  const incomplete = '<main><p>旧正文</p></main><script>document.querySelector("main").textContent="旧计算结果"</script>';
  fs.writeFileSync(design, incomplete);
  const failure = invoke([output, '--design=' + design]);
  assert.notEqual(failure.status, 0);
  assert.match(failure.stderr, /document\/runtime-content-changed/);
  assert.equal(fs.readFileSync(output, 'utf8'), html);
  assert.notEqual(invoke([output, '--design']).status, 0);
  assert.equal(fs.readFileSync(design, 'utf8'), incomplete);
});

test('default rendering and the same explicit HTML design produce the same page', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-default-html-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'draft.md');
  const output = path.join(directory, 'default.html');
  const explicit = path.join(directory, 'explicit.html');
  const design = fileURLToPath(new URL('../archify/document/designs/review.html', import.meta.url));
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  fs.writeFileSync(input, '# 新标题\n\n新正文 **强调**。');
  const invoke = (args) => spawnSync(process.execPath, [cli, 'document', input, ...args], { encoding: 'utf8' });
  for (const args of [[output], [explicit, '--design', design]]) {
    const result = invoke(args);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(fs.readFileSync(output, 'utf8'), fs.readFileSync(explicit, 'utf8'));
  assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /arc-source|arc-map|data-src=|data-render-/);
  fs.writeFileSync(input, '没有标题的正文');
  const prose = invoke([output]);
  assert.equal(prose.status, 0, prose.stderr);
  assert.match(fs.readFileSync(output, 'utf8'), /<title>draft\.md<\/title>/);
});
