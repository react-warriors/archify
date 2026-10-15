// 检查扫描器请求的导航功能所需的输入。
export function plan(compiled, actions) {
  const rows = [], unmet = [];
  for (const action of new Set(actions)) {
    if (action !== 'toc') {
      unmet.push({ code: 'document/action-inputs-unknown', action });
      continue;
    }
    const missing = Array.isArray(compiled.blocks) ? [] : ['blocks'];
    rows.push({ action, supplied: missing.length ? [] : ['blocks'], missing,
      external: [], missingExternal: [], inputsSufficient: missing.length === 0 });
    if (missing.length) unmet.push({ code: 'document/action-input-missing', action, missing, external: [] });
  }
  return { ok: unmet.length === 0, rows, unmet };
}
