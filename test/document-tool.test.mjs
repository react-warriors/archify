import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { callDocumentTool } from '../archify/document/tool.mjs';

test('document tool exposes the shared renderer without agent-specific inputs', async (t) => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'archify-document-tool-')));
  t.after(() => {
    assert.equal(path.dirname(directory), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('archify-document-tool-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const design = path.join(directory, 'design.html');
  const output = path.join(directory, 'output with space.html');
  const markdown = path.join(directory, 'source.md');
  const original = '<!doctype html><title>Old</title><main><h1>Old title</h1><p>Old paragraph</p></main><script>window.ready=true</script>';
  fs.writeFileSync(design, original);
  fs.writeFileSync(markdown, '# 文件正文\n\n新段落。');
  const base = { design_path: design, output_path: output };

  await t.test('invalid UTF-8 is rejected before replacing output',async()=>{
    const invalid=path.join(directory,'invalid.md');fs.writeFileSync(invalid,Buffer.from([0xc3,0x28]));fs.writeFileSync(output,'Preserved output');
    const result=await callDocumentTool({...base,markdown_path:invalid});assert.equal(result.ok,false);assert.equal(result.diagnostics[0].code,'document/source-encoding');assert.equal(fs.readFileSync(output,'utf8'),'Preserved output');
  });

  await t.test('inline Markdown returns the published file and its actual checksum', async () => {
    const result = await callDocumentTool({ ...base, markdown: '# 直接正文\n\n新段落。' });
    assert.equal(result.ok, true, JSON.stringify(result));
    const bytes = fs.readFileSync(output);
    assert.equal(result.output.path, output);
    assert.equal(fileURLToPath(result.output.url), output);
    assert.equal(result.output.bytes, bytes.length);
    assert.equal(result.output.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.match(bytes.toString(), />直接正文<\/h1>/);
    assert.match(bytes.toString(), /window.ready=true/);
  });

  await t.test('file input uses the same published content as the existing CLI', async () => {
    const result = await callDocumentTool({ ...base, markdown_path: markdown });
    assert.equal(result.ok, true, JSON.stringify(result));
    const cliOutput = path.join(directory, 'cli.html');
    const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [cli, 'document', markdown, cliOutput, '--design', design], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(fs.readFileSync(output, 'utf8'), fs.readFileSync(cliOutput, 'utf8'));
  });

  await t.test('ambiguous sources and unsupported arguments fail before writing output', async () => {
    const before = fs.readFileSync(output);
    for (const args of [{ ...base }, { ...base, markdown: '', markdown_path: markdown }, { ...base, markdown: '', agent: 'specific-client' }, { ...base, markdown:'', design_options:null }, { ...base, markdown:'', design_options:[] }, null]) {
      const result = await callDocumentTool(args);
      assert.equal(result.ok, false);
      assert.equal(result.diagnostics[0].code, 'document/tool-arguments');
      assert.deepEqual(fs.readFileSync(output), before);
    }
  });

  await t.test('declared design options remain JSON data and match the CLI without changing unrelated HTML', async () => {
    const config = { density:'compact', note:'</script><script>window.injected=true</script>' };
    const configured = '<!doctype html><head><script type="application/json" data-document-options>{"density":"regular","retained":true}</script></head><main><h1>Old</h1><p>Old</p></main><script>window.config=JSON.parse(document.querySelector("[data-document-options]").textContent);if(window.injected)throw Error("Configuration executed as script");</script>';
    fs.writeFileSync(design, configured);
    const result = await callDocumentTool({ ...base, markdown_path:markdown, design_options:config });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.report.designOptionsApplied, true);
    const html = fs.readFileSync(output,'utf8');
    const serialized = /<script type="application\/json" data-document-options[^>]*>([\s\S]*?)<\/script>/.exec(html)[1];
    assert.deepEqual(JSON.parse(serialized), { ...config, retained:true });
    assert.ok(!serialized.includes('<'));
    const options = path.join(directory,'options.json'); fs.writeFileSync(options,JSON.stringify(config));
    const cli = fileURLToPath(new URL('../archify/bin/archify.mjs',import.meta.url));
    const cliOutput = path.join(directory,'configured.html');
    const run = spawnSync(process.execPath,[cli,'document',markdown,cliOutput,'--design',design,'--design-options',options],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    assert.equal(fs.readFileSync(cliOutput,'utf8'),html);
    const before = fs.readFileSync(options);
    const collision = spawnSync(process.execPath,[cli,'document',markdown,options,'--design',design,'--design-options',options],{encoding:'utf8'});
    assert.notEqual(collision.status,0);
    assert.deepEqual(fs.readFileSync(options),before);
    fs.writeFileSync(options,'[]');
    const invalid = spawnSync(process.execPath,[cli,'document',markdown,cliOutput,'--design',design,'--design-options',options],{encoding:'utf8'});
    assert.notEqual(invalid.status,0);
    assert.equal(fs.readFileSync(cliOutput,'utf8'),html);
    fs.writeFileSync(design,original);
    const plain = await callDocumentTool({ ...base,markdown_path:markdown });
    assert.equal(plain.ok,true);
    const unchanged = fs.readFileSync(output,'utf8');
    const ignored = await callDocumentTool({ ...base,markdown_path:markdown,design_options:{link_previews:true} });
    assert.equal(ignored.ok,true);
    assert.equal(ignored.report.designOptionsApplied,false);
    assert.equal(fs.readFileSync(output,'utf8'),unchanged);
  });

  await t.test('failed initialization keeps the previous output and reports its cause', async () => {
    const before = fs.readFileSync(output);
    fs.writeFileSync(design, '<main><p>Old</p></main><script>throw new Error("missing measurements")</script>');
    const result = await callDocumentTool({ ...base, markdown: 'New content' });
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics[0].code, 'document/runtime-error');
    assert.match(result.diagnostics[0].supportedFixes[0], /initialization script/);
    assert.deepEqual(fs.readFileSync(output), before);
    fs.writeFileSync(design, original);
  });

  await t.test('input collisions and cancellation preserve the design', async () => {
    const collision = await callDocumentTool({ ...base, markdown: 'Content', output_path: design });
    assert.equal(collision.ok, false);
    assert.match(collision.diagnostics[0].code, /^output\//);
    const controller = new AbortController(); controller.abort();
    const cancelled = await callDocumentTool({ ...base, markdown: 'Content' }, { signal: controller.signal });
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.diagnostics[0].code, 'document/cancelled');
    assert.equal(fs.readFileSync(design, 'utf8'), original);
  });

  await t.test('JSON command-line requests produce machine-readable success and failure', () => {
    const entry = fileURLToPath(new URL('../archify/bin/document-tool.mjs', import.meta.url));
    const malformed = spawnSync(process.execPath, [entry], { input: '{', encoding: 'utf8' });
    assert.equal(malformed.status, 1);
    assert.equal(JSON.parse(malformed.stdout).diagnostics[0].code, 'document/tool-request');
    const rendered = spawnSync(process.execPath, [entry], { input: JSON.stringify({ ...base, markdown: '# JSON 正文\n\nContent' }), encoding: 'utf8' });
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.equal(JSON.parse(rendered.stdout).ok, true);
    assert.match(fs.readFileSync(output, 'utf8'), /JSON 正文/);
  });

  await t.test('the public document CLI returns JSON diagnostics on failed rendering',()=>{
    const cli=fileURLToPath(new URL('../archify/bin/archify.mjs',import.meta.url));
    fs.writeFileSync(output,'Preserved output');
    for(const html of [null,'<main><p>Old</p></main><script>throw Error("missing inputs")</script>']){
      const selected=html===null?path.join(directory,'missing.html'):design;
      if(html!==null)fs.writeFileSync(design,html);
      const run=spawnSync(process.execPath,[cli,'document',markdown,output,'--design',selected,'--json'],{encoding:'utf8'});
      assert.equal(run.status,1,run.stderr);const response=JSON.parse(run.stdout);assert.equal(response.ok,false);assert.ok(response.diagnostics.length);
      assert.equal(fs.readFileSync(output,'utf8'),'Preserved output');
    }
    fs.writeFileSync(design,original);
  });

  await t.test('document argument errors retain machine-readable JSON and previous output',()=>{
    const cli=fileURLToPath(new URL('../archify/bin/archify.mjs',import.meta.url));
    fs.writeFileSync(output,'Preserved output');
    const cases=[
      [[markdown,output,'--design','--json'],'cli/missing-option-value'],
      [[markdown,output,'--design',design,'--design',design,'--json'],'cli/duplicate-option'],
      [[markdown,output,'--bogus','--json'],'cli/unknown-option'],
      [['--json'],'cli/usage'],
      [['templates','extra','--json'],'cli/usage'],
      [['scan','--json'],'cli/usage'],
      [[markdown,output,'--quality','hero','--json'],'cli/invalid-option-value'],
      [[markdown,output,'--repo-root','--json'],'cli/missing-option-value'],
    ];
    for(const [args,code] of cases){
      const run=spawnSync(process.execPath,[cli,'document',...args],{encoding:'utf8'});
      assert.equal(run.status,2,run.stderr||run.stdout);assert.equal(run.stderr,'');
      const result=JSON.parse(run.stdout);assert.equal(result.ok,false);assert.equal(result.command,'document');
      assert.equal(result.stage,'arguments');assert.equal(result.diagnostics[0].code,code);
      assert.ok(result.diagnostics[0].supportedFixes.length);
      assert.equal(fs.readFileSync(output,'utf8'),'Preserved output');
    }
    const plain=spawnSync(process.execPath,[cli,'document',markdown,output,'--bogus'],{encoding:'utf8'});
    assert.equal(plain.status,2);assert.equal(plain.stdout,'');assert.match(plain.stderr,/Unknown document option/);
  });

  await t.test('unavailable Chrome returns diagnostics without allocating profiles for rendering or scanning',()=>{
    const profiles=path.join(directory,'profiles');fs.mkdirSync(profiles);
    const env={...process.env,ARCHIFY_CHROME:path.join(directory,'missing-chrome'),TMPDIR:profiles,TMP:profiles,TEMP:profiles};
    const entry=fileURLToPath(new URL('../archify/bin/document-tool.mjs',import.meta.url));
    fs.writeFileSync(output,'Preserved output');
    for(const request of [{tool:'render_markdown',arguments:{...base,markdown:'Body'}},{tool:'scan_html',arguments:{design_path:design}}]){
      const run=spawnSync(process.execPath,[entry],{input:JSON.stringify(request),encoding:'utf8',env});
      assert.equal(run.status,1,run.stderr);const response=JSON.parse(run.stdout);assert.equal(response.ok,false);assert.equal(response.diagnostics[0].code,'document/chrome-unavailable');
      assert.deepEqual(fs.readdirSync(profiles),[]);assert.equal(fs.readFileSync(output,'utf8'),'Preserved output');
    }
  });
});
