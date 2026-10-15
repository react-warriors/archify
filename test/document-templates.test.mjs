import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {callTool} from '../archify/document/tool.mjs';
import {ChromeVisualBrowser,findChrome} from '../archify/bin/visual-check.mjs';
import {documentBrowser} from '../archify/document/browser.mjs';

const cli=fileURLToPath(new URL('../archify/bin/archify.mjs',import.meta.url));
test('HTML capture, saved templates and three report designs use the same renderer',async t=>{
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'archify-templates-')));
  t.after(()=>{assert.equal(path.dirname(directory),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(directory).startsWith('archify-templates-'));fs.rmSync(directory,{recursive:true,force:true});});
  const markdown=path.join(directory,'source.md');fs.writeFileSync(markdown,'# 新标题\n\n引言。\n\n## 甲\n\n第一段。\n\n## 乙\n\n第二段。\n\n## 丙\n\n第三段。');
  const output=path.join(directory,'result.html');
  await t.test('the catalog has three independent designs and each ID renders',async()=>{
    const catalog=await callTool('list_document_templates',{});assert.equal(catalog.ok,true);assert.equal(catalog.templates.length,3);
    assert.deepEqual(catalog.templates.map(template=>template.id),['decision/static','analysis/static','review/static']);
    for(const template of catalog.templates){const result=await callTool('render_markdown',{markdown_path:markdown,template:template.id,output_path:output});assert.equal(result.ok,true,JSON.stringify(result));assert.ok(fs.readFileSync(output,'utf8').includes('第三段。'));}
    const run=spawnSync(process.execPath,[cli,'document',markdown,output,'--template','analysis/static','--json'],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).ok,true);
    const withdrawn=await callTool('render_markdown',{markdown:'Body',template:'analysis/dynamic',output_path:output});assert.equal(withdrawn.ok,false);assert.equal(withdrawn.diagnostics[0].code,'document/template-unknown');
  });
  const design=path.join(directory,'local # design.html');
  fs.writeFileSync(design,'<!doctype html><meta name="viewport" content="width=device-width"><template><img src="thumb.svg"></template><main id="paper"><h1>Old</h1><p>Old paragraph</p></main><footer><p>Fixed footer</p></footer>');
  await t.test('stored HTML and scan metadata remain bound and protect both inputs',async()=>{
    const library=path.join(directory,'library'),folder=path.join(library,'用户报告');const scanned=await callTool('scan_html',{design_path:design,template_dir:folder});assert.equal(scanned.ok,true,JSON.stringify(scanned));assert.ok(scanned.template.scan.slots.length);assert.equal(scanned.template.scan.snapshot,undefined);
    assert.ok(fs.readFileSync(path.join(folder,'design.html'),'utf8').includes(new URL('thumb.svg',pathToFileURL(design)).href));
    const render=await callTool('render_markdown',{markdown_path:markdown,template_path:folder,output_path:output});assert.equal(render.ok,true,JSON.stringify(render));const before=fs.readFileSync(output);
    const manifest=path.join(folder,'template.json'),manifestBytes=fs.readFileSync(manifest);
    const entriesBefore=fs.readdirSync(library);
    const listed=await callTool('list_document_templates',{library_path:library});assert.equal(listed.ok,true,JSON.stringify(listed));assert.equal(listed.library_path,library);assert.equal(listed.templates.length,3);assert.deepEqual(listed.saved_templates.map(entry=>({name:entry.name,path:entry.path})),[{name:'用户报告',path:manifest}]);assert.deepEqual(listed.warnings,[]);assert.deepEqual(fs.readdirSync(library),entriesBefore);assert.deepEqual(fs.readFileSync(manifest),manifestBytes);
    const listing=spawnSync(process.execPath,[cli,'document','templates','--library-path',library,'--json'],{encoding:'utf8'});assert.equal(listing.status,0,listing.stderr);assert.deepEqual(JSON.parse(listing.stdout),listed);
    const elsewhere=path.join(directory,'another-conversation');fs.mkdirSync(elsewhere);fs.unlinkSync(design);
    const entry=fileURLToPath(new URL('../archify/bin/document-tool.mjs',import.meta.url)),answer=path.join(elsewhere,'answer.html');
    const reused=spawnSync(process.execPath,[entry],{cwd:elsewhere,input:JSON.stringify({tool:'render_markdown',arguments:{markdown:'# 直接回答\n\n已保存的模板可以复用。',template_path:listed.saved_templates[0].path,output_path:answer}}),encoding:'utf8'});assert.equal(reused.status,0,reused.stderr||reused.stdout);assert.equal(JSON.parse(reused.stdout).ok,true);assert.ok(fs.readFileSync(answer,'utf8').includes('已保存的模板可以复用。'));
    const conflict=await callTool('render_markdown',{markdown:'正文',template_path:folder,output_path:manifest});assert.equal(conflict.ok,false);assert.deepEqual(fs.readFileSync(manifest),manifestBytes);
    const duplicate=await callTool('scan_html',{template_path:folder,template_dir:folder});assert.equal(duplicate.ok,false);assert.equal(duplicate.diagnostics[0].code,'document/template-destination');assert.deepEqual(fs.readFileSync(manifest),manifestBytes);
    const retained=path.join(library,'retained');fs.mkdirSync(retained);for(const name of ['design.html','template.json'])fs.copyFileSync(path.join(folder,name),path.join(retained,name));fs.mkdirSync(path.join(library,'unrelated'));
    fs.appendFileSync(path.join(folder,'design.html'),'<!-- modified -->');const changed=await callTool('render_markdown',{markdown:'正文',template_path:folder,output_path:output});assert.equal(changed.ok,false);assert.equal(changed.diagnostics[0].code,'document/template-changed');assert.deepEqual(fs.readFileSync(output),before);
    const unavailable=await callTool('list_document_templates',{library_path:library});assert.equal(unavailable.ok,true);assert.deepEqual(unavailable.saved_templates.map(entry=>entry.name),['retained']);assert.equal(unavailable.warnings.length,1);assert.equal(unavailable.warnings[0].subject.path,manifest);assert.equal(unavailable.warnings[0].evidence.reason,'document/template-changed');assert.deepEqual(fs.readFileSync(manifest),manifestBytes);
  });

  await t.test('local base URLs, inline CSS and template resources remain bound to the supplied HTML',async()=>{
    const local=path.join(directory,'based.html');
    fs.writeFileSync(local,'<base href="./assets/"><style>main{background-image:url("paper.svg")}</style><template><img src="thumb.svg"></template><main style="background-image:url(cover.svg)"><p>Old</p></main>');
    const linked=path.join(directory,'linked.md');fs.writeFileSync(linked,'[Source](notes.md)');
    const result=await callTool('render_markdown',{markdown_path:linked,design_path:local,output_path:output});assert.equal(result.ok,true,JSON.stringify(result));
    const html=fs.readFileSync(output,'utf8');
    for(const name of ['paper.svg','cover.svg','thumb.svg'])assert.ok(html.includes(new URL('assets/'+name,pathToFileURL(local)).href),name);
    assert.ok(html.includes(new URL('notes.md',pathToFileURL(markdown)).href));
  });

  await t.test('declared local HTML encodings preserve non-ASCII page controls',async()=>{
    const encoded=path.join(directory,'encoded.html');fs.writeFileSync(encoded,Buffer.from('<meta charset="windows-1252"><button>Caf\xe9</button><main><p>Old</p></main>','latin1'));
    const result=await callTool('render_markdown',{markdown:'正文',design_path:encoded,output_path:output});assert.equal(result.ok,true,JSON.stringify(result));
    assert.match(fs.readFileSync(output,'utf8'),/Café/);assert.match(fs.readFileSync(output,'utf8'),/charset="utf-8"/);
  });

  await t.test('mixed data and relative srcset candidates survive capture and relocation',async()=>{
    const source=path.join(directory,'responsive-source');fs.mkdirSync(source);
    const local=path.join(source,'design.html');
    const inline='data:image/svg+xml,%3Csvg%20xmlns="http://www.w3.org/2000/svg"%20width="2"%20height="2"%3E%3C/svg%3E'.replaceAll('"','%22');
    fs.writeFileSync(path.join(source,'large.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>');
    fs.writeFileSync(local,'<aside><picture><source srcset="'+inline+' 1x, large.svg 2x"><img id="responsive" src="large.svg" srcset="'+inline+' 1x, large.svg 2x"></picture></aside><template><img srcset="'+inline+', large.svg 2x"><img srcset="small,one.svg 320w,large.svg 640w"></template><main><p>Old copy</p></main>');
    const folder=path.join(directory,'responsive-saved');
    const captured=await callTool('scan_html',{design_path:local,template_dir:folder});assert.equal(captured.ok,true,JSON.stringify(captured));
    const absolute=new URL('large.svg',pathToFileURL(local)).href;
    const saved=fs.readFileSync(path.join(folder,'design.html'),'utf8');
    assert.ok(saved.includes(inline+' 1x, '+absolute+' 2x'),saved);
    assert.ok(saved.includes(inline+', '+absolute+' 2x'),saved);
    assert.ok(saved.includes(new URL('small,one.svg',pathToFileURL(local)).href+' 320w,'+absolute+' 640w'),saved);
    const result=await callTool('render_markdown',{markdown:'Responsive body',template_path:folder,output_path:output});assert.equal(result.ok,true,JSON.stringify(result));
    const browser=new ChromeVisualBrowser(findChrome());
    try{
      await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:2,mobile:false},await browser.sessionPromise);
      const io=await documentBrowser(browser,output);await io.load(fs.readFileSync(output,'utf8'));
      assert.deepEqual(await io.run('[...document.querySelectorAll("[srcset]")].map(node=>node.getAttribute("srcset"))'),[inline+' 1x, '+absolute+' 2x',inline+' 1x, '+absolute+' 2x']);
      assert.equal(await io.run('document.querySelector("#responsive").currentSrc'),absolute);
      assert.equal(await io.run('document.querySelector("#responsive").naturalWidth>0'),true);
    }finally{await browser.close();}
  });

  await t.test('output replaced during HTML initialization is preserved instead of overwritten',async()=>{
    fs.writeFileSync(output,'Previous output');
    const server=http.createServer((_request,response)=>{
      const newer=path.join(directory,'newer.html');fs.writeFileSync(newer,'Concurrent output');fs.renameSync(newer,output);
      response.setHeader('Content-Type','application/javascript');response.end('window.fixtureReady=true;');
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const concurrent=path.join(directory,'concurrent.html');fs.writeFileSync(concurrent,'<main><p>Old</p></main><script src="http://127.0.0.1:'+server.address().port+'/initialize.js"></script>');
      const result=await callTool('render_markdown',{markdown:'New source',design_path:concurrent,output_path:output});
      assert.equal(result.ok,false);assert.equal(fs.readFileSync(output,'utf8'),'Concurrent output');
    } finally {await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
  });
  await t.test('explicit exclusions preserve embedded UI when chapter containers repeat',async()=>{
    const scoped=path.join(directory,'scoped.html');fs.writeFileSync(scoped,'<main><section><h2>Old A</h2><p>Old A body</p><div id="fixed" class="fixed"><p>Counter</p></div></section><section><h2>Old B</h2><p>Old B body</p><div class="fixed"><p>Counter</p></div></section><div id="tail"><p>Preserved tail</p></div></main>');
    const folder=path.join(directory,'scoped');const capture=await callTool('scan_html',{design_path:scoped,content_selector:'main',exclude_selector:'#fixed,.fixed,#tail',template_dir:folder});assert.equal(capture.ok,true,JSON.stringify(capture));
    const render=await callTool('render_markdown',{markdown:'## 甲\n\n第一段。\n\n## 乙\n\n第二段。\n\n## 丙\n\n第三段。',template_path:folder,output_path:output});assert.equal(render.ok,true,JSON.stringify(render));
    const browser=new ChromeVisualBrowser(findChrome());try{const io=await documentBrowser(browser,output);await io.load(fs.readFileSync(output,'utf8'));assert.deepEqual(await io.run('[...document.querySelectorAll(".fixed p")].map(node=>node.textContent)'),['Counter','Counter','Counter']);assert.equal(await io.run('document.querySelector("#tail p").textContent'),'Preserved tail');assert.deepEqual(await io.run('[...document.querySelectorAll("section>p")].map(node=>node.textContent)'),['第一段。','第二段。','第三段。']);}finally{await browser.close();}
    for(const selectors of [{content_selector:'section'},{content_selector:'['},{content_selector:'main',exclude_selector:'main'}]){const failed=await callTool('render_markdown',{markdown:'正文',design_path:scoped,output_path:output,...selectors});assert.equal(failed.ok,false);assert.ok(failed.diagnostics[0].code.startsWith('document/content-'));}
    fs.writeFileSync(scoped,'<main><p>Preserved main</p><aside><div id="custom"><p>Old selected body</p></div></aside></main>');
    const selected=await callTool('render_markdown',{markdown:'Selected body',design_path:scoped,content_selector:'#custom',output_path:output});assert.equal(selected.ok,true,JSON.stringify(selected));const html=fs.readFileSync(output,'utf8');assert.ok(html.includes('Preserved main'));assert.ok(html.includes('Selected body'));assert.ok(!html.includes('Old selected body'));
  });
  await t.test('initialization uses the delivered output URL and preserves output on missing runtime scripts',async()=>{
    const designDirectory=path.join(directory,'runtime-design'),outputDirectory=path.join(directory,'runtime-output');
    fs.mkdirSync(designDirectory);fs.mkdirSync(outputDirectory);
    const design=path.join(designDirectory,'design.html'),artifact=path.join(outputDirectory,'artifact.html');
    fs.writeFileSync(design,'<!doctype html><main><h1>Old title</h1><p>Old body</p></main><script>const script=document.createElement("script");script.src="./runtime.js";document.head.append(script);</script>');
    fs.writeFileSync(path.join(designDirectory,'runtime.js'),'throw Error("Loaded from design directory");');
    fs.writeFileSync(path.join(outputDirectory,'runtime.js'),'if(!location.pathname.endsWith("/artifact.html"))throw Error("Wrong artifact URL");document.body.dataset.runtime="output-directory";');
    const rendered=await callTool('render_markdown',{markdown:'# New title\n\nNew body',design_path:design,output_path:artifact});
    assert.equal(rendered.ok,true,JSON.stringify(rendered));
    const browser=new ChromeVisualBrowser(findChrome());
    try{
      const io=await documentBrowser(browser,artifact);await io.load(fs.readFileSync(artifact,'utf8'),{scripts:true});
      assert.equal(await io.run('document.body.dataset.runtime'),'output-directory');
      assert.deepEqual(await io.errors(),[]);
    }finally{await browser.close();}
    const before=fs.readFileSync(artifact);
    fs.unlinkSync(path.join(outputDirectory,'runtime.js'));
    fs.writeFileSync(path.join(designDirectory,'runtime.js'),'window.ready=true;');
    const failed=await callTool('render_markdown',{markdown:'# New title\n\nChanged body',design_path:design,output_path:artifact});
    assert.equal(failed.ok,false);
    assert.equal(failed.diagnostics[0].code,'document/runtime-error');
    assert.match(JSON.stringify(failed.diagnostics),/runtime\.js/);
    assert.deepEqual(fs.readFileSync(artifact),before);
  });
  await t.test('excluded controls inside replaceable blocks cannot be silently deleted',async()=>{
    const local=path.join(directory,'crossing-exclusion.html');
    for(const content of ['<p>Old copy <button id="keep">Keep control</button></p>','<ul><li>Old copy <button id="keep">Keep control</button></li></ul>']){
      const html='<main>'+content+'</main>';fs.writeFileSync(local,html);fs.writeFileSync(output,'Preserved output');
      const result=await callTool('render_markdown',{markdown:'Replacement copy',design_path:local,exclude_selector:'#keep',output_path:output});
      assert.equal(result.ok,false,JSON.stringify(result));
      assert.equal(result.diagnostics[0].code,'document/exclusion-crosses-content');
      assert.ok(result.diagnostics[0].supportedFixes.some(fix=>fix.includes('outside')));
      assert.equal(fs.readFileSync(output,'utf8'),'Preserved output');
      assert.equal(fs.readFileSync(local,'utf8'),html);
      const scanned=await callTool('scan_html',{design_path:local,exclude_selector:'#keep'});
      assert.equal(scanned.ok,false);assert.equal(scanned.diagnostics[0].code,'document/exclusion-crosses-content');
    }
  });
  await t.test('fetch relocates assets and encoding while capture leaves scripts unexecuted',async()=>{
    let executed=0;const server=http.createServer((request,response)=>{
      if(request.url==='/executed'){executed++;response.end('ok');return;}
      if(request.url==='/assets/page.css'){response.setHeader('Content-Type','text/css');response.end('main p{color:rgb(11,22,33)}');return;}
      if(request.url==='/assets/app.js'){response.setHeader('Content-Type','text/javascript');response.end('if(document.querySelector("[data]").getAttribute("data")!=="literal")throw Error("Custom data mutated");document.body.dataset.ready="true";fetch("/executed").catch(()=>{});');return;}
      if(request.url==='/binary'){response.setHeader('Content-Type','image/png');response.end('not html');return;}
      response.setHeader('Content-Type','text/html; charset=windows-1252');response.end('<!doctype html><meta charset="windows-1252"><base href="/assets/"><link rel="stylesheet" href="page.css"><script src="app.js" defer></script><div data="literal"></div><main><h1>Old</h1><p>Old</p></main>');
    });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
    const url='http://127.0.0.1:'+server.address().port+'/page';const folder=path.join(directory,'remote');const capture=await callTool('scan_html',{design_url:url,template_dir:folder});assert.equal(capture.ok,true,JSON.stringify(capture));assert.equal(executed,0);
    const html=fs.readFileSync(path.join(folder,'design.html'),'utf8');assert.match(html,/charset="utf-8"/);assert.ok(html.includes(url.replace('/page','/assets/page.css')));assert.ok(html.includes('data="literal"'));
    const result=await callTool('render_markdown',{markdown:'# 中文标题\n\n正文。',template_path:folder,output_path:output});assert.equal(result.ok,true,JSON.stringify(result));
    const browser=new ChromeVisualBrowser(findChrome());try{const io=await documentBrowser(browser,output);await io.load(fs.readFileSync(output,'utf8'),{scripts:true});assert.equal(await io.run('getComputedStyle(document.querySelector("main p")).color'),'rgb(11, 22, 33)');assert.equal(await io.run('document.querySelector("main h1").textContent'),'中文标题');assert.equal(await io.run('document.body.dataset.ready'),'true');}finally{await browser.close();}
    const rejected=await callTool('scan_html',{design_url:url.replace('/page','/binary')});assert.equal(rejected.ok,false);assert.equal(rejected.diagnostics[0].code,'document/content-type');
    const direct=await callTool('render_markdown',{markdown:'直连正文。',design_url:url,output_path:output});assert.equal(direct.ok,true,JSON.stringify(direct));
  });
});

test('template library discovery is read-only and reports an unreadable root through tool diagnostics',async t=>{
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'archify-library-')));
  t.after(()=>{assert.equal(path.dirname(directory),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(directory).startsWith('archify-library-'));fs.rmSync(directory,{recursive:true,force:true});});
  const missing=path.join(directory,'not-created');
  const empty=await callTool('list_document_templates',{library_path:missing});assert.equal(empty.ok,true);assert.equal(empty.templates.length,3);assert.deepEqual(empty.saved_templates,[]);assert.deepEqual(empty.warnings,[]);assert.equal(fs.existsSync(missing),false);
  const file=path.join(directory,'not-a-directory');fs.writeFileSync(file,'Preserved');
  const rejected=await callTool('list_document_templates',{library_path:file});assert.equal(rejected.ok,false);assert.equal(rejected.diagnostics[0].code,'document/template-library');assert.equal(fs.readFileSync(file,'utf8'),'Preserved');
  const run=spawnSync(process.execPath,[cli,'document','templates','--library-path',file,'--json'],{encoding:'utf8'});assert.equal(run.status,1,run.stderr);assert.equal(JSON.parse(run.stdout).diagnostics[0].code,'document/template-library');
  const argumentsRejected=await callTool('list_document_templates',{library_path:123});assert.equal(argumentsRejected.ok,false);
});
