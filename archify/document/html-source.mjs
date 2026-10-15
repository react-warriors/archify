import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {throwDiagnosticError} from '../renderers/shared/diagnostics.mjs';

const limit=8*1024*1024;
function decodeHTML(bytes,type=''){
  const signature=bytes.subarray(0,3).toString('hex');
  const bom=signature==='efbbbf'?'utf-8':signature.startsWith('fffe')?'utf-16le':signature.startsWith('feff')?'utf-16be':undefined;
  const header=/charset\s*=\s*["']?([^;"'\s]+)/i.exec(type)?.[1];
  const prefix=bytes.subarray(0,1024).toString('latin1').replace(/<!--[\s\S]*?(?:-->|$)/g,'');
  const meta=/<meta\b[^>]*\bcharset\s*=\s*["']?\s*([a-z0-9_-]+)/i.exec(prefix)?.[1];
  const encoding=bom||header||meta||'utf-8';
  try{return new TextDecoder(encoding,{fatal:true}).decode(bytes);}
  catch{sourceError('document/html-encoding','The HTML encoding could not be decoded.',{encoding},'provide HTML with a supported, correctly declared character encoding');}
}
export function sourceError(code,message,evidence={},fix='check the HTML input and retry'){
  throwDiagnosticError(message,[{code,severity:'error',message,subject:{stage:'html-source'},evidence,supportedFixes:[fix]}]);
}
function relocatePage({html,sourceURL}) {
  const absolute=(value,base)=>{if(!value||value.startsWith('#')||/^(data|javascript|mailto|tel):/i.test(value))return value;try{return new URL(value,base).href;}catch{return value;}};
  const cssURLs=(css,base)=>css.replace(/url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi,(_all,_quote,quoted,plain)=>'url('+JSON.stringify(absolute((quoted??plain).trim(),base))+')').replace(/(@import\s+)(["'])(.*?)\2/gi,(_all,prefix,_quote,value)=>prefix+JSON.stringify(absolute(value,base)));
  const srcsetURLs=(value,base)=>{
    let output='',at=0;
    const space=character=>/[\t\n\f\r ]/.test(character);
    while(at<value.length){
      const separator=at;
      while(at<value.length&&(space(value[at])||value[at]===','))at++;
      output+=value.slice(separator,at);
      const start=at;
      while(at<value.length&&!space(value[at]))at++;
      const token=value.slice(start,at),url=token.replace(/,+$/,'');
      output+=absolute(url,base)+token.slice(url.length);
      if(token.endsWith(','))continue;
      const descriptors=at;let parens=false;
      while(at<value.length){
        const character=value[at++];
        if(character==='(')parens=true;
        else if(character===')')parens=false;
        else if(character===','&&!parens)break;
      }
      output+=value.slice(descriptors,at);
    }
    return output;
  };
  const doc=new DOMParser().parseFromString(html,'text/html'),nodes=[];
  const visit=root=>{for(const node of root.querySelectorAll('*')){nodes.push(node);if(node.localName==='template')visit(node.content);}};visit(doc);
  const bases=nodes.filter(node=>node.localName==='base');
  const originalBase=bases.find(node=>node.hasAttribute('href'))?.getAttribute('href');
  const base=originalBase?absolute(originalBase,sourceURL):sourceURL;
  for(const node of bases)node.removeAttribute('href');
  let remote=0,local=0;
  for(const node of nodes){
    for(const attr of [...node.attributes]){
      if((['src','href','poster'].includes(attr.name)||attr.name==='action'&&node.localName==='form'||attr.name==='data'&&node.localName==='object')&&node.localName!=='base'){
        attr.value=absolute(attr.value,base);if(attr.name!=='href'||node.localName==='link'){if(/^https?:/.test(attr.value))remote++;else if(attr.value.startsWith('file:'))local++;}
      }else if(attr.name==='style')attr.value=cssURLs(attr.value,base);
      else if(attr.name==='srcset')attr.value=srcsetURLs(attr.value,base);
      if(node.localName==='meta'&&attr.name==='charset')attr.value='utf-8';
    }
    if(node.localName==='meta'&&node.getAttribute('http-equiv')?.toLowerCase()==='content-type')node.setAttribute('content','text/html; charset=utf-8');
    if(node.localName==='style')node.textContent=cssURLs(node.textContent,base);
  }
  if(!doc.querySelector('meta[charset]')){const meta=doc.createElement('meta');meta.setAttribute('charset','utf-8');doc.head.prepend(meta);}
  return {html:'<!doctype html>\n'+doc.documentElement.outerHTML,resources:{remote,local},baseURL:base};
}

// 使用与扫描器相同的浏览器解析 HTML；解析文档不会执行其中的脚本。
export async function relocateHTML(io,html,sourceURL){
  return io.run('('+relocatePage.toString()+')('+JSON.stringify({html,sourceURL})+')');
}

export async function readHTML({designPath,designURL,signal}){
  signal?.throwIfAborted();
  if(!designURL){const file=path.resolve(designPath);const bytes=fs.readFileSync(file);if(bytes.length>limit)sourceError('document/html-too-large','The HTML exceeds the 8 MiB capture limit.',{bytes:bytes.length});return {html:decodeHTML(bytes),designPath:file,sourceURL:pathToFileURL(file).href,protectedInputs:[file]};}
  let url;try{url=new URL(designURL);}catch{sourceError('document/url-invalid','The design URL is invalid.',{url:designURL});}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)sourceError('document/url-invalid','Use an HTTP(S) URL without embedded credentials.',{protocol:url.protocol});
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason),timeout=setTimeout(()=>controller.abort(new Error('HTML fetch timed out')),30000);signal?.addEventListener('abort',abort,{once:true});
  try{
    const response=await fetch(url,{signal:controller.signal,headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'Archify document capture'}});
    if(!response.ok)sourceError('document/http-status','The HTML request failed.',{status:response.status,url:response.url});
    const type=response.headers.get('content-type')||'';
    if(type&&!/^(text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(type))sourceError('document/content-type','The URL did not return HTML.',{contentType:type});
    const chunks=[];let length=0;
    for await(const chunk of response.body){length+=chunk.length;if(length>limit){controller.abort();sourceError('document/html-too-large','The HTML exceeds the 8 MiB capture limit.',{bytes:length});}chunks.push(chunk);}
    const html=decodeHTML(Buffer.concat(chunks),type);
    return {html,relocateResources:true,sourceURL:response.url,protectedInputs:[]};
  }finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
}
