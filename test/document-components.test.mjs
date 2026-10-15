import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {findChrome} from '../archify/bin/visual-check.mjs';
import {documentBrowser} from '../archify/document/browser.mjs';
import {render} from '../archify/document/render.mjs';
import {desktopBrowser} from './helpers/desktop-browser.mjs';

const designURL=new URL('../archify/document/designs/components/native.html',import.meta.url);
const design=fs.readFileSync(designURL,'utf8');
const example=new URL('../archify/document/designs/examples/native-components.md',import.meta.url);

test('native document components use the public document renderer and retain complete paragraph markup',async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'archify-document-components-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));assert.ok(path.basename(folder).startsWith('archify-document-components-'));fs.rmSync(folder,{recursive:true,force:true});});
  const output=path.join(folder,'document.html');
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../archify/bin/archify.mjs',import.meta.url)),'document',fileURLToPath(example),output,'--design',fileURLToPath(designURL),'--json'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).ok,true);
  const browser=desktopBrowser(findChrome());t.after(()=>browser.close());
  const session=await browser.sessionPromise;await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},session);
  const io=await documentBrowser(browser,output);await io.load(fs.readFileSync(output,'utf8'),{scripts:true});
  const observed=await io.run(`({
    components:document.querySelectorAll('.native-component').length,
    source:[...document.querySelectorAll('.chapter-body > p[hidden]')].map(p=>p.textContent.replace(/^\\s*\\[g\\w+\\.\\d+\\.\\d+\\]\\s*/,'')),
    visible:[...document.querySelectorAll('.native-component foreignObject p')].map(p=>p.textContent),
    notes:document.querySelectorAll('.component-warning').length,
    clipped:[...document.querySelectorAll('.native-component foreignObject')].some(el=>el.firstElementChild.scrollHeight>el.height.baseVal.value+1),
    overflow:document.documentElement.scrollWidth>innerWidth,
    ids:[...document.querySelectorAll('.native-component [id]')].map(el=>el.id),
    href:document.querySelector('.native-component a').getAttribute('href'),
    code:document.querySelector('.native-component code').textContent,
    strong:document.querySelectorAll('.native-component strong').length
  })`);
  assert.equal(observed.components,6);assert.equal(observed.source.length,25);
  assert.deepEqual([...observed.visible].sort(),[...observed.source].sort());
  assert.equal(observed.notes,0);assert.equal(observed.clipped,false);assert.equal(observed.overflow,false);
  assert.equal(new Set(observed.ids).size,observed.ids.length);
  assert.equal(observed.href,'https://example.org/source');assert.equal(observed.code,'run --verify');assert.ok(observed.strong>0);
  const accessible=await browser.cdp.send('Accessibility.getFullAXTree',{},session);
  assert.ok(accessible.nodes.some(node=>node.role?.value==='group'&&node.name?.value===observed.source[0]),'The source paragraph must also be available to assistive reading');
  assert.deepEqual(await io.errors(),[]);
});

test('component marks are opt-in, preserve paragraph boundaries and leave invalid or oversized input readable',async t=>{
  const browser=desktopBrowser(findChrome());t.after(()=>browser.close());
  const session=await browser.sessionPromise;await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},session);
  const io=await documentBrowser(browser,fileURLToPath(designURL));
  const load=async source=>{const result=await render(io,design,source);assert.equal(result.report.ok,true,JSON.stringify(result.report));return result;};
  await load('# Normal\n\n## Section\n\nAn ordinary paragraph stays ordinary.');
  assert.equal(await io.run(`document.querySelectorAll('.native-component,[hidden]:not(template [hidden])').length`),0);
  const repeated='# Example\n\n[Read this section](#one-component)\n\n## [g1:regions] One component\n\n[g1.1.1] First line\ncontinues here.\n\n[g1.1.1] Second paragraph.\n\n[g1.2.1] Another node.\n\n[g1.2.2] Last node.\n';
  await load(repeated);
  const paragraphs=await io.run(`({count:document.querySelectorAll('.native-component').length,copy:[...document.querySelector('.native-component [data-node-id="a"]').querySelectorAll('foreignObject p')].map(el=>el.textContent.replace(/\\s+/g,' ').trim())})`);
  assert.equal(paragraphs.count,1);assert.deepEqual(paragraphs.copy,['First line continues here.','Second paragraph.']);
  assert.equal(await io.run('document.getElementById(document.querySelector(".hero a").getAttribute("href").slice(1)).closest(".chapter")===document.querySelector(".native-component").closest(".chapter")'),true);
  const reserved=await io.run('"component-0-"+document.querySelector("#recipe-regions").content.querySelector("[id]").id');
  await load(repeated.replace('# Example','# Example {#'+reserved+'}'));
  assert.equal(await io.run('new Set([...document.querySelectorAll("[id]")].map(el=>el.id)).size===document.querySelectorAll("[id]").length'),true);
  for(const source of [
    '# Example\n\n## [g1:unknown] Unknown\n\n[g1.1.1] Keep this paragraph.',
    '# Example\n\n## [g1:regions] Missing positions\n\n[g1.1.1] Keep this paragraph.',
    repeated.replace('[g1.2.2]','[g1.9.2]'),
    repeated.replace('First line','A much longer paragraph. '.repeat(100)),
    repeated.replace('First line','![Illustration](image.png)')
  ]){
    const result=await load(source);
    assert.equal(result.report.warnings.length,1);
    assert.equal(result.report.warnings[0].code,'document/component-fallback');
    assert.equal(await io.run('document.querySelectorAll(".native-component").length'),0);
    assert.equal(await io.run('document.querySelectorAll(".component-warning").length'),1);
    assert.equal(await io.run('document.querySelectorAll(".chapter-body > p[hidden]").length'),0);
    assert.deepEqual(await io.errors(),[]);
  }
});
