(async () => {
  await document.fonts.ready;
  const recipes=JSON.parse(document.querySelector('#component-recipes').textContent);
  const displayAnchors=new Map(),titleCounts=new Map();
  for(const heading of document.querySelector('main').querySelectorAll('h1,h2,h3,h4,h5,h6')){
    const title=heading.tagName==='H2'?heading.textContent.replace(/^\s*\[(g\w+):([a-z]+)\]\s*/,''):heading.textContent;
    const slug=title.trim().toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu,'').replace(/\s/g,'-');
    const count=titleCounts.get(slug)||0;titleCounts.set(slug,count+1);displayAnchors.set(heading,slug+(count?'-'+count:''));
  }
  const report=document.querySelector('[data-document-diagnostics]');
  const notice=(body,message)=>{
    const note=document.createElement('aside');note.className='component-warning';note.textContent=message+'。本节保留原文。';body.prepend(note);
    const rows=JSON.parse(report.textContent);rows.push({code:'document/component-fallback',severity:'warning',message:note.textContent,subject:{heading:body.closest('.chapter').querySelector('h2').textContent}});report.textContent=JSON.stringify(rows);
  };
  const copy=(source,count)=>{
    const clone=source.cloneNode(true);
    for(const el of [clone,...clone.querySelectorAll('*')])for(const attr of [...el.attributes])if(attr.name==='id'||attr.name.startsWith('data-render-')||attr.name.startsWith('data-source-probe'))el.removeAttribute(attr.name);
    const walk=document.createTreeWalker(clone,NodeFilter.SHOW_TEXT);let left=count,text;
    while(left&&(text=walk.nextNode())){const n=Math.min(left,text.textContent.length);text.textContent=text.textContent.slice(n);left-=n;}
    return clone;
  };
  for(const [index,chapter] of [...document.querySelectorAll('.chapter')].entries()){
    const heading=chapter.querySelector('h2'),body=chapter.querySelector('.chapter-body');if(!heading||!body)continue;
    const decl=heading.textContent.match(/^\s*\[(g\w+):([a-z]+)\]\s*/);if(!decl)continue;
    // Keep existing section links when a presentation mark is added to its title.
    const anchorId=displayAnchors.get(heading);
    if(anchorId&&!document.getElementById(anchorId)){const anchor=document.createElement('span');anchor.id=anchorId;anchor.setAttribute('aria-hidden','true');heading.append(anchor);}
    const preset=recipes.find(recipe=>recipe.id===decl[2]);if(!preset){notice(body,'未支持这个组件');continue;}
    const marked=[...body.children].map(el=>({el,match:el.textContent.match(/^\s*\[(g\w+)\.(\d+)\.(\d+)\]\s*/)})).filter(item=>item.match);
    const assigned=new Map();let invalid=false;
    for(const item of marked){const slot=item.match[2]+'.'+item.match[3];if(item.match[1]!==decl[1]||!preset.slots[slot]||item.el.tagName!=='P'||item.el.querySelector('img,iframe,video,audio,object')){invalid=true;break;}const id=preset.slots[slot];if(!assigned.has(id))assigned.set(id,[]);assigned.get(id).push(copy(item.el,item.match[0].length));}
    if(invalid||Object.values(preset.slots).some(id=>!assigned.has(id))){notice(body,'组件位置不完整或标号无效');continue;}
    const figure=document.createElement('figure');figure.className='native-component';figure.dataset.nativePreset=preset.id;
    const template=document.querySelector('#recipe-'+preset.id);figure.append(template.content.cloneNode(true));const svg=figure.querySelector('svg');svg.setAttribute('role','group');
    svg.querySelectorAll('rect[fill="url(#grid)"]').forEach(el=>el.remove());
    // Every SVG instance owns its IDs, including markers and accessible labels.
    const renamed=new Map(),allocated=new Set();for(const el of svg.querySelectorAll('[id]')){const old=el.id,base=`component-${index}-${old}`;let next=base,suffix=1;while(document.getElementById(next)||allocated.has(next))next=base+'-'+suffix++;allocated.add(next);renamed.set(old,next);el.id=next;}
    for(const el of [svg,...svg.querySelectorAll('*')])for(const attr of [...el.attributes]){let value=attr.value;for(const [old,next] of renamed){value=value.replaceAll(`url(#${old})`,`url(#${next})`);if(['aria-labelledby','aria-describedby'].includes(attr.name))value=value.split(' ').map(token=>token===old?next:token).join(' ');if(value==='#'+old)value='#'+next;}if(value!==attr.value)el.setAttribute(attr.name,value);}
    let fits=true;
    for(const [id,paragraphs] of assigned){
      const node=svg.querySelector(`[data-node-id="${id}"]`),box=node?.querySelector('.c-mask');if(!node||!box){fits=false;break;}
      const x=Number(box.getAttribute('x')),y=Number(box.getAttribute('y')),w=Number(box.getAttribute('width')),h=Number(box.getAttribute('height'));
      const rail=preset.compact?18:preset.type==='tree'?8:26;
      for(const old of node.querySelectorAll('text'))old.remove();
      node.removeAttribute('tabindex');node.setAttribute('role','group');node.style.cursor='default';node.removeAttribute('aria-pressed');node.setAttribute('aria-label',paragraphs.map(p=>p.textContent).join(' '));node.dataset.nodeLabel=paragraphs.map(p=>p.textContent).join(' ');node.querySelector('title').textContent=node.dataset.nodeLabel;
      const foreign=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');Object.entries({x:x+12,y:y+rail,width:w-24,height:h-rail-8}).forEach(([key,value])=>foreign.setAttribute(key,value));
      const content=document.createElementNS('http://www.w3.org/1999/xhtml','div');content.className='native-copy'+(preset.compact?' compact':'');paragraphs.forEach(p=>content.append(p));foreign.append(content);node.append(foreign);
    }
    svg.querySelectorAll('[data-tree-toggle],[data-tree-expand-all]').forEach(el=>el.remove());
    svg.style.maxWidth=svg.viewBox.baseVal.width+'px';svg.setAttribute('aria-label',heading.textContent.slice(decl[0].length));
    const target=marked[0]?.el;if(target)target.before(figure);else body.append(figure);
    if([...svg.querySelectorAll('foreignObject')].some(el=>el.firstElementChild.scrollHeight>el.height.baseVal.value+1||el.firstElementChild.scrollWidth>el.width.baseVal.value+1))fits=false;
    if(!fits){figure.remove();notice(body,'该预设的内容区域不足');continue;}
    marked.forEach(({el})=>el.hidden=true);
    const first=document.createTreeWalker(heading,NodeFilter.SHOW_TEXT).nextNode();if(first?.textContent.startsWith(decl[0])){const control=document.createElement('span');control.hidden=true;control.textContent=decl[0];first.textContent=first.textContent.slice(decl[0].length);first.before(control);}
    const origin=document.createElement('figcaption');origin.textContent=preset.title;figure.append(origin);
  }
})();
