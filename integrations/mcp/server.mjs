#!/usr/bin/env node
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { documentTools, callTool } from '../../archify/document/tool.mjs';
import fs from 'node:fs';

const { version } = JSON.parse(fs.readFileSync(new URL('../../archify/package.json', import.meta.url), 'utf8'));
serveStdio(() => {
  const server = new McpServer({ name: 'archify-document', version });
  for (const {name,inputSchema,...definition} of documentTools) {
    server.registerTool(name, { ...definition, inputSchema: fromJsonSchema(inputSchema) }, async (args, context) => {
      const result = await callTool(name,args, { signal: context.signal });
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: !result.ok };
    });
  }
  return server;
});
