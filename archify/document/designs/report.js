(() => {
  const root = document.documentElement;
  const kind = root.dataset.report;
  const main = document.querySelector('main');
  const ns = 'http://www.w3.org/2000/svg';
  const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();
  const svgNode = (tag, attrs = {}, content) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const append = (parent, tag, attrs, content) => { const node = svgNode(tag, attrs, content); parent.append(node); return node; };
  const lines = (value, limit) => {
    const result = []; let line = '', width = 0;
    for (const char of value) {
      const unit = char.codePointAt(0) > 255 ? 1 : .55;
      if (width + unit > limit && line) { result.push(line); line = ''; width = 0; }
      line += char; width += unit;
    }
    if (line) result.push(line);
    return result;
  };
  const label = (parent, value, x, y, limit = 8, css = 'chart-label', attrs = {}) => {
    const node = append(parent, 'text', { x, y, class: css, ...attrs });
    const chunks = lines(value, limit);
    for (let i = 0; i < chunks.length; i++) append(node, 'tspan', { x, dy: i ? 16 : 0 }, chunks[i]);
    return chunks.length;
  };
  const number = (value) => {
    const normalized = value.replace(/−/g, '-').trim();
    const match = /^([+-]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+))\s*([%a-zA-Z\u3400-\u9fff]*)$/.exec(normalized);
    if (!match) return null;
    const valueNumber = Number(match[1].replaceAll(',', ''));
    return Number.isFinite(valueNumber) ? { value: valueNumber, unit: match[2], raw: value } : null;
  };
  const date = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    const ms = Date.UTC(year, month - 1, day), d = new Date(ms);
    return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? ms : null;
  };
  const format = (value) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value);
  const measurement = (title, values) => {
    const parsed = values.map(number);
    if (!parsed.length || parsed.some(value => !value) || new Set(parsed.map(value => value.unit)).size !== 1) return null;
    const declared = /[（(]([^()（）]+)[）)]/.exec(title)?.[1]?.trim();
    if ((!declared && !parsed[0].unit) || (declared && parsed[0].unit && declared !== parsed[0].unit)) return null;
    return { title, unit: declared || parsed[0].unit, parsed };
  };
  const shortDate = (value) => { const d = new Date(value); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  const makeFigure = (title, tag) => {
    const figure = document.createElement('figure');
    const caption = document.createElement('figcaption'); caption.append(document.createTextNode(title));
    const badge = document.createElement('span'); badge.className = 'chart-tag'; badge.textContent = tag;
    caption.append(badge); figure.append(caption); return figure;
  };
  const makeSvg = (figure, width, height, title) => {
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': title });
    append(svg, 'title', {}, title); figure.append(svg); return svg;
  };
  const observe = (figure, draw) => {
    let previous = 0, frame = 0;
    const redraw = (force = false) => {
      const width = Math.max(280, Math.round(figure.getBoundingClientRect().width));
      if (!force && width === previous) return;
      previous = width; figure.querySelector('svg')?.remove(); draw(width);
    };
    redraw();
    // 在下一帧更新图形，避免在尺寸通知中再次改变容器高度。
    new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; redraw(); });
    }).observe(figure);
    return () => redraw(true);
  };
  const rowHighlight = (group, row) => {
    group.addEventListener('pointerenter', () => row.classList.add('is-highlighted'));
    group.addEventListener('pointerleave', () => row.classList.remove('is-highlighted'));
    group.addEventListener('focus', () => row.classList.add('is-highlighted'));
    group.addEventListener('blur', () => row.classList.remove('is-highlighted'));
  };
  const legend = (figure, titles) => {
    const key = document.createElement('div'); key.className = 'comparison-key';
    titles.forEach((title, i) => {
      const item = document.createElement('span'); item.className = `comparison-key-${i}`; item.textContent = title; key.append(item);
    });
    figure.append(key); return key;
  };
  const chartControls = (figure, title) => {
    const bar = document.createElement('div'); bar.className = 'chart-controls';
    bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', title); figure.append(bar); return bar;
  };
  const selectControl = (bar, title, entries) => {
    const wrapper = document.createElement('label'); wrapper.append(document.createTextNode(title));
    const select = document.createElement('select');
    for (const [value, name] of entries) { const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option); }
    wrapper.append(select); bar.append(wrapper); return select;
  };
  const resetControl = (bar, title, action) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'chart-reset'; button.textContent = title;
    button.addEventListener('click', action); bar.append(button); return button;
  };
  const chartReadout = (figure) => {
    const output = document.createElement('output'); output.className = 'chart-readout'; output.setAttribute('aria-live', 'polite'); figure.append(output); return output;
  };
  // 两列共用尺度时，差值始终按后列减前列计算。
  const comparisonPlot = (figure, columns) => {
    const [first, second] = columns;
    const key = legend(figure, columns.map(column => column.title));
    const bar = chartControls(figure, '数值比较条件');
    const order = selectControl(bar, '排序', [['source', '原文顺序'], ['gap', '差距从大到小']]); order.dataset.control = 'comparison-order';
    const reference = selectControl(bar, '基准', [['first', first.title], ['second', second.title]]); reference.dataset.control = 'comparison-reference';
    const view = selectControl(bar, '图形', [['endpoints', '两列对照'], ['difference', '差值分布']]); view.dataset.control = 'comparison-view';
    const readout = chartReadout(figure);
    const note = document.createElement('div'); note.className = 'chart-note';
    figure.append(note);
    const deltaUnit = first.unit === '%' ? '个百分点' : first.unit;
    const signed = value => (value > 0 ? '+' : '') + new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 6 }).format(value) + deltaUnit;
    const redraw = observe(figure, width => {
      const direction = reference.value === 'first' ? 1 : -1;
      const records = first.records.map((record, i) => ({ ...record, index: i, second: second.records[i], delta: direction * (second.records[i].value - record.value) }));
      if (order.value === 'gap') records.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.index - b.index);
      const largest = records.reduce((best, record) => Math.abs(record.delta) > Math.abs(best.delta) ? record : best);
      readout.textContent = `差距最大：${largest.label} · ${signed(largest.delta)}`;
      note.textContent = `Δ = ${direction === 1 ? second.title : first.title} − ${direction === 1 ? first.title : second.title}`;
      const differences = view.value === 'difference';
      key.classList.toggle('is-difference', differences);
      figure.querySelector('figcaption').firstChild.textContent = differences ? '差值分布' : '同尺度数值对照';
      const heights = records.map(record => Math.max(80, lines(record.label, 8).length * 16 + 34));
      const height = heights.reduce((a, b) => a + b, 0) + 44;
      const svg = makeSvg(figure, width, height, differences ? '差值分布' : '同尺度数值对照');
      const extent = Math.max(...records.map(record => Math.abs(record.delta))) || 1;
      const min = differences ? -extent : Math.min(0, ...columns.flatMap(column => column.records.map(record => record.value)));
      const max = differences ? extent : Math.max(0, ...columns.flatMap(column => column.records.map(record => record.value)));
      const left = Math.min(120, width * .28), right = width - 116;
      const x = value => left + (value - min) / (max - min || 1) * (right - left);
      append(svg, 'text', { x: width - 4, y: 15, 'text-anchor': 'end', class: 'chart-label' }, '差值 Δ');
      for (const value of new Set([min, (min + max) / 2, max])) {
        append(svg, 'line', { x1: x(value), x2: x(value), y1: 24, y2: height - 28, class: differences && value === 0 ? 'chart-zero' : 'chart-axis' });
        append(svg, 'text', { x: x(value), y: height - 8, 'text-anchor': value === min ? 'start' : value === max ? 'end' : 'middle', class: 'chart-label' }, format(value) + (differences ? deltaUnit : first.unit));
      }
      let y = 28;
      records.forEach((record, i) => {
        const middle = y + heights[i] / 2 - 6, deltaText = signed(record.delta);
        const description = `${record.label}；${first.title}：${record.raw}；${second.title}：${record.second.raw}；${note.textContent}：${deltaText}`;
        const group = append(svg, 'g', { class: 'chart-mark comparison-mark', tabindex: 0, 'aria-label': description, 'data-label': record.label, 'data-first': record.value, 'data-second': record.second.value, 'data-delta': record.delta });
        append(group, 'title', {}, description);
        append(group, 'rect', { x: 0, y, width, height: heights[i], class: 'chart-hit' });
        label(group, record.label, 0, middle - (lines(record.label, 8).length - 1) * 8);
        if (differences) {
          append(group, 'rect', { x: Math.min(x(0), x(record.delta)), y: middle - 10, width: Math.abs(x(record.delta) - x(0)), height: 18, rx: 3, class: 'chart-bar' });
          append(group, 'text', { x: left, y: middle + 27, class: 'chart-label' }, `原值：${record.raw} / ${record.second.raw}`);
        } else {
          append(group, 'line', { x1: x(record.value), x2: x(record.second.value), y1: middle, y2: middle, class: 'comparison-link' });
          append(group, 'circle', { cx: x(record.value), cy: middle, r: 5, class: 'comparison-first' });
          append(group, 'circle', { cx: x(record.second.value), cy: middle, r: 5, class: 'comparison-second' });
          append(group, 'text', { x: x(record.value), y: middle - 14, 'text-anchor': 'middle', class: 'chart-value' }, record.raw);
          append(group, 'text', { x: x(record.second.value), y: middle + 25, 'text-anchor': 'middle', class: 'chart-value' }, record.second.raw);
        }
        append(group, 'text', { x: width - 4, y: middle + 4, 'text-anchor': 'end', class: 'comparison-delta' }, deltaText);
        rowHighlight(group, record.row); y += heights[i];
      });
    });
    for (const control of [order, reference, view]) control.addEventListener('change', redraw);
    resetControl(bar, '恢复原始视图', () => { order.value = 'source'; reference.value = 'first'; view.value = 'endpoints'; redraw(); });
  };
  // 数值列单独使用自己的比例尺；单位不同的列不会共用一根轴。
  const numericPlot = (figure, records, title, unit) => observe(figure, (width) => {
    const heights = records.map((r) => Math.max(40, lines(r.label, 8).length * 16 + 18));
    const height = heights.reduce((sum, h) => sum + h, 0) + 36;
    const svg = makeSvg(figure, width, height, title);
    const lo = Math.min(0, ...records.map((r) => r.value)), hi = Math.max(0, ...records.map((r) => r.value));
    const extent = hi - lo || 1;
    const base = Math.pow(10, Math.floor(Math.log10(extent)));
    const step = base * (extent / base > 5 ? 2 : extent / base > 2 ? 1 : .5);
    const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step || step;
    const left = Math.min(120, width * .32), right = width - 62;
    const x = (v) => left + (v - min) / (max - min) * (right - left);
    for (const v of [min, (min + max) / 2, max]) {
      append(svg, 'line', { x1: x(v), x2: x(v), y1: 8, y2: height - 27, class: v === 0 ? 'chart-zero' : 'chart-axis' });
      append(svg, 'text', { x: x(v), y: height - 8, 'text-anchor': 'middle', class: 'chart-label' }, format(v) + unit);
    }
    if (min < 0 && max > 0) append(svg, 'line', { x1: x(0), x2: x(0), y1: 8, y2: height - 27, class: 'chart-zero' });
    let y = 12;
    for (let i = 0; i < records.length; i++) {
      const record = records[i], middle = y + heights[i] / 2 - 5;
      const group = append(svg, 'g', { class: 'chart-mark', tabindex: 0, 'aria-label': `${record.label}：${record.raw}`, 'data-value': record.value });
      append(group, 'title', {}, `${record.label}：${record.raw}`);
      append(group, 'rect', { x: 0, y: y - 6, width, height: heights[i], class: 'chart-hit' });
      label(group, record.label, 0, middle - (lines(record.label, 8).length - 1) * 8);
      if (kind === 'analysis') {
        append(group, 'line', { x1: x(0), x2: x(record.value), y1: middle - 4, y2: middle - 4, class: 'chart-stem' });
        append(group, 'circle', { cx: x(record.value), cy: middle - 4, r: 4.5, class: 'chart-dot' });
      } else append(group, 'rect', { x: Math.min(x(0), x(record.value)), y: middle - 12, width: Math.abs(x(record.value) - x(0)), height: 17, rx: 3, class: 'chart-bar' });
      append(group, 'text', { x: width - 2, y: middle, 'text-anchor': 'end', class: 'chart-value' }, record.raw);
      rowHighlight(group, record.row); y += heights[i];
    }
  });
  const domain = values => {
    const low = Math.min(...values), high = Math.max(...values), padding = (high - low || Math.abs(low) || 1) * .15;
    return [low - padding, high + padding];
  };
  const plane = (figure, width, xValues, yValues, xTitle, yTitle, xUnit, yUnit, xTicks) => {
    const limit = (width - 24) / 12, xLines = lines(xTitle, limit).length, yLines = lines(yTitle, limit).length;
    const height = 350 + (xLines + yLines - 2) * 16, left = 74, right = width - 30, top = 30 + (yLines - 1) * 16, bottom = height - 68 - (xLines - 1) * 16;
    const tick = value => new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 3 }).format(value);
    const [xMin, xMax] = domain(xValues), [yMin, yMax] = domain(yValues);
    const x = value => left + (value - xMin) / (xMax - xMin) * (right - left);
    const y = value => bottom - (value - yMin) / (yMax - yMin) * (bottom - top);
    const svg = makeSvg(figure, width, height, `${xTitle}；${yTitle}`);
    for (const value of [yMin, (yMin + yMax) / 2, yMax]) {
      append(svg, 'line', { x1: left, x2: right, y1: y(value), y2: y(value), class: 'chart-axis' });
      append(svg, 'text', { x: left - 12, y: y(value) + 4, 'text-anchor': 'end', class: 'chart-label' }, tick(value));
    }
    for (const value of xTicks || [xMin, (xMin + xMax) / 2, xMax]) {
      append(svg, 'text', { x: x(value), y: bottom + 24, 'text-anchor': 'middle', class: 'chart-label' }, tick(value));
    }
    append(svg, 'line', { x1: left, x2: right, y1: bottom, y2: bottom, class: 'chart-zero' });
    label(svg, yTitle, 12, 14, limit, 'plane-axis-title');
    label(svg, xTitle, width / 2, height - xLines * 16 + 6, limit, 'plane-axis-title', { 'text-anchor': 'middle' });
    svg.dataset.xUnit = xUnit; svg.dataset.yUnit = yUnit;
    return { svg, x, y };
  };
  const optionPlane = (figure, columns) => {
    const [first, second] = columns;
    const key = document.createElement('div'); key.className = 'option-key';
    first.records.forEach((record, index) => {
      const item = document.createElement('span'), ordinal = document.createElement('b'); ordinal.textContent = index + 1;
      item.append(ordinal, document.createTextNode(record.label)); key.append(item);
    });
    figure.append(key);
    const note = document.createElement('p'); note.className = 'chart-note'; note.textContent = '每个位置对应一行原始记录；两根轴分别保留原单位。'; figure.append(note);
    observe(figure, width => {
      const { svg, x, y } = plane(figure, width, first.records.map(r => r.value), second.records.map(r => r.value), first.title, second.title, first.unit, second.unit);
      first.records.forEach((record, index) => {
        const other = second.records[index], px = x(record.value), py = y(other.value);
        const matches = first.records.flatMap((item, i) => item.value === record.value && second.records[i].value === other.value ? [i] : []);
        if (matches[0] !== index) return;
        const ordinals = matches.map(i => i + 1).join('·'), names = matches.map(i => first.records[i].label).join('、');
        const group = append(svg, 'g', { class: 'option-point', tabindex: 0, 'data-label': names, 'data-x': record.value, 'data-y': other.value, 'aria-label': `${names}；${first.title}：${record.raw}；${second.title}：${other.raw}` });
        append(group, 'title', {}, group.getAttribute('aria-label'));
        append(group, 'circle', { cx: px, cy: py, r: Math.max(10, ordinals.length * 4), class: 'option-dot' });
        append(group, 'text', { x: px, y: py + 4, 'text-anchor': 'middle', class: 'option-ordinal' }, ordinals);
        matches.forEach(i => rowHighlight(group, first.records[i].row));
      });
    });
  };
  const sampleProfile = (figure, horizontal, columns) => {
    legend(figure, columns.map(column => column.title));
    const note = document.createElement('p'); note.className = 'chart-note'; note.textContent = '连线只连接已记录的样本点。'; figure.append(note);
    observe(figure, width => {
      const xValues = horizontal.parsed.map(v => v.value);
      const ticks = [...new Set(xValues)].sort((a,b) => a-b);
      const { svg, x, y } = plane(figure, width, xValues, columns.flatMap(column => column.records.map(r => r.value)), horizontal.title, columns[0].unit, horizontal.unit, columns[0].unit, ticks);
      columns.forEach((column, series) => {
        const records = column.records.map((record, index) => ({ ...record, xValue: horizontal.parsed[index].value })).sort((a, b) => a.xValue - b.xValue);
        const group = append(svg, 'g', { class: `sample-series sample-series-${series}`, 'data-series': column.title });
        append(group, 'polyline', { points: records.map(record => `${x(record.xValue)},${y(record.value)}`).join(' '), class: 'sample-trace' });
        for (const record of records) {
          const point = append(group, 'g', { class: 'sample-point', tabindex: 0, 'data-x': record.xValue, 'data-y': record.value, 'aria-label': `${horizontal.title}：${record.label}；${column.title}：${record.raw}` });
          append(point, 'title', {}, point.getAttribute('aria-label'));
          append(point, 'circle', { cx: x(record.xValue), cy: y(record.value), r: 5, class: 'sample-dot' }); rowHighlight(point, record.row);
        }
      });
    });
  };
  const intervalPlot = (figure, records, title) => {
    const min = Math.min(...records.map((r) => r.start)), max = Math.max(...records.map((r) => r.end));
    const bar = chartControls(figure, '按日期查看区间');
    bar.hidden = min === max;
    const wrapper = document.createElement('label'); wrapper.className = 'date-control'; wrapper.append(document.createTextNode('查看日期'));
    const range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = String((max - min) / 86400000); range.step = '1'; range.value = '0'; range.disabled = min === max; range.dataset.control = 'interval-date';
    wrapper.append(range); bar.append(wrapper);
    const readout = chartReadout(figure);
    const note = document.createElement('div'); note.className = 'chart-note'; note.textContent = '起止日均包含；查询的是日期覆盖，不表示完成情况。'; figure.append(note);
    let selected = null;
    const redraw = observe(figure, width => {
      const matches = records.filter(record => selected !== null && record.start <= selected && record.end >= selected);
      const day = new Date(selected ?? min).toISOString().slice(0, 10); range.setAttribute('aria-valuetext', day);
      readout.textContent = selected === null ? '拖动日期，查看当天覆盖哪些区间。' : `${day} · ${matches.length} 个区间覆盖${matches.length ? '：' + matches.map(record => record.label).join('、') : ''}`;
      const heights = records.map(r => Math.max(60, lines(r.label, 8).length * 16 + 28));
      const height = heights.reduce((a, b) => a + b, 0) + 42;
      const svg = makeSvg(figure, width, height, title);
      const left = Math.min(130, width * .34), right = width - 10;
      const x = value => left + (value - min) / (max - min || 86400000) * (right - left);
      for (const value of new Set([min, min + (max - min) / 2, max])) {
        append(svg, 'line', { x1: x(value), x2: x(value), y1: 8, y2: height - 27, class: 'chart-axis' });
        append(svg, 'text', { x: x(value), y: height - 8, 'text-anchor': value === max ? 'end' : value === min ? 'start' : 'middle', class: 'chart-label' }, shortDate(value));
      }
      let y = 10;
      for (let i = 0; i < records.length; i++) {
        const record = records[i], middle = y + heights[i] / 2 - 10, covered = matches.includes(record);
        record.row.classList.toggle('is-date-match', covered);
        const group = append(svg, 'g', { tabindex: 0, class: `chart-mark${covered ? ' is-date-match' : ''}`, 'aria-label': `${record.label}：${record.startText}至${record.endText}` });
        append(group, 'title', {}, `${record.label}：${record.startText}至${record.endText}`);
        append(group, 'rect', { x: 0, y, width, height: heights[i], class: 'chart-hit' });
        label(group, record.label, 0, middle);
        if (record.start === record.end) append(group, 'circle', { cx: x(record.start), cy: middle - 4, r: 4, class: 'chart-bar' });
        else append(group, 'rect', { x: x(record.start), y: middle - 12, width: x(record.end) - x(record.start), height: 17, rx: 3, class: 'chart-bar' });
        append(group, 'text', { x: x(record.start), y: middle + 20, class: 'chart-label' }, `${shortDate(record.start)} — ${shortDate(record.end)}`);
        rowHighlight(group, record.row); y += heights[i];
      }
      if (selected !== null) append(svg, 'line', { x1: x(selected), x2: x(selected), y1: 8, y2: height - 27, class: 'date-cursor' });
    });
    range.addEventListener('input', () => { selected = min + Number(range.value) * 86400000; redraw(); });
    resetControl(bar, '清除定位', () => { selected = min === max ? min : null; range.value = '0'; redraw(); });
    if (min === max) { selected = min; redraw(); }
  };
  for (const table of main.querySelectorAll('table')) {
    const headers = [...(table.tHead?.rows[0]?.cells || [])].map(text);
    const rows = [...(table.tBodies[0]?.rows || [])];
    const scroll = document.createElement('div'); scroll.className = 'table-scroll'; table.before(scroll); scroll.append(table);
    if (headers.length < 2 || !rows.length) continue;
    const values = rows.map((row) => [...row.cells].map(text));
    const startColumn = headers.findIndex((h) => /^(开始|起始|开始日期|起始日期|start)$/i.test(h));
    const endColumn = headers.findIndex((h) => /^(结束|截止|结束日期|截止日期|end)$/i.test(h));
    const intervals = startColumn > 0 && endColumn > 0 ? values.map((cells, i) => ({ label: cells[0], start: date(cells[startColumn]), end: date(cells[endColumn]), startText: cells[startColumn], endText: cells[endColumn], row: rows[i] })) : [];
    const numeric = headers.slice(1).flatMap((title, k) => {
      const column = measurement(title, values.map(cells => cells[k + 1] || ''));
      return column ? [{ title, unit: column.unit, records: column.parsed.map((v, i) => ({ ...v, label: values[i][0], row: rows[i] })) }] : [];
    });
    const dated = intervals.length && intervals.every((r) => r.start !== null && r.end !== null && r.end >= r.start);
    if (!dated && !numeric.length) continue;
    const box = document.createElement('div'); box.className = 'data-viz';
    const plots = document.createElement('div'); plots.className = 'plots'; box.append(plots); scroll.before(box); box.append(scroll);
    if (!dated && rows.length >= 2 && rows.length <= 12) {
      if (kind === 'decision' && numeric.length === 2 && numeric[0].unit !== numeric[1].unit) {
        const figure = makeFigure('双指标位置', headers[0]); figure.className = 'option-plane'; plots.append(figure); optionPlane(figure, numeric);
      }
      const horizontal = measurement(headers[0], values.map(cells => cells[0]));
      if (kind === 'analysis' && horizontal && numeric.length && numeric.length <= 3 && new Set(numeric.map(column => column.unit)).size === 1) {
        const figure = makeFigure('样本剖面', headers[0]); figure.className = 'sample-profile'; plots.append(figure); sampleProfile(figure, horizontal, numeric);
      }
    }
    if (dated) {
      const figure = makeFigure('起止日期', headers[0]); plots.append(figure); intervalPlot(figure, intervals, '起止日期');
    } else if (numeric.length === 2 && numeric[0].unit === numeric[1].unit) {
      const figure = makeFigure('同尺度数值对照', headers[0]); figure.className = 'comparison-figure'; plots.append(figure); comparisonPlot(figure, numeric);
    } else for (const column of numeric) {
      const figure = makeFigure(column.title, headers[0]); plots.append(figure); numericPlot(figure, column.records, column.title, column.unit);
    }
  }
  const listFigure = (list, title, tag, className) => {
    const box = document.createElement('div'); box.className = `data-viz ${className}`; list.before(box);
    const figure = makeFigure(title, tag); box.append(figure);
    const source = document.createElement('details'); source.className = 'viz-source';
    const summary = document.createElement('summary'); summary.textContent = '查看原文列表'; source.append(summary, list); box.append(source);
    return figure;
  };
  const ownText = (item) => {
    const copy = item.cloneNode(true);
    for (const list of copy.querySelectorAll('ul,ol')) list.remove();
    return text(copy);
  };
  for (const list of main.querySelectorAll('.chapter-body > ul')) {
    if (!list.querySelector('ul') || list.querySelector('ol')) continue;
    const nodes = [];
    const read = (list, depth = 0, parent = null) => [...list.children].filter(el => el.tagName === 'LI').map(item => {
      const node = { label: ownText(item), item, depth, parent, index: nodes.length }; nodes.push(node);
      node.children = [...item.children].filter(el => el.tagName === 'UL').flatMap(child => read(child, depth + 1, node));
      return node;
    });
    const roots = read(list);
    if (nodes.length > 32 || nodes.some(node => !node.label)) continue;
    const figure = listFigure(list, '列表层级', '原文缩进关系', 'hierarchy-viz');
    const bar = chartControls(figure, '查看列表关系');
    const picker = selectControl(bar, '查看条目', [['', '全部关系'], ...nodes.map(node => [String(node.index), '　'.repeat(node.depth) + node.label])]); picker.dataset.control = 'hierarchy-node';
    const readout = chartReadout(figure);
    let selected = null;
    const applySelection = () => {
      const related = new Set();
      const descendants = node => { related.add(node); node.children.forEach(descendants); };
      if (selected) {
        descendants(selected);
        for (let parent = selected.parent; parent; parent = parent.parent) related.add(parent);
      }
      for (const node of nodes) {
        node.group.classList.toggle('is-muted', selected !== null && !related.has(node));
        node.group.classList.toggle('is-selected', selected === node); node.group.setAttribute('aria-pressed', String(selected === node));
        node.item.classList.toggle('is-tree-match', selected !== null && related.has(node));
        node.edge?.classList.toggle('is-muted', selected !== null && !related.has(node));
        node.edge?.classList.toggle('is-related', selected !== null && related.has(node));
      }
      const path = [];
      for (let node = selected; node; node = node.parent) path.unshift(node.label);
      readout.textContent = selected ? `路径：${path.join(' › ')} · ${nodes.filter(node => node !== selected && related.has(node) && node.depth > selected.depth).length} 个子条目` : '点选节点，查看它的父子路径；按 Esc 恢复全部关系。';
      picker.value = selected ? String(selected.index) : '';
    };
    const selectNode = node => { selected = node; applySelection(); };
    picker.addEventListener('change', () => selectNode(picker.value === '' ? null : nodes[Number(picker.value)]));
    resetControl(bar, '查看全部关系', () => selectNode(null));
    observe(figure, available => {
      const depth = Math.max(...nodes.map(node => node.depth));
      const width = Math.max(available, (depth + 1) * 160 + depth * 36);
      const cardWidth = (width - depth * 36) / (depth + 1), limit = (cardWidth - 32) / 14;
      const measure = node => {
        node.cardHeight = Math.max(60, lines(node.label, limit).length * 16 + 30);
        node.span = Math.max(node.cardHeight, node.children.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, node.children.length - 1) * 14);
        return node.span;
      };
      const height = roots.reduce((sum, node) => sum + measure(node), 0) + (roots.length - 1) * 24 + 4;
      const svg = makeSvg(figure, width, height, '列表层级：连线表示原文中的父子条目'); svg.style.minWidth = width + 'px';
      svg.setAttribute('role', 'group');
      const place = (node, top) => {
        node.x = node.depth * (cardWidth + 36); node.y = top + (node.span - node.cardHeight) / 2;
        let childTop = top;
        for (const child of node.children) { place(child, childTop); childTop += child.span + 14; }
      };
      let top = 2;
      for (const node of roots) { place(node, top); top += node.span + 24; }
      for (const node of nodes.filter(node => node.parent)) {
        const x1 = node.parent.x + cardWidth, y1 = node.parent.y + node.parent.cardHeight / 2, x2 = node.x, y2 = node.y + node.cardHeight / 2;
        node.edge = append(svg, 'path', { d: `M${x1},${y1} C${x1 + 18},${y1} ${x2 - 18},${y2} ${x2},${y2}`, class: 'hierarchy-edge', 'data-parent': node.parent.label, 'data-child': node.label });
      }
      for (const node of nodes) {
        const description = node.parent ? `父条目：${node.parent.label}；条目：${node.label}` : node.label;
        const group = append(svg, 'g', { class: 'hierarchy-node', role: 'button', tabindex: 0, 'aria-label': description, 'data-label': node.label }); node.group = group;
        append(group, 'title', {}, description);
        append(group, 'rect', { x: node.x + 1, y: node.y, width: cardWidth - 2, height: node.cardHeight, rx: 7, class: node.parent ? 'hierarchy-card' : 'hierarchy-card hierarchy-parent' });
        label(group, node.label, node.x + 16, node.y + 25, limit, 'structure-label'); rowHighlight(group, node.item);
        group.addEventListener('click', () => selectNode(node));
        group.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node); }
          if (event.key === 'Escape') { event.preventDefault(); selectNode(null); }
        });
      }
      applySelection();
    });
  }
  if (kind === 'review') for (const list of main.querySelectorAll('.chapter-body > ol')) {
    const items = [...list.children].filter(el => el.tagName === 'LI');
    if (items.length < 2 || items.length > 12 || list.querySelector('ul,ol')) continue;
    let ordinal = list.hasAttribute('start') ? list.start : list.reversed ? items.length : 1;
    const ordinals = items.map(item => {
      if (item.hasAttribute('value')) ordinal = item.value;
      const value = ordinal; ordinal += list.reversed ? -1 : 1; return value;
    });
    const figure = listFigure(list, '步骤顺序', '按原文次序', 'sequence-viz');
    const content = items.map(item => {
      const full = text(item), strong = item.querySelector('strong');
      const title = strong && full.startsWith(text(strong)) ? text(strong) : '';
      return { title, body: title ? full.slice(title.length).trim() : full };
    });
    observe(figure, (width) => {
      const horizontal = items.length <= 5 && width >= items.length * 190 + (items.length - 1) * 28;
      const cardWidth = horizontal ? (width - 2 - (items.length - 1) * 28) / items.length : width - 2;
      const limit = (cardWidth - 36) / 14;
      const heights = content.map(item => Math.max(112, (lines(item.title, limit).length + lines(item.body, limit).length) * 16 + 58 + (item.title ? 8 : 0)));
      const height = horizontal ? Math.max(...heights) + 4 : heights.reduce((a, b) => a + b, 0) + (items.length - 1) * 28 + 4;
      const svg = makeSvg(figure, width, height, '步骤顺序');
      let y = 2;
      items.forEach((item, i) => {
        const x = horizontal ? i * (cardWidth + 28) + 1 : 1, cardHeight = horizontal ? height - 4 : heights[i];
        if (i) {
          const edge = horizontal ? `M${x - 24},${height / 2} h20 m-5,-5 l5,5 -5,5` : `M${width / 2},${y - 24} v20 m-5,-5 l5,5 5,-5`;
          append(svg, 'path', { d: edge, class: 'step-link' });
        }
        const group = append(svg, 'g', { class: 'flow-node', tabindex: 0, 'aria-label': `${ordinals[i]}. ${text(item)}` });
        append(group, 'title', {}, `${ordinals[i]}. ${text(item)}`);
        append(group, 'rect', { x, y, width: cardWidth, height: cardHeight, rx: 7, class: 'step-card' });
        append(group, 'circle', { cx: x + 28, cy: y + 25, r: 13, class: 'step-dot' });
        append(group, 'text', { x: x + 28, y: y + 29, 'text-anchor': 'middle', class: 'step-number' }, ordinals[i]);
        const titleLines = content[i].title ? label(group, content[i].title, x + 18, y + 59, limit, 'structure-label step-title') : 0;
        label(group, content[i].body, x + 18, y + 59 + (titleLines ? titleLines * 16 + 8 : 0), limit, 'structure-label'); rowHighlight(group, item);
        if (!horizontal) y += cardHeight + 28;
      });
    });
  }
  [...main.querySelectorAll('.chapter')].forEach((chapter, i) => { const number = chapter.querySelector('.chapter-index'); if (number) number.textContent = String(i + 1).padStart(2, '0'); });
  [...document.querySelectorAll('.section-nav a')].forEach((link, i) => { const number = link.querySelector('.nav-number'); if (number) number.textContent = String(i + 1).padStart(2, '0'); });
  const links = [...document.querySelectorAll('.section-nav a')];
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) for (const link of links) link.setAttribute('aria-current', String(link.hash === '#' + entry.target.id));
  }, { rootMargin: '-10% 0px -60% 0px' });
  for (const heading of main.querySelectorAll('h2[id]')) observer.observe(heading);
  let printSources = null;
  window.addEventListener('beforeprint', () => {
    if (printSources) return;
    printSources = [...main.querySelectorAll('.viz-source')].map(source => [source, source.open]);
    for (const [source] of printSources) source.open = true;
  });
  window.addEventListener('afterprint', () => {
    for (const [source, open] of printSources || []) source.open = open;
    printSources = null;
  });
  document.querySelector('[data-action="appearance"]')?.addEventListener('click', () => { root.dataset.appearance = root.dataset.appearance === 'dark' ? 'light' : 'dark'; });
  document.querySelector('[data-action="print"]')?.addEventListener('click', () => window.print());
})();
