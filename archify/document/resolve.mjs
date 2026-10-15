// Resolve compiled text offsets to Markdown source ranges.
export function locateAt(entry, at) {
  let src = entry.textBase === undefined ? entry.start : entry.textBase;
  let ren = 0;
  let consumedEnd = -1;
  for (const a of entry.inline || []) {
    if (a.start < consumedEnd) continue;
    if (at < a.at) break;
    const gap = a.at - ren;
    src += gap; ren += gap;
    if (at < ren + a.len) return { src: a.start, end: a.end, inAnchor: a };
    src += a.end - a.start; ren += a.len;
    consumedEnd = a.end;
  }
  return { src: src + (at - ren), end: src + (at - ren) + 1, inAnchor: null };
}

// note = { src: 身份, at: 渲染偏移或 null, len: 渲染长度 }
export function resolve(map, note) {
  const entry = map[note.src];
  if (!entry) return { ok: false, reason: '身份不在映射里: ' + note.src };
  // 单元格：视觉结构可能已经变过（表格排成了卡片），所以这里指的不是块内偏移，
  // 而是"第几行第几列"。位置换了形状，来源没换。
  if (note.cell) {
    const [row, col] = note.cell;
    const cell = entry.cells?.[row]?.[col];
    if (!cell) return { ok: false, reason: '这一块里没有第 ' + row + ' 行第 ' + col + ' 列' };
    return { ok: true, start: cell.start, end: cell.end, construct: 'tableCell', span: 'cell' };
  }
  if (note.at === null || note.at === undefined) {
    return { ok: true, start: entry.start, end: entry.end, construct: entry.construct, span: 'block' };
  }
  const a = locateAt(entry, note.at);
  if (a.inAnchor) {
    return { ok: true, start: a.src, end: a.end, construct: a.inAnchor.construct, span: 'inline' };
  }
  const len = Math.max(1, note.len || 1);
  const b = locateAt(entry, note.at + len - 1);
  return { ok: true, start: a.src, end: Math.max(a.src + 1, b.end), construct: entry.construct, span: 'text' };
}

// 最小改：把源稿里 [start, end) 换成 replacement，别处一个字节不动。
export function patch(source, range, replacement) {
  return source.slice(0, range.start) + replacement + source.slice(range.end);
}
