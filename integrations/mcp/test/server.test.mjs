import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('a standard MCP client discovers and invokes the document renderer over stdio', async (t) => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'archify-mcp-')));
  t.after(() => {
    assert.equal(path.dirname(directory), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('archify-mcp-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const server = fileURLToPath(new URL('../server.mjs', import.meta.url));
  const design = path.join(directory, 'design.html');
  const output = path.join(directory, 'result.html');
  const original = '<head><script type="application/json" data-document-options>{}</script></head><main><h1>Placeholder</h1><p>Placeholder</p></main>';
  fs.writeFileSync(design, original);
  for (const mode of ['auto', 'legacy']) {
    const client = new Client({ name: 'independent-test-client', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StdioClientTransport({ command: process.execPath, args: [server] });
    try {
      await client.connect(transport);
      assert.equal(client.getProtocolEra(), mode === 'auto' ? 'modern' : 'legacy');
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map(tool => tool.name), ['render_markdown','scan_html','list_document_templates']);
      const catalog = await client.callTool({name:'list_document_templates',arguments:{}});
      assert.equal(catalog.structuredContent.templates.length,3);
      const capture = await client.callTool({name:'scan_html',arguments:{design_path:design,template_dir:path.join(directory,mode)}});
      assert.equal(capture.structuredContent.ok,true,JSON.stringify(capture));
      const saved = await client.callTool({name:'list_document_templates',arguments:{library_path:directory}});
      assert.equal(saved.structuredContent.ok,true,JSON.stringify(saved));
      const selected = saved.structuredContent.saved_templates.find(template=>template.name===mode);
      assert.ok(selected,'the captured template should be discoverable through MCP');
      const result = await client.callTool({ name: 'render_markdown', arguments: { markdown: '# 标准工具调用\n\n正文。', template_path:selected.path, output_path: output, design_options:{density:'compact'} } });
      assert.equal(result.isError, false, JSON.stringify(result));
      assert.equal(result.structuredContent.ok, true);
      assert.equal(result.structuredContent.output.path, output);
      assert.match(fs.readFileSync(output, 'utf8'), /标准工具调用/);
      assert.match(fs.readFileSync(output,'utf8'), /"density":"compact"/);
      assert.equal(result.structuredContent.report.designOptionsApplied,true);
      const before = fs.readFileSync(output);
      fs.writeFileSync(design, '<main><p>Placeholder</p></main><script>throw Error("input unavailable")</script>');
      const failed = await client.callTool({ name: 'render_markdown', arguments: { markdown: '正文', design_path: design, output_path: output } });
      assert.equal(failed.isError, true);
      assert.equal(failed.structuredContent.diagnostics[0].code, 'document/runtime-error');
      assert.deepEqual(fs.readFileSync(output), before);
      assert.equal((await client.listTools()).tools.length, 3);
      fs.writeFileSync(design, original);
    } finally { await client.close(); }
  }
});
