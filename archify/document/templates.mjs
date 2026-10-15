import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readHTML,relocateHTML,sourceError} from './html-source.mjs';
import {documentBrowser,createDocumentBrowser} from './browser.mjs';
import {scan} from './scan.mjs';
import {removeOwnedRegularFile} from '../renderers/shared/atomic-output.mjs';

export const defaultTemplate='review/static';
const families=[['decision','决策简报'],['analysis','分析札记'],['review','进展复盘']];
export const templateCatalog=families.map(([family,title])=>({id:family+'/static',title,variant:'static',path:fileURLToPath(new URL('./designs/'+family+'.html',import.meta.url))}));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function listDocumentTemplates({libraryPath=path.join(os.homedir(),'.archify','templates')}={}){
  const directory=path.resolve(libraryPath),saved=[],warnings=[];
  let entries;
  try{entries=fs.readdirSync(directory,{withFileTypes:true});}
  catch(error){
    if(error.code==='ENOENT')entries=[];
    else sourceError('document/template-library','The template library could not be read.',{directory,reason:error.code},'choose a readable template library directory');
  }
  for(const entry of entries.filter(entry=>entry.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){
    const manifest=path.join(directory,entry.name,'template.json');
    try{
      try{fs.statSync(manifest);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      const source=await resolveDesign({templatePath:manifest});
      saved.push({name:entry.name,path:manifest,design_path:source.designPath,source:source.template.source});
    }catch(error){
      warnings.push({code:'document/template-unavailable',severity:'warning',message:'A saved template could not be loaded.',subject:{name:entry.name,path:manifest},evidence:{reason:error.archifyDiagnostics?.[0]?.code||error.code||error.name}});
    }
  }
  return {ok:true,default:defaultTemplate,templates:templateCatalog,library_path:directory,saved_templates:saved,warnings};
}

export async function resolveDesign(request){
  const choices=['designPath','designURL','template','templatePath'].filter(key=>request[key]!==undefined);
  if(choices.length>1)sourceError('document/design-ambiguous','Choose one HTML file, URL, template ID or saved template.',{arguments:choices});
  if(request.templatePath){
    const selected=path.resolve(request.templatePath),manifest=fs.statSync(selected).isDirectory()?path.join(selected,'template.json'):selected;
    const record=JSON.parse(fs.readFileSync(manifest,'utf8'));
    if(!record||record.format!=='archify-document-template'||record.version!==1||record.design!=='design.html'||!/^([a-f0-9]{64})$/.test(record.sha256||'')||record.contentSelector!==undefined&&typeof record.contentSelector!=='string'||record.excludeSelector!==undefined&&typeof record.excludeSelector!=='string')sourceError('document/template-invalid','The saved template manifest is invalid.',{manifest});
    const designPath=path.join(path.dirname(manifest),'design.html'),html=fs.readFileSync(designPath,'utf8');
    if(digest(Buffer.from(html))!==record.sha256)sourceError('document/template-changed','The HTML no longer matches its saved template.',{manifest},'scan the edited HTML into a new template, or pass it directly as design_path');
    return {html,designPath,sourceURL:pathToFileURL(designPath).href,protectedInputs:[designPath,manifest],contentSelector:request.contentSelector??record.contentSelector,excludeSelector:request.excludeSelector??record.excludeSelector,template:record};
  }
  if(!request.designPath&&!request.designURL){
    const id=request.template||defaultTemplate,record=templateCatalog.find(template=>template.id===id);
    if(!record)sourceError('document/template-unknown','Unknown built-in template.',{id},'select an ID returned by list_document_templates');
    return {...await readHTML({designPath:record.path,signal:request.signal}),templateId:id,contentSelector:request.contentSelector,excludeSelector:request.excludeSelector};
  }
  return {...await readHTML(request),contentSelector:request.contentSelector,excludeSelector:request.excludeSelector};
}

export async function inspectDesign(request){
  const source=await resolveDesign(request);request.signal?.throwIfAborted();
  const browser=createDocumentBrowser(),abort=()=>{void browser.close().catch(()=>{});};request.signal?.addEventListener('abort',abort,{once:true});
  try{
    // Remote HTML is inspected in an empty local document with rebased assets.
    const location=source.designPath||fileURLToPath(new URL('./default.html',import.meta.url));
    const io=await documentBrowser(browser,location);
    if(request.templateDir||source.relocateResources)Object.assign(source,await relocateHTML(io,source.html,source.sourceURL));
    const result=await scan(io,source.html,{contentSelector:source.contentSelector,excludeSelector:source.excludeSelector});
    if(!result.ok)return {ok:false,report:result};
    const {snapshot,...description}=result;
    const record={format:'archify-document-template',version:1,design:'design.html',sha256:digest(Buffer.from(source.html)),source:source.sourceURL||source.template?.source,contentSelector:source.contentSelector,excludeSelector:source.excludeSelector,scan:description,resources:source.resources};
    if(request.templateDir){
      const directory=path.resolve(request.templateDir);fs.mkdirSync(path.dirname(directory),{recursive:true});
      try{fs.mkdirSync(directory);}catch(error){sourceError('document/template-destination','The template destination must be a new directory.',{directory,reason:error.code},'choose a new directory; existing templates are preserved');}
      const folderIdentity=fs.lstatSync(directory,{bigint:true}),owned=[];
      try{
        for(const [name,content]of [['design.html',source.html],['template.json',JSON.stringify(record,null,2)+'\n']]){
          request.signal?.throwIfAborted();const file=path.join(directory,name);fs.writeFileSync(file,content,{flag:'wx'});const stat=fs.lstatSync(file,{bigint:true});owned.push({file,device:stat.dev,inode:stat.ino});
        }
      }catch(error){
        for(const item of owned)removeOwnedRegularFile(item.file,{device:item.device,inode:item.inode},{subject:'document-template'});
        try{const current=fs.lstatSync(directory,{bigint:true});if(current.dev===folderIdentity.dev&&current.ino===folderIdentity.ino)fs.rmdirSync(directory);}catch{}
        throw error;
      }
      return {ok:true,template:{...record,path:path.join(directory,'template.json')},report:{mode:result.mode,slots:result.slots.length,units:result.units.length}};
    }
    return {ok:true,template:record,report:{mode:result.mode,slots:result.slots.length,units:result.units.length}};
  }finally{request.signal?.removeEventListener('abort',abort);await browser.close();}
}
