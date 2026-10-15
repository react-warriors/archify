# Archify document tool

Render Markdown using an existing HTML design. The tool receives content and a
design, then returns a saved HTML file and a render report. It uses Archify's
existing document renderer and atomic output handling.

The input direction is **Markdown + HTML design → rendered HTML**.
The tool is independent of any agent's conversation format. A caller can pass
its final Markdown answer as text, or provide a Markdown file. The caller chooses
which conversation content to pass; the tool does not collect conversation or
agent activity data. A supplied HTML design can be an existing page or a file
created by the caller. Its CSS and scripts remain part of that design.

## MCP

Requires Node.js 20+ and local Chrome. From the repository root, prepare the
adapter's dependencies and start the stdio server:

```sh
npm --prefix integrations/mcp ci
node integrations/mcp/server.mjs
```

Configure the MCP client with this process launch definition, using an absolute
path to the checkout. Map these fields into the client's own configuration
format; configuration file formats vary between clients.

```json
{
  "command": "node",
  "args": ["/absolute/path/to/archify-repository/integrations/mcp/server.mjs"]
}
```

The server exposes `render_markdown`, `scan_html` and `list_document_templates`. It uses the official
[MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html)
for stdio and protocol handling, including modern discovery and the legacy
initialization handshake. It does not require a Skill or a client-specific
plugin. Setting `ARCHIFY_CHROME` in the launch environment selects an existing
Chrome executable.

Discover the three report layouts and saved user designs with list_document_templates.
Its optional `library_path` selects a library; the default is `.archify/templates`
under the current user home. Use returned `library_path` when naming a newly saved
template and a `saved_templates` entry's `path` as `template_path` on later calls.
Rendering accepts
one design source: design_path, design_url, template or template_path; omitted
designs use review/static. Capturing a reusable template uses:

```json
{"tool":"scan_html","arguments":{"design_url":"https://example.test/page","template_dir":"/path/new-template"}}
```

Then render with template_path pointing to that directory. content_selector and
exclude_selector optionally define the content scope in either tool. They select
DOM regions and do not interpret prose. Saved metadata and resource behavior are
specified in the [document interface](../../archify/document/README.md).

Example tool arguments:

```json
{
  "markdown": "# Weekly review\n\n## Results\n\nThe first experiment is complete.",
  "design_path": "/absolute/path/to/design.html",
  "output_path": "/absolute/path/to/review.html"
}
```

To read a file, replace `markdown` with `markdown_path`. Supply exactly one of
those fields. `title` is an optional browser-title fallback when there is no H1.
Absolute paths avoid depending on the client's working directory. Relative file
paths and inline Markdown links resolve from the server working directory;
design assets resolve from the HTML file's directory.

`design_options` optionally passes a JSON object to HTML designs that declare a
`<script type="application/json" data-document-options>` entry. Option names and
behavior belong to the design. Without a declared entry, the HTML is unchanged
and `report.designOptionsApplied` is false; with one, supplied fields override
its existing defaults. See the [document interface](../../archify/document/README.md) for custom design configuration.

## JSON command line

Agents that can run commands can call the same tool without MCP dependencies.
The JSON entry point retains the core package's Node.js 18+ requirement.

```sh
node archify/bin/document-tool.mjs request.json
node archify/bin/document-tool.mjs - < request.json
node archify/bin/document-tool.mjs --schema
node archify/bin/document-tool.mjs --schemas
```

`request.json` contains renderer arguments or an envelope with tool and arguments
for scan_html or list_document_templates. Standard output contains
one JSON response. Success exits with 0; failure exits with 1. An empty Markdown
string is valid input.

Successful responses contain `ok: true`, `output.path`, `output.url`,
`output.bytes`, `output.sha256` and the renderer's `report`. Failures contain
`ok: false` and `diagnostics[]`. MCP returns the same data in `structuredContent`
and text, with `isError: true` on failure.

An output may replace an existing regular HTML file after successful rendering.
The shared output checks protect both input files and their filesystem aliases.
Failed mapping or page initialization preserves the previous output. HTML
scripts run in a separate Chrome instance to check initialized content; this
does not validate every later interaction or timer.

The tool shares the current Markdown compiler's capabilities and limitations.
This adapter does not add a template-specific workaround or change the Markdown
input language.

## Verify

```sh
npm run test:focus -- test/document-tool.test.mjs test/document-html-render.test.mjs test/document-report-designs.test.mjs
npm --prefix integrations/mcp test
```

The MCP test uses the official client against a real stdio child process in both
protocol eras. The rendering checks use real Chrome and cover inline/file
inputs, matching CLI output, diagnostics, preserved output, input protection
and cancellation before work starts. No live agent installation is needed.
