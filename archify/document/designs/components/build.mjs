import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {presets} from './presets.mjs';

const dir=path.dirname(fileURLToPath(import.meta.url));
const packageRoot=path.resolve(dir,'../../..'),repoRoot=path.dirname(packageRoot);
const req=createRequire(path.join(repoRoot,'package.json')),p=req('parse5');
const walk=(node,fn)=>{fn(node);for(const child of node.childNodes||[])walk(child,fn);};
const text=node=>node.nodeName==='#text'?node.value:(node.childNodes||[]).map(text).join('');
const attr=node=>Object.fromEntries((node.attrs||[]).map(item=>[item.name,item.value]));
const sourceCss=fs.readFileSync(path.join(repoRoot,'viewer/viewer.css'),'utf8');
const theme=sourceCss.slice(0,sourceCss.indexOf('/* ==========================================================',100));
const paint=sourceCss.slice(sourceCss.indexOf('.c-grid '),sourceCss.indexOf('/* Stable semantic exploration hooks'));
const boundary=sourceCss.split('\n').filter(line=>/^\.c-(security-group|region|lane)\s/.test(line.trim())).join('\n');
const stage=fs.mkdtempSync(path.join(tmpdir(),'archify-components-')),templates=[];
try{
  for(const preset of presets){
    const model={schema_version:{architecture:1,workflow:2,tree:1,lifecycle:3}[preset.type],diagram_type:preset.type,
      meta:{title:preset.title,output:'native.html',locale:'zh-CN',animation:'none',visual_preset:'classic',...(preset.type==='tree'?{}:{legend:{mode:'hidden'}})},...structuredClone(preset.model)};
    // Reserve paragraph space through the native tree's own text measurement.
    if(preset.type==='tree')model.nodes.forEach(node=>node.sublabel=node.sublabel.repeat(2));
    const input=path.join(stage,'input.json'),output=path.join(stage,'native.html');fs.writeFileSync(input,JSON.stringify(model));
    const rendered=spawnSync(process.execPath,[path.join(packageRoot,'renderers',preset.type,'render-'+preset.type+'.mjs'),input,output],{cwd:stage,encoding:'utf8',timeout:120000});
    if(rendered.status!==0)throw Error(preset.id+': '+rendered.stderr+rendered.stdout);
    let svg;walk(p.parse(fs.readFileSync(output,'utf8')),node=>{if(node.tagName==='div'&&String(attr(node).class).split(' ').includes('diagram-container'))svg=(node.childNodes||[]).find(child=>child.tagName==='svg');});
    if(!svg)throw Error('No native SVG for '+preset.id);
    templates.push(`<template id="recipe-${preset.id}">${p.serializeOuter(svg)}</template>`);
  }
}finally{
  const relative=path.relative(path.resolve(tmpdir()),path.resolve(stage));
  if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(stage).startsWith('archify-components-'))fs.rmSync(stage,{recursive:true,force:true});
}
const faces=[];walk(p.parse(fs.readFileSync(path.join(packageRoot,'assets/template.html'),'utf8')),node=>{if(node.tagName==='style'&&text(node).includes('@font-face')&&!text(node).includes('.c-grid'))faces.push(text(node));});
const logo=fs.readFileSync(path.join(repoRoot,'docs/assets/archify-lockup-light.svg'),'utf8').replace('id="title"','').replace('role="img" aria-labelledby="title"','aria-hidden="true"');
const chapters=[1,2,3].map(i=>`<section class="chapter"><header><h2>章节 ${i}</h2></header><div class="chapter-body"><p>章节内容</p></div></section>`).join('');
const css=[theme,paint,boundary,...faces,fs.readFileSync(path.join(dir,'component.css'),'utf8')].join('\n');
const recipes=presets.map(({id,title,type,compact,slots})=>({id,title,type,compact,slots}));
const html=`<!doctype html><html lang="zh-CN" data-theme="light" data-preset="classic"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Archify document</title><style>${css}</style></head><body><header class="native-page native-brand"><div role="img" aria-label="Archify">${logo}</div><span>DOCUMENT</span></header><main class="native-page"><header class="hero"><h1>文档标题</h1><p>文档引言</p></header>${chapters}</main>${templates.join('\n')}<script type="application/json" id="component-recipes">${JSON.stringify(recipes).replaceAll('<','\\u003c')}</script><script type="application/json" data-document-diagnostics>[]</script><script>${fs.readFileSync(path.join(dir,'component.js'),'utf8')}</script></body></html>\n`.replace(/\r\n/g,'\n').replace(/[ \t]+$/gm,'');
const output=path.join(dir,'native.html');
if(process.argv.includes('--check')){
  if(!fs.existsSync(output)||fs.readFileSync(output,'utf8').replace(/\r\n/g,'\n')!==html){console.error('native.html is stale; regenerate in a repository checkout with node archify/document/designs/components/build.mjs.');process.exitCode=1;}
  else console.log('Native document component HTML is current.');
}else{fs.writeFileSync(output,html);console.log('Built native document component HTML.');}
