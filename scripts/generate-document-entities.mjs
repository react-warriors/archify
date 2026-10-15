import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {BinTrieFlags,htmlDecodeTree,determineBranch,decodeHTMLStrict} from 'entities/decode';

// Materialize the installed decoder's named references for dependency-free rendering.
const names=new Set(),alphabet='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz;';
function visit(index,prefix){
  const value=htmlDecodeTree[index],length=(value&BinTrieFlags.VALUE_LENGTH)>>14;
  if(length&&prefix.endsWith(';')){names.add(prefix.slice(0,-1));return;}
  for(const char of alphabet){
    const next=determineBranch(htmlDecodeTree,value,index+Math.max(1,length),char.charCodeAt(0));
    if(next>=0)visit(next,prefix+char);
  }
}
visit(0,'');
const table=Object.fromEntries([...names].sort().map(name=>[name,decodeHTMLStrict('&'+name+';')]));
const output=fileURLToPath(new URL('../archify/document/named-entities.mjs',import.meta.url));
const source='// Generated from entities 6.0.1 (BSD-2-Clause); see THIRD_PARTY_NOTICES.md.\nexport const namedEntities = '+JSON.stringify(table)+';\n';
if(process.argv.includes('--check')){
  if(!fs.existsSync(output)||fs.readFileSync(output,'utf8')!==source){console.error('Named HTML entities are stale; run node scripts/generate-document-entities.mjs.');process.exitCode=1;}
  else console.log('Named HTML entities are current.');
}else{fs.writeFileSync(output,source);console.log('Generated '+names.size+' named HTML entities.');}
