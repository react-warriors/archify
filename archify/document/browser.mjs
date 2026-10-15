import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {ChromeVisualBrowser,findChrome} from '../bin/visual-check.mjs';
import {throwDiagnosticError} from '../renderers/shared/diagnostics.mjs';

export function createDocumentBrowser(){
  const executable=findChrome();
  if(!executable)throwDiagnosticError('Chrome is unavailable.',[{code:'document/chrome-unavailable',severity:'error',message:'Chrome is unavailable.',subject:{stage:'browser'},supportedFixes:['install Chrome or set ARCHIFY_CHROME to an existing executable']}]);
  return new ChromeVisualBrowser(executable);
}

// 每次加载都重建页面，执行检查不会把运行时生成的节点写入产物。
export async function documentBrowser(browser, documentPath) {
  const session = await browser.sessionPromise;
  const errorKey = '__render_' + randomUUID().replaceAll('-', '');
  const run = async (expression) => {
    const result = await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  return {
    run,
    errors: async () => await run('window[' + JSON.stringify(errorKey) + ']') || ['The page execution check could not be initialized.'],
    load: async (html, { scripts = false } = {}) => {
      await browser.cdp.send('Emulation.setScriptExecutionDisabled', { value: true }, session);
      if (scripts) {
        const probe = await run(`(() => {
          const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html');
          const script = doc.createElement('script');
          const key = ${JSON.stringify(errorKey)};
          script.textContent = 'window[' + JSON.stringify(key) + ']=[];addEventListener("error",event=>{const message=event.message||(event.target?.tagName==="SCRIPT"&&event.target.src?"Script could not be loaded: "+event.target.src:"");if(message)window[' + JSON.stringify(key) + '].push(message)},true);addEventListener("unhandledrejection",event=>window[' + JSON.stringify(key) + '].push(String(event.reason)))';
          doc.head.prepend(script);
          return '<!doctype html>' + doc.documentElement.outerHTML;
        })()`);
        html = probe;
      }
      await browser.cdp.send('Emulation.setScriptExecutionDisabled', { value: !scripts }, session);
      // 校验使用最终页面地址，候选 HTML 由浏览器协议提供，不提前写入输出文件。
      const url = pathToFileURL(documentPath).href;
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session); loaded.catch(() => {});
      await browser.cdp.send('Fetch.enable', { patterns: [{ urlPattern: url, resourceType: 'Document', requestStage: 'Request' }] }, session);
      try {
        const paused = browser.cdp.waitFor('Fetch.requestPaused', session); paused.catch(() => {});
        const navigation = browser.cdp.send('Page.navigate', { url }, session); navigation.catch(() => {});
        const request = await paused;
        await browser.cdp.send('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: 200,
          responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from(html).toString('base64') }, session);
        const result = await navigation;
        if (result.errorText) throw new Error(result.errorText);
      } finally {
        await browser.cdp.send('Fetch.disable', {}, session);
      }
      await loaded;
      if (scripts) await run('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
    },
  };
}
