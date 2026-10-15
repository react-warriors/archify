import { createHash } from 'node:crypto';
import { namedEntities } from './named-entities.mjs';

// 表驱动的 MD → HTML 编译器。
//
// 构造表就是实现。每一行声明怎么认、渲染成什么、要不要留锚；解析器从上往下问，
// 第一个认领的接手，所以表的顺序就是优先级。
//
// anchor 那一栏的判据是：渲染出来的位置能不能唯一确定源跨度。能就是 optional。

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TICK = '\x60';

// ── 行内 ──────────────────────────────────────────────────────────────────

const sticky = (re) => new RegExp(re.source, re.flags.replace(/[gy]/g, '') + 'y');
const tryAt = (re, s, i) => { re.lastIndex = i; return re.exec(s); };
const ENTITY = sticky(/&(#(?:x|X)[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/);
const BACKTICKS = sticky(/\x60+/);
const AUTOLINK = sticky(/<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\x00-\x20]*)>/);
const EMAIL_AUTOLINK = sticky(/<([a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/);
const RAWHTML = sticky(/<\/?[a-zA-Z][^>]*>/);
const ESCAPABLE = /[!-/:-@\[-\x60{-~]/;

function codeSpanAt(src, at) {
  const open = tryAt(BACKTICKS, src, at)[0];
  const runs = /`+/g; runs.lastIndex = at + open.length;
  for (let found; (found = runs.exec(src));) {
    if (found[0].length === open.length) return { start: at + open.length, close: found.index, end: found.index + open.length };
  }
  return null;
}
const numericReplacements = {
  0x80:0x20ac, 0x82:0x201a, 0x83:0x192, 0x84:0x201e, 0x85:0x2026,
  0x86:0x2020, 0x87:0x2021, 0x88:0x2c6, 0x89:0x2030, 0x8a:0x160,
  0x8b:0x2039, 0x8c:0x152, 0x8e:0x17d, 0x91:0x2018, 0x92:0x2019,
  0x93:0x201c, 0x94:0x201d, 0x95:0x2022, 0x96:0x2013, 0x97:0x2014,
  0x98:0x2dc, 0x99:0x2122, 0x9a:0x161, 0x9b:0x203a, 0x9c:0x153,
  0x9e:0x17e, 0x9f:0x178,
};

const decodeEntity = (m) => {
  if (m[1][0] === '#') {
    const code = m[1][1] === 'x' || m[1][1] === 'X' ? parseInt(m[1].slice(2), 16) : parseInt(m[1].slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(numericReplacements[code] ?? code) : '\ufffd';
  }
  return Object.hasOwn(namedEntities,m[1]) ? namedEntities[m[1]] : m[0];
};

function linkTarget(raw) {
  const parts = /^(?:<([^<>]*)>|(\S*?))(?:\s+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|\(((?:\\.|[^)\\])*)\)))?$/.exec(raw.trim());
  if (!parts) return null;
  const unescape = value => value.replace(/\\([!-/:-@\[-`{-~])/g, '$1');
  return { target: unescape(parts[1] ?? parts[2]), title: unescape(parts[3] ?? parts[4] ?? parts[5] ?? '') };
}

function linkAt(src, at, refs, image = false) {
  const begin = at + (image ? 1 : 0); if (src[begin] !== '[') return null;
  let end = begin + 1, depth = 1;
  for (; end < src.length; end++) {
    if (src[end] === '\\') { end++; continue; }
    if (src[end] === '[') depth++;
    if (src[end] === ']' && --depth === 0) break;
  }
  if (depth) return null;
  const label = src.slice(begin + 1, end); let target, title = '', finish = end + 1;
  if (src[finish] === '(') {
    let cursor = finish + 1, nested = 1, angle = false, quote = '';
    for (; cursor < src.length; cursor++) {
      const c = src[cursor]; if (c === '\\') { cursor++; continue; }
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '<') angle = true; else if (c === '>') angle = false;
      else if (!angle && (c === '"' || c === "'") && /\s/.test(src[cursor - 1])) quote = c;
      else if (!angle && c === '(') nested++;
      else if (!angle && c === ')' && --nested === 0) break;
    }
    if (nested) return null;
    const raw = src.slice(finish + 1, cursor).trim();
    const parsed = linkTarget(raw);
    if (!parsed) return null;
    ({ target, title } = parsed); finish = cursor + 1;
  } else {
    let key = label;
    if (src[finish] === '[') { const close = src.indexOf(']', finish + 1); if (close < 0) return null; key = src.slice(finish + 1, close) || label; finish = close + 1; }
    const definition = refs.get(key.replace(/\s+/g, ' ').trim().toLowerCase());
    if (definition === undefined) return null;
    ({ target, title } = typeof definition === 'string' ? { target: definition, title: '' } : definition);
  }
  return {label,target,title,end:finish,labelAt:begin + 1};
}

// 强调与加粗是同一种写法的两个构造，标记长度不同。合成一个 emitter，各自声明。
function emphasis(src, i, st, width, construct, tag) {
  const c = src[i];
  if (c !== '*' && c !== '_') return null;
  const run = src.slice(i).match(c === '*' ? /^\*+/ : /^_+/)[0].length;
  if (width === 1 ? run % 2 === 0 : run < 2) return null;
  const flanks = (at, size) => {
    const before = src[at - 1] || ' ', after = src[at + size] || ' ';
    const space = value => /\s/.test(value), punct = value => /[\p{P}\p{S}]/u.test(value);
    const left = !space(after) && (!punct(after) || space(before) || punct(before));
    const right = !space(before) && (!punct(before) || space(after) || punct(after));
    return { open: c === '_' ? left && (!right || punct(before)) : left, close: c === '_' ? right && (!left || punct(after)) : right };
  };
  if (!flanks(i, run).open) return null;
  let close = -1, nested = 0;
  for (let at = i + run; at < src.length; at++) {
    if (src[at] === '\\') { at++; continue; }
    if (src[at] === TICK) {
      const ticks = src.slice(at).match(/^`+/)[0], end = src.indexOf(ticks, at + ticks.length);
      if (end >= 0) at = end + ticks.length - 1;
      continue;
    }
    if (src[at] !== c) continue;
    const size = src.slice(at).match(c === '*' ? /^\*+/ : /^_+/)[0].length;
    const flank = flanks(at, size);
    if (size === run && flank.open && !flank.close) { nested++; at += size - 1; continue; }
    if (size >= run && (width !== 1 || size % 2) && flank.close) {
      if (nested) nested--; else { close = at + size - width; break; }
    }
    at += size - 1;
  }
  if (close <= i + width) return null;
  st.flush();
  const before = st.shown;
  const rendered = st.nested(src.slice(i + width, close), i + width);
  st.shown += st.ctx.lastLen;
  st.wrap(construct, before, i, close + width, st.ctx.lastLen,
    '<' + tag + '>' + rendered + '</' + tag + '>');
  return close + width;
}

// emit 返回消费到的位置，返回 null 表示不认领这一格。
const INLINES = [
  {
    name: 'escape', anchor: 'required', why: '反斜杠在渲染结果里没有了',
    emit: (src, i, st) => {
      if (src[i] !== '\\' || i + 1 >= src.length || !ESCAPABLE.test(src[i + 1])) return null;
      st.flush();
      st.raw('escape', i, i + 2, 1, esc(src[i + 1]));
      return i + 2;
    },
  },
  {
    name: 'entity', anchor: 'required', why: '三种写法渲染成同一个字符',
    emit: (src, i, st) => {
      const m = tryAt(ENTITY, src, i);
      if (!m) return null;
      const decoded = decodeEntity(m);
      st.flush();
      st.raw('entity', i, i + m[0].length, decoded.length, esc(decoded));
      return i + m[0].length;
    },
  },
  {
    name: 'codeSpan', anchor: 'required', why: '用几个反引号包起来，渲染结果里没有',
    emit: (src, i, st) => {
      if (src[i] !== TICK) return null;
      const span = codeSpanAt(src, i);
      if (!span) return null;
      st.flush();
      let content = src.slice(span.start, span.close).replace(/\n/g, ' ');
      if (/^ .+ $/.test(content) && /[^ ]/.test(content)) content = content.slice(1, -1);
      st.raw('codeSpan', i, span.end, content.length, '<code>' + esc(content) + '</code>');
      return span.end;
    },
  },
  {
    name: 'image', anchor: 'required', why: '括号写法不进渲染',
    emit: (src, i, st) => {
      if (src[i] !== '!') return null;
      const m = linkAt(src, i, st.ctx.refs, true);
      if (!m) return null;
      st.flush();
      st.note('image', i, m.end, 0);
      st.out += '<img src="' + esc(m.target) + '" alt="' + esc(m.label) + '"' + (m.title ? ' title="' + esc(m.title) + '"' : '') + '>';
      return m.end;
    },
  },
  {
    name: 'link', anchor: 'required', why: '四种写法渲染成同一个 a，目标还可能定义在文档别处',
    emit: (src, i, st) => {
      const m = linkAt(src, i, st.ctx.refs);
      if (!m) return null;
      st.flush();
      const before = st.shown;
      const inner = st.nested(m.label, m.labelAt);
      st.shown += st.ctx.lastLen;
      st.wrap('link', before, i, m.end, st.ctx.lastLen, '<a href="' + esc(m.target) + '"' + (m.title ? ' title="' + esc(m.title) + '"' : '') + '>' + inner + '</a>');
      return m.end;
    },
  },
  {
    name: 'autolink', anchor: 'required', why: '一个源跨度渲染出两处位置',
    emit: (src, i, st) => {
      const uri = tryAt(AUTOLINK, src, i),m = uri || tryAt(EMAIL_AUTOLINK,src,i);
      if (!m) return null;
      st.flush();
      st.note('autolink', i, i + m[0].length, m[1].length);
      st.out += '<a href="' + esc(uri?m[1]:'mailto:'+m[1]) + '">' + esc(m[1]) + '</a>';
      return i + m[0].length;
    },
  },
  {
    name: 'rawHtml', anchor: 'optional', why: '原样输出',
    emit: (src, i, st) => {
      const m = tryAt(RAWHTML, src, i);
      if (!m) return null;
      st.flush();
      st.out += m[0];
      st.ctx.note('rawHtml');
      return i + m[0].length;
    },
  },
  {
    name: 'emph', anchor: 'required', why: '星号还是下划线，渲染结果里没有',
    emit: (src, i, st) => emphasis(src, i, st, 1, 'emph', 'em'),
  },
  {
    name: 'strong', anchor: 'required', why: '同上',
    emit: (src, i, st) => emphasis(src, i, st, 2, 'strong', 'strong'),
  },
  {
    name: 'hardBreak', anchor: 'required', why: '两种写法渲染成同一个换行',
    emit: (src, i, st) => {
      if (src[i] !== '\n') return null;
      const back = src[i - 1] === '\\';
      const two = /\s\s$/.test(src.slice(0, i));
      if (!back && !two) return null;
      st.buf = back ? st.buf.slice(0, -1) : st.buf.replace(/[ \t]+$/, '');
      st.flush();
      st.note('hardBreak', i - (back ? 1 : 2), i + 1, 0);
      st.out += '<br>';
      return i + 1;
    },
  },
  {
    name: 'softBreak', anchor: 'required', why: '和一个空格渲染成同一个字符',
    emit: (src, i, st) => {
      if (src[i] !== '\n') return null;
      st.flush();
      st.raw('softBreak', i, i + 1, 1, ' ');
      return i + 1;
    },
  },
];

// 行内锚把渲染文字里的偏移映射回源偏移。note 记一条，wrap 记一条并让外层排在内层前面。
function inline(src, ctx, base = 0) {
  const st = {
    out: '', buf: '', shown: 0, anchors: [], ctx,
    note: (construct, from, to, textLen = 0) => {
      const anchor = { at: st.shown, len: textLen, start: base + from, end: base + to, construct };
      st.anchors.push(anchor); ctx.all.push(anchor);
      st.shown += textLen;
      ctx.note(construct);
    },
    flush: () => {
      if (!st.buf) return;
      ctx.note('plainText');
      st.out += esc(st.buf); st.shown += st.buf.length; st.buf = '';
    },
    raw: (construct, from, to, textLen, html) => { st.note(construct, from, to, textLen); st.out += html; },
    wrap: (construct, before, from, to, len, html) => {
      const anchor = { at: before, len, start: base + from, end: base + to, construct };
      st.anchors.unshift(anchor); ctx.all.push(anchor);
      st.out += html;
      ctx.note(construct);
    },
    nested: (text, offset) => {
      const mark = ctx.all.length;
      const html = inline(text, ctx, base + offset);
      for (const anchor of ctx.all.slice(mark)) anchor.at += st.shown;
      return html;
    },
  };
  ctx.anchors = st.anchors;
  let i = 0;
  while (i < src.length) {
    let next = null;
    for (const row of INLINES) {
      next = row.emit(src, i, st);
      if (next !== null) break;
    }
    if (next === null) { st.buf += src[i]; i += 1; } else i = next;
  }
  st.flush();
  ctx.lastLen = st.shown;
  return st.out;
}

// ── 块级 ──────────────────────────────────────────────────────────────────

// 一行表格按未被转义、也不在行内代码里的竖线切开。
function splitRow(lineText) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < lineText.length; i++) {
    const c = lineText[i];
    if (c === '\\') { i += 1; continue; }
    if (c === TICK) {
      const span = codeSpanAt(lineText, i);
      i = span ? span.end - 1 : i + tryAt(BACKTICKS, lineText, i)[0].length - 1;
      continue;
    }
    if (c === '|') { parts.push([start, i]); start = i + 1; }
  }
  parts.push([start, lineText.length]);
  return parts;
}

// 单元格的文字和它的源范围取自同一次切分。
function cellsOf(lineText, lineStart) {
  const out = [];
  const parts = splitRow(lineText);
  if (parts.length > 1 && !lineText.slice(...parts[0]).trim()) parts.shift();
  if (parts.length > 1 && !lineText.slice(...parts.at(-1)).trim()) parts.pop();
  for (const [from, to] of parts) {
    const raw = lineText.slice(from, to);
    const text = raw.trim();
    const lead = raw.length - raw.trimStart().length;
    out.push({ text, start: lineStart + from + lead, end: lineStart + from + lead + text.length });
  }
  return out;
}

// 派生 id 只出 ASCII，这样能写回 {#id} 语法。
const slug = (s) => {
  const ascii = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return ascii ? ascii.slice(0, 24) : createHash('sha256').update(String(s)).digest('hex').slice(0, 8);
};

// 作者写了身份就用，没写就派生。派生的记下来，可以写回源稿。
function makeIdentity(authored, construct, text, seen, counters) {
  if (authored) { seen.set(authored, true); return { id: authored, authored: true }; }
  const base = construct.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + '-' + slug(text);
  let n = counters.get(base) || 0;
  let id;
  do { n += 1; id = n === 1 ? base : base + '-' + n; } while (seen.has(id));
  counters.set(base, n);
  seen.set(id, true);
  return { id, authored: false };
}

const listMarker = line => /^( *)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line);
const nestedBlocks = (source, ctx) => compile(source, ctx.refs).html.replace(/\sdata-src="[^"]*"/g, '');
const thematicBreak = line => /^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim());
const HTML_BLOCK_START = /^\s*<(?:\/?(?:address|article|aside|base|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|nav|ol|p|pre|script|section|source|style|summary|svg|table|tbody|td|textarea|tfoot|th|thead|title|tr|track|ul)\b|[!?])/i;
function htmlBlockEnd(lines, from) {
  const line = lines[from];
  if (!HTML_BLOCK_START.test(line)) return null;
  const ending = /^\s*<!--/.test(line) ? /-->/
    : /^ {0,3}<(?:script|style|pre|textarea)(?=[\t >]|$)/i.test(line) ? /<\/(?:script|style|pre|textarea)>/i
    : /^ {0,3}<\?/.test(line) ? /\?>/
    : /^ {0,3}<!\[CDATA\[/.test(line) ? /\]\]>/
    : /^ {0,3}<![A-Za-z]/.test(line) ? />/ : null;
  let at = from;
  while (at < lines.length && (ending || lines[at].trim())) {
    const current = lines[at++];
    if (ending?.test(current)) break;
  }
  return at;
}

function readList(ctx, start) {
  const first = listMarker(ctx.lines[start]), indent = first[1].length;
  const ordered = /^\d/.test(first[2]), delimiter = first[2].at(-1);
  const items = []; let at = start, loose = false;
  while (at < ctx.lines.length) {
    const marker = listMarker(ctx.lines[at]);
    if (!marker || marker[1].length !== indent || /^\d/.test(marker[2]) !== ordered || marker[2].at(-1) !== delimiter) break;
    const padding = marker[1].length + marker[2].length + marker[3].length;
    const body = [marker[4]]; at++;
    while (at < ctx.lines.length) {
      const line = ctx.lines[at], next = listMarker(line);
      if (next && next[1].length <= indent) break;
      if (!line.trim()) {
        let following = at + 1; while (following < ctx.lines.length && !ctx.lines[following].trim()) following++;
        const after = listMarker(ctx.lines[following] || '');
        if (after && after[1].length === indent) { loose = true; at = following; break; }
        if (following >= ctx.lines.length || (ctx.lines[following].match(/^ */)[0].length < padding && !(after && after[1].length > indent))) break;
        loose = true; body.push(''); at++; continue;
      }
      const spaces = line.match(/^ */)[0].length;
      if (spaces > indent) body.push(line.slice(Math.min(spaces, padding)));
      else {
        if (/^(#{1,6}(?:\s|$)|>|\s*(?:`{3,}|~{3,})|\s*<)/.test(line) || thematicBreak(line)) break;
        body.push(line);
      }
      at++;
    }
    items.push(body.join('\n'));
  }
  return { at, items, loose, ordered, start: ordered ? parseInt(first[2], 10) : 1 };
}

// emit 返回消费到的下一行；lines 和 i 一起给，因为块级构造要看后面几行。
const BLOCKS = [
  {
    name: 'atxHeading', anchor: 'optional', why: '级别和文字都在渲染结果里',
    match: (lines, i) => {
      const prefix = /^ {0,3}(#{1,6})(?:[ \t]+|$)/.exec(lines[i]);
      if (!prefix) return null;
      let text = lines[i].slice(prefix[0].length).trimEnd();
      const identity = /(?:^|[ \t]+)\{#([^}\s]+)\}$/.exec(text);
      if (identity) text = text.slice(0, identity.index);
      text = text.replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trimEnd();
      return { level: prefix[1].length, text, id: identity?.[1], offset: prefix[0].length };
    },
    emit: (m, ctx, i) => {
      const level = m.level;
      const base = ctx.at(i) + m.offset;
      ctx.block(m.id, 'atxHeading', m.text, ctx.span(i, i + 1, i + 1), (n) => {
        ctx.push('<h' + level + ' data-src="' + esc(n) + '">' + inline(m.text, ctx, base) + '</h' + level + '>');
        ctx.entry(n).textBase = base;
      });
      return i + 1;
    },
  },
  {
    name: 'thematicBreak', anchor: 'required', why: '渲染出来只剩一条线，文字没了',
    match: (lines, i) => (thematicBreak(lines[i]) ? { 0: lines[i].trim() } : null),
    emit: (m, ctx, i) => {
      ctx.block(undefined, 'thematicBreak', m[0], ctx.span(i, i + 1, i + 1), (n) => ctx.push('<hr data-src="' + esc(n) + '">'));
      return i + 1;
    },
  },
  {
    name: 'fencedCode', anchor: 'required', why: '围栏用几个字符、有多长，渲染结果里没有',
    // 信息串是围栏之后的全部。只认一个词的话，```js title=x 这一行根本不算围栏 ——
    // 它变成段落，内容跟着变段落，反而是结尾那道围栏被认成空的代码块。
    match: (lines, i) => {
      const m = /^\s*(\x60{3,}|~{3,})[ \t]*(.*)$/.exec(lines[i]);
      if (!m) return null;
      if (m[1][0] === '\x60' && m[2].includes('\x60')) return null;
      return m;
    },
    emit: (m, ctx, i) => {
      const fence = m[1];
      // 语言取信息串的第一个词，其余是元数据。
      const lang = (m[2] || '').trim().split(/\s+/)[0] || '';
      const from = i;
      let at = i + 1;
      const body = [];
      const closes = (line) => {
        const t = line.trim();
        return t.length >= fence.length && t[0] === fence[0] && /^(\x60+|~+)$/.test(t);
      };
      while (at < ctx.lines.length && !closes(ctx.lines[at])) { body.push(ctx.lines[at]); at += 1; }
      if (at < ctx.lines.length) at += 1;
      ctx.block(undefined, 'fencedCode', lang || 'code', ctx.span(from, at, from + 1), (n) => {
        ctx.push('<pre data-src="' + esc(n) + '"><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + esc(body.join('\n')) + '</code></pre>');
      });
      return at;
    },
  },
  {
    name: 'setextHeading', anchor: 'required', why: '和 ATX 渲染成同一个 h 元素',
    match: (lines, i) => {
      if (!lines[i].trim() || i + 1 >= lines.length) return null;
      const underline = lines[i + 1].trim();
      return /^(=+|-+)\s*$/.test(underline) ? { underline } : null;
    },
    emit: (m, ctx, i) => {
      const level = m.underline[0] === '=' ? 1 : 2;
      const text = ctx.lines[i].trim();
      const base = ctx.at(i) + ctx.lines[i].length - ctx.lines[i].trimStart().length;
      ctx.block(undefined, 'setextHeading', text, ctx.span(i, i + 2, i + 1), (n) => {
        ctx.push('<h' + level + ' data-src="' + esc(n) + '">' + inline(text, ctx, base) + '</h' + level + '>');
        ctx.entry(n).textBase = base;
      });
      return i + 2;
    },
  },
  {
    name: 'blockQuote', anchor: 'optional', why: '引用记号不进渲染，但嵌套还在',
    match: (lines, i) => (/^>\s?/.test(lines[i]) ? { 0: lines[i] } : null),
    emit: (m, ctx, i) => {
      const from = i;
      const inner = [];
      while (i < ctx.lines.length && /^>\s?/.test(ctx.lines[i])) { inner.push(ctx.lines[i].replace(/^>\s?/, '')); i += 1; }
      ctx.block(undefined, 'blockQuote', inner.join(' '), ctx.span(from, i, from + 1), (n) => {
        ctx.push('<blockquote data-src="' + esc(n) + '">' + nestedBlocks(inner.join('\n'), ctx) + '</blockquote>');
      });
      return i;
    },
  },
  {
    name: 'table', anchor: 'required', why: '对齐写法不进渲染',
    match: (lines, i) => {
      if (!lines[i].includes('|') || i + 1 >= lines.length) return null;
      const delimiter = lines[i + 1];
      return delimiter.includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(delimiter) ? { 0: lines[i] } : null;
    },
    emit: (m, ctx, i) => {
      const from = i;
      const headLine = i;
      const cells = (row) => cellsOf(row, 0).map((c) => c.text);
      const head = cells(ctx.lines[i]);
      const align = cells(ctx.lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
      i += 2;
      const body = [];
      const bodyLines = [];
      while (i < ctx.lines.length && ctx.lines[i].includes('|') && ctx.lines[i].trim()) { body.push(cells(ctx.lines[i])); bodyLines.push(i); i += 1; }
      // 单元格各自的范围：视觉结构一变（表格排成卡片），块级锚就不够用了。
      const spans = [headLine, ...bodyLines].map((n) => cellsOf(ctx.lines[n], ctx.at(n)));
      ctx.block(undefined, 'table', head.join(' '), ctx.span(from, i, from + 1), (n) => {
        ctx.entry(n).cells = spans;
        const th = head.map((c, k) => '<th' + (align[k] ? ' style="text-align:' + align[k] + '"' : '') + '>' + inline(c, ctx, spans[0][k].start) + '</th>').join('');
        const tr = body.map((r, row) => '<tr>' + r.map((c, k) => '<td' + (align[k] ? ' style="text-align:' + align[k] + '"' : '') + '>' + inline(c, ctx, spans[row + 1][k].start) + '</td>').join('') + '</tr>').join('');
        ctx.push('<table data-src="' + esc(n) + '"><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table>');
      });
      return i;
    },
  },
  {
    name: 'listItem', anchor: 'required', why: '无序用哪个标记、有序用点还是括号，渲染结果里没有',
    match: (lines, i) => { const marker = listMarker(lines[i]); return marker && marker[1].length < 4 ? marker : null; },
    emit: (m, ctx, i) => {
      const from = i;
      const {at,items,loose,ordered,start} = readList(ctx, i); i = at;
      const tag = ordered ? 'ol' : 'ul';
      ctx.block(undefined, 'listItem', items.join(' '), ctx.span(from, i, from + 1), (n) => {
        const li = items.map(text => {
          let content = nestedBlocks(text, ctx);
          if (!loose) content = content.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
          return '<li>' + content + '</li>';
        }).join('');
        ctx.push('<' + tag + (ordered && start !== 1 ? ' start="' + start + '"' : '') + ' data-src="' + esc(n) + '">' + li + '</' + tag + '>');
      });
      return i;
    },
  },
  {
    name: 'indentedCode', anchor: 'required', why: '和无语言围栏渲染成同一个元素',
    match: (lines, i) => (/^ {4}/.test(lines[i]) ? { 0: lines[i] } : null),
    emit: (m, ctx, i) => {
      const from = i;
      const body = [];
      while (i < ctx.lines.length && (/^ {4}/.test(ctx.lines[i]) || !ctx.lines[i].trim())) { body.push(ctx.lines[i].replace(/^ {4}/, '')); i += 1; }
      ctx.block(undefined, 'indentedCode', body.join('\n').trim(), ctx.span(from, i, from + 1), (n) => {
        ctx.push('<pre data-src="' + esc(n) + '"><code>' + esc(body.join('\n').replace(/\n+$/, '')) + '</code></pre>');
      });
      return i;
    },
  },
  {
    // 注释不产生任何展示位置，所以标注不到它，也不该给它身份。
    // 但它是内容的一部分：删掉它，页面就不一样了，所以记进不可标注的跨度里。
    name: 'htmlComment', anchor: 'none', why: '注释不产生展示位置；但删掉它页面就变了',
    match: (lines, i) => (/^\s*<!--/.test(lines[i]) ? { 0: lines[i] } : null),
    emit: (m, ctx, i) => {
      const from = i;
      i = htmlBlockEnd(ctx.lines, i);
      const raw = ctx.lines.slice(from, i).join('\n'), close = raw.indexOf('-->');
      ctx.note('htmlComment');
      ctx.untouchable.push({ construct: 'htmlComment', start: ctx.at(from), end: close < 0 ? ctx.at(i - 1) + ctx.lines[i - 1].length : ctx.at(from) + close + 3 });
      if (close >= 0 && raw.slice(close + 3).replace(/<!--[\s\S]*?-->/g, '').trim()) {
        ctx.block(undefined, 'htmlBlock', raw, ctx.span(from, i, from + 1), n => ctx.push('<div data-src="' + esc(n) + '">' + raw + '</div>'));
      } else ctx.push(raw);
      return i;
    },
  },
  {
    name: 'htmlBlock', anchor: 'optional', why: '原样输出',
    match: (lines, i) => (HTML_BLOCK_START.test(lines[i]) ? { 0: lines[i] } : null),
    emit: (m, ctx, i) => {
      const from = i;
      i = htmlBlockEnd(ctx.lines, i);
      const body = ctx.lines.slice(from, i);
      ctx.block(undefined, 'htmlBlock', body[0].slice(0, 20), ctx.span(from, i, from + 1), (n) => {
        ctx.push('<div data-src="' + esc(n) + '">' + body.join('\n') + '</div>');
      });
      return i;
    },
  },
  {
    name: 'paragraph', anchor: 'optional', why: '文字在渲染结果里',
    match: (lines, i) => (lines[i].trim() ? { 0: lines[i] } : null),
    emit: (m, ctx, i) => {
      const from = i;
      const para = [];
      while (i < ctx.lines.length && ctx.lines[i].trim() && !thematicBreak(ctx.lines[i]) && !/^(#{1,6}\s|>|\s*([-*+]|\d+[.)])\s|\s*(\x60{3,}|~{3,})|\s*<)/.test(ctx.lines[i])) {
        para.push(ctx.lines[i]); i += 1;
        if (i < ctx.lines.length && /^(=+|-+)\s*$/.test(ctx.lines[i].trim())) break;
      }
      if (!para.length) { para.push(ctx.lines[i]); i++; }
      const base = ctx.at(from);
      ctx.block(undefined, 'paragraph', para.join(' '), ctx.span(from, i, from + 1), (n) => {
        ctx.push('<p data-src="' + esc(n) + '">' + inline(para.join('\n'), ctx, base) + '</p>');
        ctx.entry(n).textBase = base;
      });
      return i;
    },
  },
];

function referenceDefinition(line) {
  const match = /^ {0,3}\[([^\]]+)\]:[ \t]*(.*)$/.exec(line);
  if (!match || !match[1].trim()) return null;
  const parsed = linkTarget(match[2]);
  if (!parsed || (!parsed.target && !match[2].trimStart().startsWith('<>'))) return null;
  return { label: match[1], ...parsed };
}
const ATTRIBUTE = /^\{#([A-Za-z][A-Za-z0-9_-]*)\}$/;

// 有声明、但不是由某个 emitter 行产出的构造：纯文本走兜底，引用定义走单独一遍。
const DERIVED = [
  { name: 'plainText', anchor: 'optional', why: '原样', block: false },
  { name: 'refDef', anchor: 'none', why: '不产出任何内容，标注不到它；但删掉它引用式链接就断了', block: true },
];

// block 是派生的：分成哪张表本身就是它的类别，不必再存一遍。
export const TABLE = Object.fromEntries([
  ...BLOCKS.map((row) => [row.name, { ...row, block: true }]),
  ...INLINES.map((row) => [row.name, { ...row, block: false }]),
  ...DERIVED.map((row) => [row.name, row]),
]);;

export function compile(source, referenceDefinitions = new Map()) {
  const original = String(source);
  const normalized = original.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const starts = [];
  { let at = 0; for (const line of lines) { starts.push(at); at += line.length + 1; } }

  const refs = new Map(referenceDefinitions);
  const seen = new Map();
  const counters = new Map();
  const map = {};
  const derived = [];
  const used = new Map();
  const all = [];
  const untouchable = [];
  const attributes = [];
  const html = [];
  const blocks = [];
  let pendingId = null;

  const ctx = {
    lines, refs, all,
    at: (n) => starts[n] ?? normalized.length,
    // 终点取最后一行的末尾，不取下一行的开头。
    span: (from, to, line) => ({ start: starts[from], end: to > from ? starts[to - 1] + lines[to - 1].length : starts[from], line }),
    note: (construct) => used.set(construct, (used.get(construct) || 0) + 1),
    push: (piece) => html.push(piece),
    untouchable,
    entry: (id) => map[id],
    block: (authored, construct, text, range, target) => {
      const claimed = authored || pendingId || undefined;
      pendingId = null;
      const made = makeIdentity(claimed, construct, text, seen, counters);
      if (!made.authored) derived.push({ id: made.id, construct, line: range.line });
      map[made.id] = { start: range.start, end: range.end, construct, anchor: TABLE[construct].anchor };
      ctx.note(construct);
      const mark = html.length;
      target(made.id);
      const entry = map[made.id];
      blocks.push({
        id: made.id, construct, anchor: TABLE[construct].anchor,
        line: range.line, start: range.start, end: range.end,
        html: html.slice(mark).join('\n'),
        ...(entry.cells ? { cells: entry.cells } : {}),
      });
    },
  };

  // 引用定义的目标可能在文档任何地方，先收一遍。
  for (let n = 0; n < lines.length; n++) {
    const rawEnd = htmlBlockEnd(lines, n);
    if (rawEnd !== null) { n = rawEnd - 1; continue; }
    const fence=BLOCKS.find(row=>row.name==='fencedCode').match(lines,n);
    if(fence){
      for(n++;n<lines.length;n++){
        const line=lines[n].trim();
        if(line.length>=fence[1].length&&line[0]===fence[1][0]&&/^(\x60+|~+)$/.test(line))break;
      }
      continue;
    }
    const m = referenceDefinition(lines[n]);
    if (!m) continue;
    const key = m.label.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!refs.has(key)) refs.set(key, m.title ? { target: m.target, title: m.title } : m.target);
    ctx.note('refDef');
    untouchable.push({ construct: 'refDef', label: m.label, start: ctx.at(n), end: ctx.at(n) + lines[n].length });
  }

  let i = 0;
  while (i < lines.length) {
    const text = lines[i].trim();
    if (!text) { i += 1; continue; }
    // 独立一行的 {#id} 不产出内容，把身份挂给下一个块。
    const attribute = ATTRIBUTE.exec(text);
    if (attribute) {
      pendingId = attribute[1];
      const start = ctx.at(i);
      attributes.push({ id: attribute[1], start, end: start + lines[i].length });
      i += 1; continue;
    }
    // 引用定义那一行已经被第一遍收走了，它不产出任何东西。
    if (referenceDefinition(lines[i])) { i += 1; continue; }
    let next = null;
    for (const row of BLOCKS) {
      const m = row.match(lines, i, ctx);
      if (!m) continue;
      next = row.emit(m, ctx, i);
      break;
    }
    i = next === null ? i + 1 : next;
  }

  // 行内锚按范围归到所属块。
  const ordered = Object.entries(map).sort((a, b) => a[1].start - b[1].start);
  const anchors = all.slice().sort((a, b) => a.start - b.start);
  let k = 0;
  for (const [, entry] of ordered) {
    const inside = [];
    while (k < anchors.length && anchors[k].start < entry.end) {
      if (anchors[k].start >= entry.start) inside.push(anchors[k]);
      k += 1;
    }
    if (inside.length) entry.inline = inside.sort((a, b) => a.at - b.at);
  }

  for (const entry of Object.values(map)) if (entry.textBase === undefined) entry.textBase = entry.start;

  // 解析使用统一换行，输出范围仍定位到原文件中的字符。
  if (original.includes('\r')) {
    const offsets = [];
    for (let at = 0; at < original.length; at++) {
      offsets.push(at);
      if (original[at] === '\r' && original[at + 1] === '\n') at++;
    }
    offsets.push(original.length);
    const visited = new Set();
    const restore = (value) => {
      if (!value || typeof value !== 'object' || visited.has(value)) return;
      visited.add(value);
      for (const key of ['start', 'end', 'textBase']) if (typeof value[key] === 'number') value[key] = offsets[value[key]];
      for (const child of Object.values(value)) if (typeof child === 'object') restore(child);
    };
    for (const value of [map, blocks, untouchable, attributes]) restore(value);
  }

  return {
    html: html.join('\n'), blocks, map, derived,
    refs: [...refs.entries()],
    used: Object.fromEntries(used),
    inlineCount: all.length,
    untouchable, attributes,
  };
}
