(() => {
  const main = document.querySelector('main');
  const family = document.documentElement.dataset.report;
  const ns = 'http://www.w3.org/2000/svg';
  const text = node => node.textContent.replace(/\s+/g, ' ').trim();
  const svgNode = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const diagram = (source, caption, kind) => {
    const figure = document.createElement('figure'); figure.className = `content-graph ${kind}`;
    const heading = document.createElement('figcaption'); heading.textContent = caption;
    const stage = document.createElement('div'); stage.className = 'content-graph-stage';
    source.before(figure); stage.append(source); figure.append(heading, stage);
    return stage;
  };
  // Keep the source nodes and draw connectors behind their measured positions.
  const connect = (stage, pairs) => {
    const svg = svgNode('svg', { class: 'content-wires', 'aria-hidden': 'true' }); stage.prepend(svg);
    let frame = 0;
    const draw = () => {
      frame = 0;
      const box = stage.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`); svg.replaceChildren();
      for (const { from, to, field } of pairs) {
        const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
        let x1 = a.right - box.left, y1 = a.top + a.height / 2 - box.top;
        let x2 = b.left - box.left, y2 = b.top + b.height / 2 - box.top;
        const gap = (x2 - x1) * .6;
        let pathData = `M${x1},${y1} C${x1 + gap},${y1} ${x2 - gap},${y2} ${x2},${y2}`;
        if (family === 'decision') {
          x1 = a.left - box.left;
          pathData = `M${x1},${y1} H${x1 - 8} V${y2} H${x2}`;
        } else if (family === 'review') {
          x2 = b.left + b.width / 2 - box.left; y2 = b.top - box.top;
          const railY = Math.min(a.top, b.top) - box.top - 9;
          pathData = `M${x1},${y1} H${x1 + 12} V${railY} H${x2} V${y2}`;
        }
        const path = svgNode('path', { d: pathData, 'data-from': text(from), 'data-to': text(to), 'data-field': field });
        svg.append(path, svgNode('circle', { cx: x2, cy: y2, r: 2.5 }));
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    new ResizeObserver(schedule).observe(stage); document.fonts.ready.then(schedule);
    window.addEventListener('beforeprint', draw); window.addEventListener('afterprint', schedule); draw();
  };
  for (const table of main.querySelectorAll('table')) {
    if (table.closest('.data-viz') || table.querySelector('img,svg,pre,table,kbd,[rowspan],[colspan]')) continue;
    const headers = [...(table.tHead?.rows[0]?.cells || [])].map(text);
    const rows = [...(table.tBodies[0]?.rows || [])];
    if (headers.length < 2 || headers.length > 4 || rows.length < 2 || rows.length > 12 || table.tBodies.length !== 1 || (family === 'decision' && rows.length > 4)) continue;
    // Measurements, dates and missing cells stay with the existing table/plot views.
    if (rows.some(row => row.cells.length !== headers.length || [...row.cells].some(cell => !text(cell) || /^[-+−]?\d|^—$/.test(text(cell)) || /!\[/.test(text(cell))) || text(row.cells[0]).length > 160 || [...row.cells].slice(1).some(cell => text(cell).length < 4))) continue;
    const source = table.closest('.table-scroll') || table;
    const stage = diagram(source, headers.join(' · '), 'attribute-graph');
    source.classList.add('graph-table'); table.dataset.graphColumns = headers.length;
    table.style.setProperty('--fields', headers.length - 1);
    if (family === 'decision') {
      table.style.setProperty('--options', rows.length);
      [...table.tHead.rows[0].cells].forEach((cell, column) => { cell.style.gridColumn = 1; cell.style.gridRow = column + 1; });
    }
    const pairs = [];
    rows.forEach((row, index) => {
      row.classList.add('attribute-group');
      [...row.cells].forEach((cell, column) => {
        cell.classList.add(column ? 'attribute-note' : 'attribute-key');
        cell.dataset.field = headers[column];
        if (family === 'decision') { cell.style.gridColumn = index + 2; cell.style.gridRow = column + 1; }
        if (column) pairs.push({ from: row.cells[0], to: cell, field: headers[column] });
      });
    });
    connect(stage, pairs);
  }
  for (const list of main.querySelectorAll('.chapter-body > ul')) {
    const items = [...list.children].filter(node => node.tagName === 'LI');
    if (list.querySelector('ul,ol,img,svg,pre') || items.length < 2 || items.length > 12) continue;
    const entries = items.map(item => {
      const key = item.firstElementChild;
      if (!key?.matches('strong,code') || !text(key) || text(key).length > 120) return null;
      const prefix = document.createRange(); prefix.selectNodeContents(item); prefix.setEndBefore(key);
      if (prefix.toString().trim()) return null;
      const rest = document.createRange(); rest.selectNodeContents(item); rest.setStartAfter(key);
      if (rest.toString().trim().length < 12) return null;
      return { item, key };
    });
    if (entries.some(entry => !entry)) continue;
    const stage = diagram(list, '条目与说明', 'statement-graph'); list.classList.add('statement-list');
    const pairs = [];
    for (const { item, key } of entries) {
      const rest = document.createRange(); rest.selectNodeContents(item); rest.setStartAfter(key);
      const body = document.createElement('div'); body.className = 'statement-note'; body.append(rest.extractContents());
      const keyBox = document.createElement('div'); keyBox.className = 'statement-key'; key.before(keyBox); keyBox.append(key);
      item.append(body); pairs.push({ from: keyBox, to: body, field: '同一条目中的说明' });
    }
    connect(stage, pairs);
  }
})();
