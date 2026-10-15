import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { render } from '../archify/document/render.mjs';
import { documentBrowser } from '../archify/document/browser.mjs';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';

const designURL = (name) => new URL(`../archify/document/designs/${name}.html`, import.meta.url);
const common = fs.readFileSync(new URL('../archify/document/designs/examples/common.md', import.meta.url), 'utf8');

test('report HTML designs render new Markdown through the shared renderer', async (t) => {
  const browser = desktopBrowser(findChrome());
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const viewport = async (width, height = 1000) => {
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session);
  };
  const load = async (name, source, options = {}) => {
    const url = designURL(name);
    const io = await documentBrowser(browser, fileURLToPath(url));
    const result = await render(io, fs.readFileSync(url, 'utf8'), source, options);
    assert.equal(result.report.ok, true, JSON.stringify(result.report));
    return { io, result };
  };
  await viewport(1440);

  for (const name of ['decision', 'analysis', 'review']) {
    await t.test(`${name}: complete source tables accompany accessible SVGs`, async () => {
      const { io, result } = await load(name, common);
      const output = await io.run(`({
        title: document.querySelector('h1').textContent,
        brand: document.querySelector('.brand').getAttribute('aria-label'),
        chapters: document.querySelectorAll('.chapter').length,
        tables: document.querySelectorAll('main table').length,
        graphs: [...document.querySelectorAll('.data-viz svg')].map(svg => ({
          role: svg.getAttribute('role'), label: svg.getAttribute('aria-label'), title: svg.querySelector('title')?.textContent
        })),
        values: [...document.querySelectorAll('main table:first-of-type tbody td')].slice(0, 3).map(td => td.textContent),
        validLinks: [...document.querySelectorAll('.section-nav a')].every(a => document.getElementById(decodeURIComponent(a.hash.slice(1))))
      })`);
      assert.equal(output.title, '把发布等待从 48 小时降到 18 小时');
      assert.equal(output.brand, 'Archify');
      assert.equal(output.chapters, 4);
      assert.equal(output.tables, 3);
      assert.equal(output.graphs.length, name === 'analysis' ? 4 : 5);
      assert.ok(output.graphs.every(graph => graph.role === 'img' && graph.label && graph.title));
      assert.deepEqual(output.values, ['试运行前', '48', '78']);
      assert.equal(output.validLinks, true);
      const saved = await io.run(`(() => {
        const doc = new DOMParser().parseFromString(${JSON.stringify(result.html)}, 'text/html');
        return { computed: doc.querySelectorAll('.data-viz').length, resources: doc.querySelectorAll('script[src],link[rel="stylesheet"]').length };
      })()`);
      assert.deepEqual(saved, { computed: 0, resources: 0 });
    });
  }

  await t.test('prose documents keep source headings and long tables within the reading column', async () => {
    const token = 'long_identifier_'.repeat(25);
    const source = `# 文档\n\n${'Opening source documentation and implementation details. '.repeat(16)}\n\n\`\`\`txt\n${token}\n\`\`\`\n\n## 输入\n\n正文在同一阅读列中。\n\n### 文件\n\n| 路径 | 说明 |\n| --- | --- |\n| \`${token}\` | 保留完整值 |\n\n## 输出\n\n### 检查\n\n保留这一段。`;
    for (const name of ['decision', 'analysis', 'review']) {
      const { io } = await load(name, source);
      const output = await io.run(`({
        labels: [...document.querySelectorAll('.chapter :is(h2,h3)')].map(node=>node.textContent),
        headingMap: document.querySelectorAll('.document-map').length,
        value: document.querySelector('tbody td').textContent,
        overflow: document.documentElement.scrollWidth > innerWidth,
        widths: (()=>{const body=document.querySelector('.chapter-body');return [body.clientWidth,body.querySelector('p').getBoundingClientRect().width,body.querySelector('.table-scroll').clientWidth];})(),
        openingWidths: (()=>{const hero=document.querySelector('.hero');return [hero.clientWidth,hero.querySelector('p').getBoundingClientRect().width,hero.querySelector('pre').getBoundingClientRect().width];})(),
        measurements: document.querySelectorAll('.chart-mark').length
      })`);
      assert.deepEqual(output.labels, ['输入', '文件', '输出', '检查']);
      assert.equal(output.headingMap, 0);
      assert.equal(output.value, token);
      assert.equal(output.measurements, 0);
      assert.equal(output.overflow, false);
      assert.ok(output.widths.every(width=>Math.abs(width-output.widths[0])<=1), name + ': body and table widths differ');
      assert.ok(output.openingWidths.every(width=>Math.abs(width-output.openingWidths[0])<=1), name + ': opening paragraph reserves unused space beside its code block');
    }
  });

  await t.test('purpose plots use explicit measurements while preserving the existing plot families', async () => {
    const source = `# 同一份记录\n\n## 任意标题\n\n| 条目 | 时间（ms） | 成本（元） |\n| --- | --- | --- |\n| A | 12 | 40 |\n| B | 20 | 18 |\n| C | 12 | 40 |\n\n| 输入比例（%） | X（ms） | Y（ms） |\n| --- | --- | --- |\n| 80 | 7 | 9 |\n| 20 | 15 | 12 |\n\n| 记录 | 开始 | 结束 |\n| --- | --- | --- |\n| 样本 | 2026-10-12 | 2026-10-16 |\n\n3. 核对记录。\n4. 保留结果。`;
    for (const name of ['decision','analysis','review']) {
      const { io } = await load(name, source);
      const actual = await io.run(`({
        options:[...document.querySelectorAll('.option-point')].map(node=>[node.dataset.label,Number(node.dataset.x),Number(node.dataset.y)]),
        samples:[...document.querySelectorAll('.sample-series')].map(series=>({title:series.dataset.series,points:[...series.querySelectorAll('.sample-point')].map(node=>[Number(node.dataset.x),Number(node.dataset.y)])})),
        paired:document.querySelectorAll('.comparison-mark').length,
        single:document.querySelectorAll('.chart-mark[data-value]').length,
        intervals:document.querySelectorAll('[data-control="interval-date"]').length,
        ordinals:[...document.querySelectorAll('.step-number')].map(node=>node.textContent),
        rows:[...document.querySelectorAll('tbody tr')].map(row=>[...row.cells].map(cell=>cell.textContent)),
        overflow:document.documentElement.scrollWidth>innerWidth
      })`);
      assert.deepEqual(actual.options,name==='decision'?[['A、C',12,40],['B',20,18]]:[]);
      assert.deepEqual(actual.samples,name==='analysis'?[{title:'X（ms）',points:[[20,15],[80,7]]},{title:'Y（ms）',points:[[20,12],[80,9]]}]:[]);
      assert.equal(actual.single,6); assert.equal(actual.paired,2); assert.equal(actual.intervals,1);
      assert.deepEqual(actual.ordinals,name==='review'?['3','4']:[]);
      assert.deepEqual(actual.rows,[['A','12','40'],['B','20','18'],['C','12','40'],['80','7','9'],['20','15','12'],['样本','2026-10-12','2026-10-16']]);
      assert.equal(actual.overflow,false);
    }
  });

  await t.test('text diagrams carry complete cell and list content with source links and explicit associations', async () => {
    const source = `# 内容关系\n\n## 对照\n\n| 对象 | 说明 | 要求 |\n| --- | --- | --- |\n| 甲 | **保留强调**并提供足够长的第一段说明 | 核对[原始记录](https://example.com/record)，不要截断正文 |\n| 乙 | 按原文保留第二个对象的详细说明 | 必须保留\`source_id\`以及所有原始条件 |\n\n- **条目一**：原文中的完整说明以及[参考资料](https://example.com/reference)。\n- **条目二**：原文中的另一段详细说明，保留\`exact_value\`。`;
    for (const name of ['decision', 'analysis', 'review']) {
      const { io } = await load(name, source);
      const actual = await io.run(`({
        rows:[...document.querySelectorAll('tbody tr')].map(row=>[...row.cells].map(cell=>cell.textContent)),
        items:[...document.querySelectorAll('.statement-list>li')].map(item=>item.textContent),
        edges:[...document.querySelectorAll('.content-wires path')].map(edge=>[edge.dataset.from,edge.dataset.to,edge.dataset.field]),
        links:[...document.querySelectorAll('.content-graph a')].map(a=>a.href),
        cellsVisible:[...document.querySelectorAll('tbody td')].every(cell=>cell.checkVisibility()),
        overflow:document.documentElement.scrollWidth>innerWidth,
        emphasis:document.querySelector('tbody td strong')?.textContent,
        code:[...document.querySelectorAll('.content-graph code')].map(node=>node.textContent)
      })`);
      assert.deepEqual(actual.rows, [['甲','保留强调并提供足够长的第一段说明','核对原始记录，不要截断正文'],['乙','按原文保留第二个对象的详细说明','必须保留source_id以及所有原始条件']]);
      assert.deepEqual(actual.items,['条目一：原文中的完整说明以及参考资料。','条目二：原文中的另一段详细说明，保留exact_value。']);
      assert.deepEqual(actual.edges, [
        ['甲',actual.rows[0][1],'说明'],['甲',actual.rows[0][2],'要求'],
        ['乙',actual.rows[1][1],'说明'],['乙',actual.rows[1][2],'要求'],
        ['条目一','：原文中的完整说明以及参考资料。','同一条目中的说明'],
        ['条目二','：原文中的另一段详细说明，保留exact_value。','同一条目中的说明']
      ]);
      assert.deepEqual(actual.links,['https://example.com/record','https://example.com/reference']);
      assert.equal(actual.cellsVisible,true); assert.equal(actual.overflow,false);
      assert.equal(actual.emphasis,'保留强调'); assert.deepEqual(actual.code,['source_id','exact_value']);
    }
  });

  await t.test('updated values redraw plots while unqualified identifiers remain in the table', async () => {
    const source = (value) => `# 测量\n\n## 比较\n\n| 条目 | 编号 | 时间（ms） |\n| --- | --- | --- |\n| A | 1001 | ${value} |\n| B | 1002 | 18 |`;
    for (const value of [12, 21]) {
      const { io } = await load('analysis', source(value));
      assert.equal(await io.run('document.querySelectorAll(".data-viz svg").length'), 1);
      assert.deepEqual(await io.run('[...document.querySelectorAll(".chart-mark")].map(g => Number(g.dataset.value))'), [value, 18]);
      assert.deepEqual(await io.run('[...document.querySelectorAll("tbody tr")].map(row => [...row.cells].map(cell => cell.textContent))'), [['A', '1001', String(value)], ['B', '1002', '18']]);
    }
  });

  await t.test('mixed units, missing measurements and invalid dates retain tables without invented plots', async () => {
    const source = `# 输入边界

## 原始记录

| 项目 | 时间（ms） |
| --- | --- |
| A | 5ms |
| B | 2s |

| 项目 | 数量（组） |
| --- | --- |
| A | 3 |
| B | — |

| 项目 | 开始 | 结束 |
| --- | --- | --- |
| 无效日期 | 2026-02-30 | 2026-03-02 |

| 项目 | 开始 | 结束 |
| --- | --- | --- |
| 倒置日期 | 2026-10-20 | 2026-10-12 |

| 项目 | 开始 | 结束 |
| --- | --- | --- |
| 未定日期 | 2026-10-12 | 待定 |`;
    const { io } = await load('review', source);
    assert.equal(await io.run('document.querySelectorAll(".data-viz svg").length'), 0);
    assert.equal(await io.run('document.querySelectorAll("main table").length'), 5);
    assert.match(await io.run('document.querySelector("main").textContent'), /待定/);
  });

  await t.test('signed measurements retain their values and zero has no positive bar', async () => {
    const source = '# 变化\n\n## 记录\n\n| 项目 | 变化（组） |\n| --- | --- |\n| A | -5 |\n| B | 0 |\n| C | 10 |';
    const { io } = await load('decision', source);
    const marks = await io.run('[...document.querySelectorAll(".chart-mark")].map(g => ({value: Number(g.dataset.value), width: Number(g.querySelector(".chart-bar").getAttribute("width"))}))');
    assert.deepEqual(marks.map(mark => mark.value), [-5, 0, 10]);
    assert.equal(marks[1].width, 0);
    assert.ok(marks[0].width > 0 && marks[2].width > marks[0].width);
  });

  await t.test('sequence figures preserve the authored starting ordinal and original list', async () => {
    const { io } = await load('review', '# 顺序\n\n## 交接\n\n3. 核对样本。\n4. 完成评审。\n5. 移交负责人。');
    assert.deepEqual(await io.run('[...document.querySelectorAll(".step-number")].map(node => node.textContent)'), ['3', '4', '5']);
    assert.equal(await io.run('document.querySelector("main ol").start'), 3);
    assert.deepEqual(await io.run('[...document.querySelectorAll("main ol > li")].map(li => li.textContent)'), ['核对样本。', '完成评审。', '移交负责人。']);
  });

  await t.test('paired measurements retain both endpoints and explicitly signed differences', async () => {
    const { io } = await load('review', `# 对照

## 原始记录

| 项目 | A（ms） | B（ms） |
| --- | --- | --- |
| 甲 | -5 | -2 |
| 乙 | 0 | 0 |
| 丙 | 10 | 4 |

| 项目 | A（%） | B（%） |
| --- | --- | --- |
| 样本 | 78 | 91 |`);
    assert.deepEqual(await io.run('[...document.querySelectorAll(".comparison-mark")].map(node => [Number(node.dataset.first),Number(node.dataset.second),Number(node.dataset.delta)])'), [[-5,-2,3],[0,0,0],[10,4,-6],[78,91,13]]);
    assert.deepEqual(await io.run('[...document.querySelectorAll(".comparison-key")].map(node=>node.textContent)'), ['A（ms）B（ms）','A（%）B（%）']);
    assert.deepEqual(await io.run('[...document.querySelectorAll(".comparison-delta")].map(node=>node.textContent)'), ['+3ms','0ms','-6ms','+13个百分点']);
    assert.equal(await io.run('document.querySelectorAll(".data-viz svg").length'), 2);
    assert.deepEqual(await io.run('[...document.querySelectorAll("tbody tr")].map(row=>[...row.cells].map(cell=>cell.textContent))'), [['甲','-5','-2'],['乙','0','0'],['丙','10','4'],['样本','78','91']]);
    await browser.cdp.send('Page.bringToFront', {}, session);
    assert.equal(await io.run('document.querySelector(".comparison-mark").focus();document.querySelector("tbody tr.is-highlighted").cells[0].textContent'), '甲');
    const sourceTables = await io.run('[...document.querySelectorAll("main table")].map(table=>table.textContent)');
    await io.run(`{const figure=document.querySelector('.comparison-figure');
      const control=figure.querySelector('[data-control="comparison-order"]');control.value='gap';control.dispatchEvent(new Event('change',{bubbles:true}));}`);
    assert.deepEqual(await io.run('[...document.querySelector(".comparison-figure").querySelectorAll(".comparison-mark")].map(node=>node.dataset.label)'), ['丙','甲','乙']);
    await io.run(`{const control=document.querySelector('[data-control="comparison-reference"]');control.value='second';control.dispatchEvent(new Event('change',{bubbles:true}));}`);
    assert.deepEqual(await io.run('[...document.querySelector(".comparison-figure").querySelectorAll(".comparison-mark")].map(node=>Number(node.dataset.delta))'), [6,-3,0]);
    assert.equal(await io.run('document.querySelector(".comparison-figure .chart-note").textContent'), 'Δ = A（ms） − B（ms）');
    assert.equal(await io.run('document.querySelector(".comparison-figure .chart-readout").textContent'), '差距最大：丙 · +6ms');
    await io.run(`{const control=document.querySelector('[data-control="comparison-view"]');control.value='difference';control.dispatchEvent(new Event('change',{bubbles:true}));}`);
    assert.equal(await io.run('document.querySelector(".comparison-figure svg").getAttribute("aria-label")'), '差值分布');
    assert.equal(await io.run('document.querySelector(".comparison-figure .comparison-mark:last-of-type .chart-bar").getAttribute("width")'), '0');
    await viewport(900);
    await io.run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    assert.equal(await io.run('document.querySelector("[data-control=comparison-view]").value'), 'difference');
    assert.deepEqual(await io.run('[...document.querySelector(".comparison-figure").querySelectorAll(".comparison-mark")].map(node=>Number(node.dataset.delta))'), [6,-3,0]);
    await io.run('document.querySelector(".comparison-figure .chart-reset").click()');
    assert.deepEqual(await io.run('[...document.querySelector(".comparison-figure").querySelectorAll(".comparison-mark")].map(node=>Number(node.dataset.delta))'), [3,0,-6]);
    assert.equal(await io.run('document.querySelector("[data-control=comparison-view]").value'), 'endpoints');
    assert.deepEqual(await io.run('[...document.querySelectorAll("main table")].map(table=>table.textContent)'), sourceTables);
    await viewport(1440);
  });

  await t.test('ordinary Markdown supplies hierarchy branches and complete step cards with inspectable source', async () => {
    const source = fs.readFileSync(new URL('../archify/document/designs/examples/information.md', import.meta.url), 'utf8');
    const { io } = await load('review', source);
    assert.deepEqual(await io.run('[...document.querySelectorAll(".hierarchy-edge")].map(edge=>[edge.dataset.parent,edge.dataset.child])'), [
      ['材料准备','输入样例缺少异常批次'], ['材料准备','负责人边界未写清楚'],
      ['验证环节','重复提交缺少恢复验证'], ['验证环节','高峰时段样本尚未覆盖'],
      ['交接环节','回滚条件需要共同确认'], ['交接环节','复盘结论需要附上证据'],
    ]);
    assert.equal(await io.run('document.querySelectorAll(".hierarchy-node").length'), 9);
    assert.deepEqual(await io.run('[...document.querySelectorAll(".flow-node")].map(node=>node.getAttribute("aria-label"))'), [
      '1. 统一口径。 核对计时起点、结束条件与异常样本。',
      '2. 补齐验证。 在第二条业务线进行小流量试运行。',
      '3. 完成评审。 一起检查等待时间和通过率，再决定扩大范围。',
    ]);
    assert.equal(await io.run('document.querySelectorAll(".sequence-viz .step-link").length'), 2);
    assert.ok(await io.run(`[...document.querySelectorAll('.flow-node,.hierarchy-node')].every(node=>{
      const card=node.querySelector('rect').getBBox();
      return [...node.querySelectorAll('.structure-label')].every(text=>{
        const label=text.getBBox();
        return label.x>=card.x && label.y>=card.y && label.x+label.width<=card.x+card.width+1 && label.y+label.height<=card.y+card.height;
      });
    })`), 'A diagram clips its full source label');
    assert.equal(await io.run('document.querySelectorAll(".viz-source").length'), 2);
    assert.equal(await io.run('document.querySelector(".hierarchy-viz .viz-source").open'), false);
    assert.equal(await io.run('document.querySelector(".hierarchy-viz summary").click();document.querySelector(".hierarchy-viz .viz-source").open'), true);
    assert.equal(await io.run('document.querySelector(".hierarchy-viz ul").querySelectorAll("li").length'), 9);
    const sourceList = await io.run('document.querySelector(".hierarchy-viz ul").textContent');
    await io.run(`{const control=document.querySelector('[data-control="hierarchy-node"]');control.value='0';control.dispatchEvent(new Event('change',{bubbles:true}));}`);
    assert.equal(await io.run('document.querySelector(".hierarchy-viz .chart-readout").textContent'), '路径：材料准备 · 2 个子条目');
    assert.equal(await io.run('document.querySelectorAll(".hierarchy-node:not(.is-muted)").length'), 3);
    await io.run('document.querySelectorAll(".hierarchy-node")[1].dispatchEvent(new MouseEvent("click",{bubbles:true}))');
    assert.equal(await io.run('document.querySelector(".hierarchy-viz .chart-readout").textContent'), '路径：材料准备 › 输入样例缺少异常批次 · 0 个子条目');
    assert.equal(await io.run('document.querySelectorAll(".hierarchy-node:not(.is-muted)").length'), 2);
    assert.equal(await io.run('document.querySelectorAll(".hierarchy-edge.is-related").length'), 1);
    assert.equal(await io.run('document.querySelector(".hierarchy-node[aria-pressed=true]").dataset.label'), '输入样例缺少异常批次');
    await browser.cdp.send('Page.bringToFront', {}, session);
    await io.run('document.querySelectorAll(".hierarchy-node")[3].focus()');
    await browser.cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 }, session);
    await browser.cdp.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 }, session);
    assert.equal(await io.run('document.querySelector(".hierarchy-viz .chart-readout").textContent'), '路径：验证环节 · 2 个子条目');
    await browser.cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 }, session);
    await browser.cdp.send('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape', windowsVirtualKeyCode:27 }, session);
    assert.equal(await io.run('document.querySelectorAll(".hierarchy-node.is-muted").length'), 0);
    assert.deepEqual(await io.run('document.querySelector(".hierarchy-viz ul").textContent'), sourceList);
    const openSources = await io.run('[...document.querySelectorAll(".viz-source")].map(source=>source.open)');
    await io.run('dispatchEvent(new Event("beforeprint"));dispatchEvent(new Event("beforeprint"))');
    assert.equal(await io.run('[...document.querySelectorAll(".viz-source")].every(source=>source.open)'), true);
    await browser.cdp.send('Emulation.setEmulatedMedia', { media: 'print' }, session);
    const printed = await browser.cdp.send('Page.printToPDF', {printBackground:true}, session);
    assert.ok(Buffer.from(printed.data,'base64').length > 1000);
    assert.deepEqual(await io.run('[...document.querySelectorAll(".viz-source")].map(source=>source.open)'), openSources);
    assert.ok(await io.run('document.querySelector(".sequence-viz ol").getBoundingClientRect().height > 0'), 'Print hides the original list');
    assert.equal(await io.run('getComputedStyle(document.querySelector(".hierarchy-viz .chart-controls")).display'), 'none');
    await browser.cdp.send('Emulation.setEmulatedMedia', { media: '' }, session);
  });

  await t.test('date queries compute inclusive coverage and preserve same-day records, gaps and source', async () => {
    const { io } = await load('review', `# 日期查询

## 记录

| 项目 | 开始 | 结束 |
| --- | --- | --- |
| 区间甲 | 2026-10-01 | 2026-10-03 |
| 区间乙 | 2026-10-03 | 2026-10-04 |
| 同日记录 | 2026-10-03 | 2026-10-03 |
| 孤立记录 | 2026-10-06 | 2026-10-06 |`);
    const original = await io.run('document.querySelector("main table").textContent');
    const query = async day => {
      await io.run(`{const slider=document.querySelector('[data-control="interval-date"]');slider.value=${JSON.stringify(String(day))};slider.dispatchEvent(new Event('input',{bubbles:true}));}`);
      return await io.run('[...document.querySelectorAll("tbody tr.is-date-match")].map(row=>row.cells[0].textContent)');
    };
    assert.deepEqual(await query(2), ['区间甲','区间乙','同日记录']);
    assert.equal(await io.run('document.querySelector(".chart-readout").textContent'), '2026-10-03 · 3 个区间覆盖：区间甲、区间乙、同日记录');
    assert.equal(await io.run('document.querySelector("[data-control=interval-date]").getAttribute("aria-valuetext")'), '2026-10-03');
    assert.equal(await io.run('document.querySelectorAll(".date-cursor").length'), 1);
    assert.deepEqual(await query(4), []);
    assert.equal(await io.run('document.querySelector(".chart-readout").textContent'), '2026-10-05 · 0 个区间覆盖');
    assert.deepEqual(await query(5), ['孤立记录']);
    await browser.cdp.send('Emulation.setEmulatedMedia', { media: 'print' }, session);
    assert.equal(await io.run('getComputedStyle(document.querySelector(".chart-controls")).display'), 'none');
    assert.ok(await io.run('document.querySelector(".chart-readout").getBoundingClientRect().height > 0'));
    await browser.cdp.send('Emulation.setEmulatedMedia', { media: '' }, session);
    await io.run('document.querySelector(".chart-reset").click()');
    assert.equal(await io.run('document.querySelectorAll("tbody tr.is-date-match,.date-cursor").length'), 0);
    assert.equal(await io.run('document.querySelector("main table").textContent'), original);
    const fixed = await load('review', '# 单日记录\n\n## 日期\n\n| 项目 | 开始 | 结束 |\n| --- | --- | --- |\n| 唯一日期 | 2026-10-03 | 2026-10-03 |');
    assert.equal(await fixed.io.run('document.querySelector(".chart-readout").textContent'), '2026-10-03 · 1 个区间覆盖：唯一日期');
    assert.equal(await fixed.io.run('getComputedStyle(document.querySelector(".chart-controls")).display'), 'none');
  });

  await t.test('flat unordered and nested ordered lists keep their source while zero ordinals remain zero', async () => {
    const { io } = await load('review', '# 列表边界\n\n## 原文\n\n- 平行条目甲\n- 平行条目乙\n\n1. 第一组\n  - 子条目甲\n  - 子条目乙\n2. 第二组\n\n0) 核对\n1) 交接');
    assert.equal(await io.run('document.querySelectorAll(".hierarchy-viz").length'), 0);
    assert.equal(await io.run('document.querySelectorAll(".sequence-viz").length'), 1);
    assert.deepEqual(await io.run('[...document.querySelectorAll(".step-number")].map(node=>node.textContent)'), ['0','1']);
    assert.deepEqual(await io.run('[...document.querySelectorAll("main ol")].map(list=>list.start)'), [1,0]);
    assert.match(await io.run('document.querySelector("main ol").textContent.replace(/\\s+/g, "")'), /第一组子条目甲子条目乙第二组/);
  });

  await t.test('source links remain ordinary clickable links without embedded views', async t => {
    const requests=[];
    const server=http.createServer((request,response)=>{requests.push(request.url);response.end('linked content');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
    const base='http://127.0.0.1:'+server.address().port;
    const source='# 资料\n\n## 来源\n\n[网页]('+base+'/web)\n\n[文件](information.md)\n\n[图片链接]('+base+'/photo.png)';
    const options={sourceURL:new URL('../archify/document/designs/examples/information.md',import.meta.url).href,designOptions:{link_previews:true}};
    for(const family of ['decision','analysis','review']){
      const {io}=await load(family,source,{...options,designURL:designURL(family).href});
      assert.deepEqual(await io.run('[...document.querySelectorAll(".chapter-body p a")].map(link=>[link.textContent,link.href])'),[['网页',base+'/web'],['文件',new URL('information.md',options.sourceURL).href],['图片链接',base+'/photo.png']]);
      assert.equal(await io.run('document.querySelectorAll(".chapter-body p button,iframe").length'),0);
    }
    assert.deepEqual(requests,[]);
  });

  await t.test('multiple evidence tables in the lead chapter remain separate and readable', async () => {
    const source = '# 多项证据\n\n## 建议\n\n> 根据两组记录决定。\n\n| 批次 | 时间（ms） |\n| --- | --- |\n| A | 12 |\n| B | 18 |\n\n另一组记录如下。\n\n| 批次 | 数量（组） |\n| --- | --- |\n| A | 3 |\n| B | 5 |';
    const { io } = await load('decision', source);
    const bounds = await io.run('[...document.querySelectorAll(".chapter-body > .data-viz")].map(node => ({top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom}))');
    assert.equal(bounds.length, 2);
    assert.ok(bounds[0].bottom <= bounds[1].top, 'Evidence tables overlap');
    assert.deepEqual(await io.run('[...document.querySelectorAll(".chart-mark")].map(g => Number(g.dataset.value))'), [12, 18, 3, 5]);
  });

  await t.test('review introductory tables keep inline code readable in both appearances', async () => {
    const source = '# 模板说明\n\n前言。\n\n| HTML input | 用途 |\n| --- | --- |\n| `decision.html` | 决策 |\n| `analysis.html` | 分析 |\n| `review.html` | 复盘 |\n\n## 使用\n\n正文。';
    const { io } = await load('review', source);
    const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number)
      .map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    for (const appearance of ['light', 'dark']) {
      const labels = await io.run(`document.documentElement.dataset.appearance=${JSON.stringify(appearance)};
        [...document.querySelectorAll('.hero td code')].map(code => ({text:code.textContent,color:getComputedStyle(code).color,background:getComputedStyle(code).backgroundColor}))`);
      assert.deepEqual(labels.map(label => label.text), ['decision.html', 'analysis.html', 'review.html']);
      for (const label of labels) {
        const colors = [luminance(label.color), luminance(label.background)].sort((a, b) => a - b);
        assert.ok((colors[1] + .05) / (colors[0] + .05) >= 4.5, `${appearance}: unreadable ${label.text}`);
      }
    }
  });

  await t.test('mobile reading, keyboard chart focus, appearance and print retain the source', async () => {
    await viewport(390, 844);
    for (const name of ['decision', 'analysis', 'review']) {
      const { io } = await load(name, common);
      assert.ok(await io.run('document.documentElement.scrollWidth <= innerWidth'), name + ': page overflow');
      const original = await io.run('[...document.querySelectorAll("main table")].map(table => table.textContent)');
      await browser.cdp.send('Page.bringToFront', {}, session);
      assert.equal(await io.run('document.querySelector(".chart-mark").focus(); document.querySelectorAll("tbody tr.is-highlighted").length'), 1);
      assert.equal(await io.run('document.querySelector("[data-action=appearance]").click(); document.documentElement.dataset.appearance'), 'dark');
      assert.deepEqual(await io.run('[...document.querySelectorAll("main table")].map(table => table.textContent)'), original);
      await browser.cdp.send('Emulation.setEmulatedMedia', { media: 'print' }, session);
      assert.equal(await io.run('getComputedStyle(document.querySelector(".toolbar")).display'), 'none');
      assert.equal(await io.run('getComputedStyle(document.querySelector(".table-scroll")).overflow'), 'visible');
      assert.deepEqual(await io.run('[...document.querySelectorAll("main table")].map(table => table.textContent)'), original);
      assert.ok(await io.run('[...document.querySelectorAll(".data-viz svg")].every(svg => getComputedStyle(svg).display !== "none")'));
      await browser.cdp.send('Emulation.setEmulatedMedia', { media: '' }, session);
    }
  });
});
