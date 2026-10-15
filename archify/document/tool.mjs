import { renderDocument } from './files.mjs';
import { scanFixes } from './scan.mjs';
import { inspectDesign, templateCatalog, defaultTemplate, listDocumentTemplates } from './templates.mjs';

export const documentTool = {
  name: 'render_markdown',
  title: 'Render Markdown using an HTML design',
  description: 'Render Markdown text or a Markdown file into the layout of a supplied HTML file. Returns the saved HTML path, checksum and render report. The HTML supplies its own styles and scripts. Requires local Chrome. Output cannot overwrite either input file. Missing inputs or failed page initialization return diagnostics and preserve previous output.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      markdown: { type: 'string', description: 'Markdown text, including an empty document. Supply this or markdown_path.' },
      markdown_path: { type: 'string', minLength: 1, description: 'Markdown file path. Relative paths use the server working directory.' },
      design_path: { type: 'string', minLength: 1, description: 'Custom local HTML design. Choose this, design_url, template or template_path.' },
      design_url: { type:'string', minLength:1, description:'HTTP(S) HTML design URL. Relative resources keep their source URLs.' },
      template: { type:'string', enum:templateCatalog.map(template=>template.id), description:'Built-in family/variant ID. Defaults to '+defaultTemplate+'.' },
      template_path: { type:'string', minLength:1, description:'Saved template directory or template.json path.' },
      exclude_selector: {type:'string',minLength:1,description:'Optional CSS selector for regions to preserve outside Markdown content, such as a site toolbar or footer.'},
      content_selector: { type:'string', minLength:1, description:'Optional CSS selector naming exactly one content root. This selects structure, not prose meaning.' },
      output_path: { type: 'string', minLength: 1, description: 'HTML output path. Existing regular output may be replaced after successful rendering.' },
      title: { type: 'string', description: 'Fallback browser title when Markdown has no H1.' },
      design_options: { type: 'object', additionalProperties: true, description: 'Optional JSON configuration for designs declaring a data-document-options entry. Option names and behavior belong to that HTML design.' },
    },
    required: ['output_path'],
    oneOf: [{ required: ['markdown'] }, { required: ['markdown_path'] }],
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
};

function checkArguments(args) {
  const invalid = (message, argument, fix) => { throw Object.assign(new Error(message), { argument, fix }); };
  if (!args || typeof args !== 'object' || Array.isArray(args)) invalid('Arguments must be an object.', 'request', 'send a JSON object matching the render_markdown input schema');
  const designs=['design_path','design_url','template','template_path'].filter(key=>Object.hasOwn(args,key));
  if(designs.length>1)invalid('Choose only one design source.','design_path','keep one of design_path, design_url, template or template_path');
  for (const key of Object.keys(args)) if (!Object.hasOwn(documentTool.inputSchema.properties, key)) invalid('Unknown argument: ' + key, key, 'remove the unsupported argument ' + key);
  for (const key of documentTool.inputSchema.required) if (typeof args[key] !== 'string' || !args[key]) invalid(key + ' must be a nonempty string.', key, 'set ' + key + ' to a filesystem path');
  const sources = ['markdown', 'markdown_path'].filter(key => Object.hasOwn(args, key));
  if (sources.length !== 1) invalid('Supply exactly one of markdown and markdown_path.', 'markdown', 'send Markdown text in markdown or a file path in markdown_path, omitting the other field');
  for (const [key, value] of Object.entries(args)) {
    const schema = documentTool.inputSchema.properties[key];
    const valid = schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : typeof value === schema.type && value.length >= (schema.minLength || 0);
    if (!valid) invalid('Invalid argument: ' + key, key, 'set ' + key + ' to ' + (schema.type === 'object' ? 'a JSON object' : schema.minLength ? 'a nonempty string' : 'a string'));
  }
}

export async function callDocumentTool(args, { signal } = {}) {
  try { checkArguments(args); }
  catch (error) { return { ok: false, diagnostics: [{ code: 'document/tool-arguments', severity: 'error', message: error.message,
    subject: { argument: error.argument }, evidence: { reason: error.message }, supportedFixes: [error.fix] }] }; }
  try {
    return await renderDocument({ inputPath: args.markdown_path, markdown: args.markdown,
      designPath: args.design_path, designURL:args.design_url, template:args.template, templatePath:args.template_path, contentSelector:args.content_selector,excludeSelector:args.exclude_selector, outputPath: args.output_path, title: args.title, designOptions: args.design_options, signal });
  } catch (error) {
    return { ok: false, diagnostics: error.archifyDiagnostics || [{
      code: signal?.aborted ? 'document/cancelled' : 'document/tool-failed', severity: 'error', message: error.message,
      subject: { output: args.output_path }, evidence: { errorName: error.name },
      supportedFixes: signal?.aborted ? ['retry with a new request if rendering is still wanted'] : ['check the reported error and verify that local Chrome and the output directory are available'],
    }] };
  }
}

export const scanTool={name:'scan_html',title:'Inspect and save an HTML design',description:'Fetch an HTTP(S) page or read a local HTML file, scan its content positions without executing page scripts, and optionally save design.html plus a checksum-bound template.json in a new directory.',inputSchema:{type:'object',additionalProperties:false,properties:{design_path:{type:'string',minLength:1},design_url:{type:'string',minLength:1},template:{type:'string',enum:templateCatalog.map(template=>template.id)},template_path:{type:'string',minLength:1},content_selector:{type:'string',minLength:1},exclude_selector:{type:'string',minLength:1},template_dir:{type:'string',minLength:1,description:'New output directory. Existing directories are preserved.'}}},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}};
export const listTemplatesTool={name:'list_document_templates',title:'List built-in and saved document designs',description:'List the three built-in designs and saved templates in the user library. Returns template_path values for reuse without fetching the original HTML. Does not create directories or run page scripts.',inputSchema:{type:'object',properties:{library_path:{type:'string',minLength:1,description:'Template library directory. Defaults to .archify/templates under the current user home. Saved templates are immediate child directories containing template.json and design.html.'}},additionalProperties:false},annotations:{readOnlyHint:true,idempotentHint:true,openWorldHint:false}};
export const documentTools=[documentTool,scanTool,listTemplatesTool];
export async function callTool(name,args,{signal}={}){
  if(name==='render_markdown')return callDocumentTool(args,{signal});
  const definition=documentTools.find(tool=>tool.name===name);
  if(!definition)return {ok:false,diagnostics:[{code:'document/tool-unknown',severity:'error',message:'Unknown document tool.',subject:{name},supportedFixes:['use a tool returned by discovery']}]};
  try{
    if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Arguments must be an object.');
    for(const [key,value]of Object.entries(args)){const schema=definition.inputSchema.properties[key];if(!schema||typeof value!=='string'||!value)throw Error('Invalid argument: '+key);}
    if(name==='list_document_templates')return await listDocumentTemplates({libraryPath:args.library_path});
    const choices=['design_path','design_url','template','template_path'].filter(key=>args[key]!==undefined);if(choices.length>1)throw Error('Choose one design source.');
    const result=await inspectDesign({designPath:args.design_path,designURL:args.design_url,template:args.template,templatePath:args.template_path,contentSelector:args.content_selector,excludeSelector:args.exclude_selector,templateDir:args.template_dir,signal});
    if(!result.ok)result.diagnostics=result.report.unmet.map(({code,...evidence})=>({code,severity:'error',message:'The HTML structure could not be scanned.',subject:{stage:'scan'},evidence,supportedFixes:scanFixes(code)}));
    return result;
  }catch(error){return {ok:false,diagnostics:error.archifyDiagnostics||[{code:signal?.aborted?'document/cancelled':'document/scan-failed',severity:'error',message:error.message,subject:{tool:name},evidence:{errorName:error.name},supportedFixes:['verify the design source, Chrome and template directory, then retry']}]};}
}
