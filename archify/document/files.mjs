import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { throwDiagnosticError } from '../renderers/shared/diagnostics.mjs';
import { resolveOutputPath } from '../renderers/shared/output-path.mjs';
import { captureAtomicOutput, captureRegularFileBinding, publishRegularFileBinding, releaseRegularFileBinding, removeOwnedRegularFile } from '../renderers/shared/atomic-output.mjs';
import { render } from './render.mjs';
import { documentBrowser, createDocumentBrowser } from './browser.mjs';
import { resolveDesign } from './templates.mjs';
import { scanFixes } from './scan.mjs';

const renderFixes = (code) => {
  if (code === 'document/runtime-error' || code === 'document/runtime-content-changed' || code === 'document/runtime-resource-changed')
    return ['repair the HTML initialization script so it reads and preserves the mapped content'];
  if (code === 'document/source-identity-duplicate') return ['give each explicit Markdown heading ID a unique value'];
  if (code === 'document/heading-id-conflict') return ['choose an explicit heading ID that does not collide with preserved HTML controls'];
  if (code.includes('selector') || code === 'document/content-root-excluded' || code === 'document/unmapped-content-region' || code === 'document/exclusion-crosses-content')
    return scanFixes(code);
  return ['inspect the reported HTML positions and adjust the design containers or required inputs'];
};

// CLI 与工具共用文件读取、浏览器检查和原子输出。
export async function renderDocument(request) {
  request.signal?.throwIfAborted();
  const inputPath = request.inputPath ? path.resolve(request.inputPath) : null;
  let sourceText;
  try {
    if (request.markdown !== undefined) sourceText = request.markdown;
    else {
      const bytes = fs.readFileSync(inputPath);
      try { sourceText = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
      catch { throwDiagnosticError('The document input is not valid UTF-8 text.', [{code:'document/source-encoding',message:'The document input is not valid UTF-8 text.',subject:{input:inputPath},supportedFixes:['save the draft as UTF-8 and retry']}]); }
    }
  } catch (error) {
    if (error.archifyDiagnostics) throw error;
    throwDiagnosticError('The document input could not be read.', [{
      code: 'document/input-unreadable',
      message: 'The document input could not be read.',
      subject: { input: inputPath },
      evidence: { reason: String((error && error.code) || (error && error.message) || error) },
      supportedFixes: ['check that the input path exists and is a readable Markdown file'],
    }]);
  }
  if (sourceText.includes('\u0000')) {
    throwDiagnosticError('The document input is not valid UTF-8 text.', [{
      code: 'document/source-encoding',
      message: 'The document input is not valid UTF-8 text.',
      subject: { input: inputPath },
      supportedFixes: ['save the draft as UTF-8 and retry'],
    }]);
  }

  const optionsPath = request.designOptionsPath ? path.resolve(request.designOptionsPath) : null;
  let designOptions = request.designOptions;
  if (optionsPath) {
    try { designOptions = JSON.parse(fs.readFileSync(optionsPath, 'utf8')); }
    catch (error) {
      throwDiagnosticError('The design options could not be read.', [{
        code: 'document/design-options-unreadable', message: 'The design options could not be read.',
        subject: { input: optionsPath }, evidence: { reason: error.code || error.message },
        supportedFixes: ['provide a readable JSON object after --design-options'],
      }]);
    }
  }
  if (designOptions !== undefined && (!designOptions || typeof designOptions !== 'object' || Array.isArray(designOptions))) {
    throwDiagnosticError('Design options must be a JSON object.', [{
      code: 'document/design-options-invalid', message: 'Design options must be a JSON object.',
      subject: { input: optionsPath, argument: 'design_options' }, supportedFixes: ['provide a JSON object containing options supported by the HTML design'],
    }]);
  }
  let source;
  try { source = await resolveDesign(request); }
  catch (error) {
    if (error.archifyDiagnostics) throw error;
    throwDiagnosticError('The HTML design could not be read.', [{
      code: 'document/design-unreadable', message: 'The HTML design could not be read.',
      subject: { input: request.designPath || request.designURL || request.templatePath || request.template }, evidence: { reason: error.code || error.message },
      supportedFixes: ['provide a readable HTML file after --design'],
    }]);
  }
  const designPath = source.designPath || fileURLToPath(new URL('./default.html', import.meta.url));
  let page, report;
  const outputRequest = { requestedOutput: request.outputPath || undefined, defaultOutput: 'document.html', inputPaths: [inputPath, designPath, optionsPath, ...source.protectedInputs].filter(Boolean), inputDescription: 'the document input' };
  const { outputPath } = resolveOutputPath(outputRequest);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const capture = captureAtomicOutput(outputPath, { requestedEntryPolicy: 'regular-or-absent' });
  if (capture.status !== 'captured') {
    throwDiagnosticError('Could not capture the document output safely.', [{
      code: 'output/target-indeterminate', message: 'Could not capture the document output safely.',
      subject: { output: outputPath }, evidence: { reason: capture.reason },
      supportedFixes: ['choose a writable regular-file output destination and retry'],
    }]);
  }
  const browser = createDocumentBrowser();
  const abort = () => { void browser.close().catch(() => {}); };
  request.signal?.addEventListener('abort', abort, { once: true });
  try {
    const io = await documentBrowser(browser, outputPath);
    const result = await render(io, source.html, sourceText, {
      sourceURL: pathToFileURL(inputPath || path.join(process.cwd(), 'document.md')).href, designURL: source.sourceURL || pathToFileURL(designPath).href,
      title: request.title ?? (!request.designPath && !request.designURL && !request.template && !request.templatePath && inputPath ? path.basename(inputPath) : undefined),
      designOptions, contentSelector: source.contentSelector, excludeSelector: source.excludeSelector,
    });
    if (!result.report.ok) {
      throwDiagnosticError('The HTML design could not be filled: ' + JSON.stringify(result.report.unmet),
        result.report.unmet.map(({ code, ...evidence }) => ({
          code, message: 'The HTML design could not be filled.', subject: { input: inputPath, design: source.sourceURL || designPath },
          evidence, supportedFixes: renderFixes(code),
        })));
    }
    page = result.html; report = result.report;
  } finally {
    request.signal?.removeEventListener('abort', abort);
    await browser.close();
  }

  request.signal?.throwIfAborted();
  const bytes = Buffer.from(page);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const candidate = path.join(path.dirname(capture.commitPath), '.' + 'archify-document-' + randomUUID() + '.html');
  let binding;
  let owned;
  try {
    fs.writeFileSync(candidate, bytes, { flag: 'wx', ...(capture.mode === null ? {} : { mode: capture.mode }) });
    const stat = fs.lstatSync(candidate, { bigint: true });
    owned = { device: stat.dev, inode: stat.ino };
    if (capture.mode !== null) fs.chmodSync(candidate, capture.mode);
    const staged = captureRegularFileBinding(candidate, {
      expectedIdentity: owned,
      expectedSha256: sha256,
      expectedBytes: bytes.length,
    });
    if (staged.status !== 'captured') throw new Error('Could not bind the document candidate.');
    binding = staged.binding;
    resolveOutputPath(outputRequest);
    request.signal?.throwIfAborted();
    const result = publishRegularFileBinding(binding, candidate, capture.snapshot, { subject: 'document-output' });
    if (!['committed', 'committed-with-warning'].includes(result.status)) {
      throw new Error('Could not publish the document output (' + (result.reason?.code || result.status) + ').');
    }
  } finally {
    if (binding) releaseRegularFileBinding(binding);
    if (owned) removeOwnedRegularFile(candidate, owned, { subject: 'document-output' });
  }

  return { ok: true, output: { path: outputPath, url: pathToFileURL(outputPath).href, bytes: bytes.length, sha256 }, report };
}
