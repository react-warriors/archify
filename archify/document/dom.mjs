// 页面扫描、填充和执行检查共享同一套 DOM 操作。
export const DOM = function () {
  const heading = 'h1,h2,h3,h4,h5,h6';
  const footnote = '[role="doc-footnote"],[role="doc-endnotes"]';
  const block = heading + ',p,pre,table,blockquote,ul,ol,dl,figure,hr,' + footnote;
  const children = (el) => [...el.children];
  const pathOf = (el, root = document.body) => {
    const path = [];
    while (el && el !== root) {
      path.unshift(children(el.parentElement).indexOf(el));
      el = el.parentElement;
    }
    return el === root ? path : null;
  };
  const atPath = (path, root = document.body) => path?.reduce((el, i) => el?.children[i], root);
  const commonParent = (els) => {
    let el = els[0]?.parentElement;
    while (el && !els.every((node) => el.contains(node))) el = el.parentElement;
    return el;
  };
  const levelOf = (el) => el?.matches(heading) ? Number(el.tagName.slice(1)) : 0;
  const roleOf = (el) => !el ? null : levelOf(el) ? 'heading' : el.tagName;
  const textOf = (el) => {
    const copy = el.cloneNode(true);
    for (const child of copy.querySelectorAll('script,style,[aria-hidden="true"]')) child.remove();
    return el.matches('pre') ? copy.textContent : copy.textContent.replace(/\s+/g, ' ').trim();
  };
  const resourcesOf = (el) => {
    const selector = 'a[href],img,audio,video,source,iframe,object,input[type="checkbox"],pre';
    return [...(el.matches(selector) ? [el] : []), ...el.querySelectorAll(selector)].flatMap(node => {
    const attrs = ['href','src','srcset','poster','data','alt','title'].filter(name => node.hasAttribute(name));
    if (node.matches('input[type="checkbox"]')) return [{tag:'INPUT',checked:node.checked}];
    if (node.matches('pre')) return [{tag:'PRE',text:textOf(node)}];
    return attrs.length ? [{tag:node.tagName,...Object.fromEntries(attrs.map(name => [name,node.getAttribute(name)]))}] : [];
    });
  };
  const fail = (code, evidence = {}) => ({ ok: false, unmet: [{ code, ...evidence }] });

  const excluded = (el, root = document.body) => {
    for (let parent = el; parent && parent !== root; parent = parent.parentElement) {
      if (parent.matches('nav,[role="navigation"],footer,form')) return true;
      if (parent.matches('aside') && !el.closest(footnote)) return true;
    }
    return false;
  };
  const slotsIn = (root, ignore = () => false) => {
    const candidates = [...root.querySelectorAll(block)];
    if (!candidates.length && root.matches(block)) candidates.push(root);
    return candidates.filter((el) => {
      if (excluded(el, root) || ignore(el)) return false;
      for (let parent = el === root ? null : el.parentElement; parent && parent !== root; parent = parent.parentElement) if (parent.matches(block)) return false;
      return true;
    });
  };

  return { heading, pathOf, atPath, commonParent, levelOf, roleOf, textOf, resourcesOf, fail, excluded, slotsIn };
};

export function inPage(fn, argument = null) {
  return '(' + fn.toString() + ')((' + DOM.toString() + ')(),' + JSON.stringify(argument).replace(/</g, '\\u003c') + ')';
}
