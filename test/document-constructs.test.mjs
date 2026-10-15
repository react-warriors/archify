import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, TABLE } from '../archify/document/compile.mjs';

// 逐个构造的回程检查：给一段最小源稿，锚切出来必须正好是那一段。
//
// 锚覆盖检查只问"有没有锚"，不问"锚对不对" —— 所以它漏掉了这几类。这一条补上那一面。
const BLOCK = [
  ['atxHeading', '# 甲\n', (s) => s === '# 甲'],
  ['setextHeading', '甲\n===\n', (s) => s === '甲\n==='],
  ['thematicBreak', '---\n', (s) => s === '---'],
  ['fencedCode', '```js\nconst a = 1;\n```\n', (s) => s.startsWith('```js') && s.endsWith('```')],
  ['indentedCode', '    甲\n', (s) => s.includes('甲')],
  ['blockQuote', '> 甲\n', (s) => s === '> 甲'],
  ['listItem', '- 甲\n', (s) => s === '- 甲'],
  ['table', '| a | b |\n| - | - |\n| 1 | 2 |\n', (s) => s.startsWith('| a') && s.includes('| 1 | 2 |')],
  ['htmlBlock', '<div>甲</div>\n', (s) => s.includes('<div>甲</div>')],
  ['paragraph', '甲。\n', (s) => s === '甲。'],
];

const INLINE = [
  ['codeSpan', '甲 `x` 乙\n', '`x`'],
  ['emph', '甲 *x* 乙\n', '*x*'],
  ['strong', '甲 **x** 乙\n', '**x**'],
  ['link', '甲 [x](u) 乙\n', '[x](u)'],
  ['autolink', '甲 <https://e.com> 乙\n', '<https://e.com>'],
  ['image', '甲 ![a](u) 乙\n', '![a](u)'],
  ['entity', '甲 &amp; 乙\n', '&amp;'],
  ['escape', '甲 \\* 乙\n', '\\*'],
  ['rawHtml', '甲 <b>x</b> 乙\n', '<b>'],
  ['hardBreak', '甲  \n乙\n', '  \n'],
  ['softBreak', '甲\n乙\n', '\n'],
];

test('email autolinks and named entities retain their visible text and source ranges',()=>{
  const email=compile('Contact <team@example.test>.');
  assert.match(email.html,/<a href="mailto:team@example.test">team@example.test<\/a>/);
  const source='&copy; &mdash; &NotEqualTilde; &unknownEntity;';
  const result=compile(source);
  assert.match(result.html,/© — ≂̸ &amp;unknownEntity;/);
  const anchors=Object.values(result.map).flatMap(entry=>entry.inline||[]).filter(entry=>entry.construct==='entity');
  assert.deepEqual(anchors.slice(0,3).map(entry=>entry.len),[1,1,2]);
  assert.deepEqual(anchors.map(entry=>source.slice(entry.start,entry.end)),['&copy;','&mdash;','&NotEqualTilde;','&unknownEntity;']);
});

test('URI autolinks accept generic schemes and preserve their displayed spelling', () => {
  for (const target of ['HTTP://example.test', 'ftp://example.test/file', 'custom+v1:entry', 'ab:']) {
    const source = 'Address <' + target + '>.';
    const result = compile(source);
    assert.ok(result.html.includes('<a href="' + target + '">' + target + '</a>'), result.html);
    const anchor = Object.values(result.map)[0].inline.find(entry => entry.construct === 'autolink');
    assert.equal(source.slice(anchor.start, anchor.end), '<' + target + '>');
  }
});

test('thematic breaks interrupt prose without consuming the following paragraph', () => {
  for (const marker of ['***', '___', '* * *', '_ _ _']) {
    const result = compile('Before\n' + marker + '\nAfter');
    assert.deepEqual(result.blocks.map(block => block.construct), ['paragraph', 'thematicBreak', 'paragraph']);
    assert.match(result.blocks[0].html, />Before<\/p>/);
    assert.match(result.blocks[2].html, />After<\/p>/);
  }
  assert.equal(compile('Title\n---').blocks[0].construct, 'setextHeading');
});

test('raw text HTML blocks retain blank lines through their closing tag', () => {
  for (const tag of ['script', 'style', 'pre', 'textarea', 'SCRIPT']) {
    const raw = '<' + tag + '>\nfirst\n\n[x]: /not-a-definition\n</' + tag + '>';
    const source = raw + '\nAfter';
    const result = compile(source);
    assert.equal(result.blocks[0].construct, 'htmlBlock');
    assert.ok(result.blocks[0].html.includes(raw), result.html);
    assert.equal(source.slice(result.blocks[0].start, result.blocks[0].end), raw);
    assert.deepEqual(result.refs, []);
    assert.match(result.blocks[1].html, />After<\/p>/);
    assert.ok(compile('<' + tag + '>\nfirst\n\nlast').html.includes('first\n\nlast'));
  }
});

test('comment closing delimiters retain trailing text and the following Markdown', () => {
  for (const comment of ['<!-- note --> trailing', '<!-- note\ncontinued --> trailing']) {
    const result = compile(comment + '\n\nAfter **comment**.');
    assert.ok(result.blocks.some(block => block.html.includes('trailing')), result.html);
    assert.match(result.blocks.at(-1).html, /After <strong>comment<\/strong>\./);
    assert.equal(result.untouchable[0].end, comment.indexOf('-->') + 3);
  }
  assert.equal(compile('<!-- one --><!-- two -->\n\nAfter').blocks.length, 1);
});

test('raw HTML definitions cannot change links outside their block', () => {
  for (const raw of ['<div>\n[x]: /inside\n</div>', '<table>\n[x]: /inside\n</table>', '<!-- note\n[x]: /inside\n--> trailing', '<?instruction\n[x]: /inside\n?>', '<![CDATA[\n[x]: /inside\n]]>']) {
    const result = compile(raw + '\n\n[x]');
    assert.deepEqual(result.refs, []);
    assert.match(result.blocks.at(-1).html, />\[x\]<\/p>/);
  }
  const after = compile('<div>\nRaw body\n\n[x]: /outside\n\n[x]');
  assert.match(after.blocks.at(-1).html, /href="\/outside">x<\/a>/);
});

test('link definitions inside fenced examples do not affect surrounding prose',()=>{
  for(const fence of ['```','~~~~']){
    const result=compile(fence+'md\n[x]: https://example.test\n'+fence+'\n\n[x]');
    assert.match(result.html,/<code[^>]*>\[x\]: https:\/\/example.test<\/code>/);
    assert.doesNotMatch(result.blocks.at(-1).html,/<a /);
    assert.deepEqual(result.refs,[]);
  }
  const forward=compile('[x]\n\n```md\n[x]: https://example.test/wrong\n```\n[x]: https://example.test/right');
  assert.match(forward.blocks[0].html,/<a href="https:\/\/example.test\/right">x<\/a>/);
});

test('reference links retain optional titles without displaying their definitions', () => {
  for (const title of ['"Docs"', "'Docs'", '(Docs)']) {
    const result = compile('[Guide][g]\n\n[g]: <https://example.test/guide> ' + title);
    assert.match(result.html, /<a href="https:\/\/example.test\/guide" title="Docs">Guide<\/a>/);
    assert.equal(result.blocks.length, 1);
  }
  assert.match(compile('[g]\n\n[g]: /first "First"\n[g]: /second "Second"').html, /href="\/first" title="First"/);
  assert.match(compile('> [g]\n\n[g]: /guide "Docs"').html, /title="Docs"/);
  assert.match(compile('[g]\n\n[g]: /guide "not closed').html, /\[g\]/);
});

test('ATX headings remove closing markers while retaining authored text and identity', () => {
  for (const source of ['# Release notes #', '#\tRelease notes ###  ', '  #   Release notes ## {#release}']) {
    const result = compile(source);
    assert.match(result.html, />Release notes<\/h1>/);
    if (source.includes('{#release}')) assert.equal(result.blocks[0].id, 'release');
  }
  assert.match(compile('# Release notes#').html, />Release notes#<\/h1>/);
  assert.match(compile('# Release notes \\#').html, />Release notes #<\/h1>/);
  assert.match(compile('#').html, /<h1[^>]*><\/h1>/);
  assert.match(compile('####### Plain text').html, /<p[^>]*>####### Plain text<\/p>/);
});

test('numeric references use HTML replacement characters and retain code literals', () => {
  assert.match(compile('&#128; &#x80; &#X80; &#147; &#148; &#129;').html, />€ € € “ ” \u0081<\/p>/);
  assert.match(compile('&#0; &#xD800; &#x110000;').html, />\ufffd \ufffd \ufffd<\/p>/);
  assert.match(compile('`&#128;`').html, /<code>&amp;#128;<\/code>/);
});

test('every block construct anchors the source range it came from', () => {
  for (const [name, source, good] of BLOCK) {
    const entry = Object.values(compile(source).map).find((e) => e.construct === name);
    assert.ok(entry, name + ' 没有产出锚');
    const slice = source.slice(entry.start, entry.end);
    assert.ok(good(slice), name + ' 的锚切出 ' + JSON.stringify(slice));
  }
});

test('every inline construct anchors the source range it came from', () => {
  // 守的是表自己的声明：required 的必须有锚，optional 的有就用、没有也不算错。
  // 拿"我想每个都有锚"去要求它，测的是我的期望，不是编译器。
  for (const [name, source, want] of INLINE) {
    const anchors = Object.values(compile(source).map).flatMap((e) => (e.inline || []).filter((a) => a.construct === name));
    if (!anchors.length) {
      // 没有锚只可能是表里允许 —— 判的是表的声明，不是我的期望。
      assert.equal(TABLE[name].anchor, 'optional', name + ' 声明要锚，编译器却没给');
      continue;
    }
    const slice = source.slice(anchors[0].start, anchors[0].end);
    assert.equal(slice, want, name + ' 的锚切出 ' + JSON.stringify(slice));
  }
});

test('a construct that takes no position is tracked instead of anchored', () => {
  // 两种：引用定义完全不产出，注释产出但不出现在展示位置上。
  // 相同的是都不该有身份 —— 没有位置可标注，却有身份，就等于给了读者一个点不到的东西。
  for (const [construct, source] of [['refDef', '[a]: u\n\n甲。\n'], ['htmlComment', '甲。\n\n<!-- 注 -->\n']]) {
    const { map, untouchable, html } = compile(source);
    assert.ok(!Object.values(map).some((e) => e.construct === construct), construct + ' 不该有身份');
    assert.ok(untouchable.some((u) => u.construct === construct), construct + ' 该进不可标注的跨度');
    assert.ok(!/<[^>]*data-src[^>]*>\s*$/.test(html), construct + ' 结尾不该多出一个带身份的块');
  }
});

test('every construct the table declares is reachable, so the coverage check can see it', () => {
  // 声明了却从不报的构造，锚覆盖检查是看不见的 —— plainText 就这样漏了很久。
  const reachable = new Set();
  for (const [, source] of [...BLOCK, ...INLINE]) for (const c of Object.keys(compile(source).used)) reachable.add(c);
  // 这两个不产出位置，不在 BLOCK/INLINE 的语料里，单独记上。
  reachable.add('refDef');
  reachable.add('htmlComment');
  const unreachable = Object.keys(TABLE).filter((c) => !reachable.has(c));
  assert.deepEqual(unreachable, [], '这些构造声明了但从未报出：' + unreachable.join('、'));
});

test('a table cell range survives an escaped pipe and a pipe inside code', () => {
  // 切错的后果不是渲染难看，是锚指向别的地方。
  for (const [source, want] of [
    ['| a \\| b | c |\n| - | - |\n| 1 | 2 |\n', ['a \\| b', 'c']],
    ['| a | `x|y` |\n| - | - |\n| 1 | 2 |\n', ['a', '`x|y`']],
    ['| a | ``x|y`` |\n| - | - |\n| 1 | 2 |\n', ['a', '``x|y``']],
    ['| a | ```x|`y``` |\n| - | - |\n| 1 | 2 |\n', ['a', '```x|`y```']],
    ['| a | `unclosed | c |\n| - | - | - |\n', ['a', '`unclosed', 'c']],
  ]) {
    const result = compile(source);
    const table = Object.values(result.map).find((e) => e.construct === 'table');
    assert.deepEqual(table.cells[0].map((c) => source.slice(c.start, c.end)), want);
    assert.equal((result.html.match(/<th(?:>| )/g) || []).length, want.length);
    if (source.includes('``x|y``')) assert.match(result.html, /<code>x\|y<\/code>/);
  }
});

test('nested Markdown retains its block structure and inline meaning', () => {
  // CommonMark block nesting and emphasis rules: https://spec.commonmark.org/0.31.2/
  assert.match(compile('> 外层\n> > 内层\n').html, /<blockquote[^>]*><p>外层<\/p>\s*<blockquote><p>内层<\/p><\/blockquote><\/blockquote>/);
  assert.match(compile('- a\n  - b\n    - c\n').html, /<li>a\s*<ul><li>b\s*<ul><li>c<\/li><\/ul><\/li><\/ul><\/li>/);
  assert.match(compile('*a **b** c*\n').html, /<em>a <strong>b<\/strong> c<\/em>/);
  assert.doesNotMatch(compile('a_b_c\n').html, /<em>/);
  assert.match(compile('***x***\n').html, /<em><strong>x<\/strong><\/em>/);
  assert.match(compile('*a *b* c*').html, /<em>a <em>b<\/em> c<\/em>/);
});

test('multiline list items keep continuations and mixed nested lists inside their item', () => {
  const source='3. First line\n   continues with **detail**.\n\n   Second paragraph.\n\n   - Child\n     - Grandchild\n4. Last item\n\nOutside paragraph.';
  const html=compile(source).html;
  assert.match(html, /<ol start="3"[^>]*><li><p>First line continues with <strong>detail<\/strong>\.<\/p>\s*<p>Second paragraph\.<\/p>\s*<ul><li>Child\s*<ul><li>Grandchild<\/li><\/ul><\/li><\/ul><\/li><li><p>Last item<\/p><\/li><\/ol>/);
  assert.match(html, /<\/ol>\s*<p[^>]*>Outside paragraph\.<\/p>/);
  assert.match(compile('- One\n1. Two').html, /<\/ul>\s*<ol/);
});

test('empty table cells, invalid numeric entities and code delimiters preserve content', () => {
  const html=compile('| A | B | C |\n| --- | --- | --- |\n| one | | three |\n| | two | |').html;
  assert.match(html, /<td>one<\/td><td><\/td><td>three<\/td>/);
  assert.match(html, /<td><\/td><td>two<\/td><td><\/td>/);
  assert.match(compile('&#x110000; &#0;').html, /\ufffd \ufffd/);
  assert.match(compile('`` `code` ``').html, /<code>`code`<\/code>/);
  assert.match(compile('`a``b`').html, /<code>a``b<\/code>/);
  assert.match(compile('first\\\nsecond').html, /first<br>second/);
});

test('linked images, balanced URL parentheses and link titles remain separate fields', () => {
  assert.match(compile('[![badge](badge.svg)](https://example.test/project)').html, /<a href="https:\/\/example.test\/project"><img src="badge.svg" alt="badge"><\/a>/);
  assert.match(compile('[page](https://example.test/a_(b) "Reference")').html, /href="https:\/\/example.test\/a_\(b\)" title="Reference">page<\/a>/);
  assert.match(compile('![badge][icon]\n\n[icon]: badge.svg').html, /<img src="badge.svg" alt="badge">/);
  assert.match(compile('<https://example.test/page>').html, /<a href="https:\/\/example.test\/page">https:\/\/example.test\/page<\/a>/);
});
