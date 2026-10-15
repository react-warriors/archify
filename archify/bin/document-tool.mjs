#!/usr/bin/env node
import fs from 'node:fs';
import { documentTool, documentTools, callTool } from '../document/tool.mjs';

let result;
try {
  if (process.argv[2] === '--schema') {
    result = documentTools.find(tool => tool.name === (process.argv[3] || documentTool.name));
    if (!result) result = await callTool(process.argv[3], {});
  }
  else if (process.argv[2] === '--schemas') result = documentTools;
  else {
    const input = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : 0;
    const request = JSON.parse(fs.readFileSync(input, 'utf8'));
    result = await callTool(request.tool || 'render_markdown', request.tool ? request.arguments : request);
  }
} catch (error) {
  result = { ok: false, diagnostics: [{ code: 'document/tool-request', severity: 'error', message: error.message,
    subject: { input: process.argv[2] || 'stdin' }, evidence: { errorName: error.name },
    supportedFixes: ['send readable JSON matching the schema printed by --schema'] }] };
}
process.stdout.write(JSON.stringify(result) + '\n');
if (result.ok === false) process.exitCode = 1;
