# Native document components

Choose a preset, mark its paragraphs, and call the existing document renderer.
Marks specify presentation positions; they do not classify the text's meaning.
The same marks work in a file or an answer passed as the `markdown` string.

Use `render_markdown` with `design_path` pointing to the package's
`document/designs/components/native.html`, or:

```sh
node /path/archify/bin/archify.mjs document report.md report.html --design /path/archify/document/designs/components/native.html --json
```

These marks require HTML that implements them. The three report layouts remain
ordinary Markdown designs; `native.html` is an additional HTML input.

```md
## [g1:regions] Section title

[g1.1.1] First region's paragraph.

[g1.2.1] Second region's first paragraph.

[g1.2.2] Second region's next paragraph.
```

`g1` is the instance, `regions` the preset; `g1.2.1` addresses region 2,
position 1. Use one instance per H2 section and provide all listed positions.

| Preset | Positions | Layout |
| --- | --- | --- |
| `regions` | `1.1`; `2.1`, `2.2` | One node in the first region; two connected nodes in the second |
| `converge` | `1.1`, `1.2`; `2.1` | Two nodes → one node |
| `branch` | `0.1`–`0.3`; `1.2` | Three main nodes; a branch from the second |
| `lanes` | `1.1`, `2.2`, `1.3`, `2.4` | Four ordered steps across two regions |
| `decompose` | `0.1`; `1.1`, `1.2`; `2.1`–`2.4` | One → two → four nodes |
| `return` | `0.1`–`0.3`; `1.2` | Main path, return to the first node, wait branch at the second |

A mark applies to the whole paragraph, including continuation lines. Repeated
addresses append paragraphs in source order. Unmarked content stays in the
document flow; bold, links and inline code are preserved.

Position counts and capacity are fixed; keep `return` text short. Invalid,
incomplete or oversized input retains readable source with a notice and a
`report.warnings` entry. Positions accept text paragraphs, not embedded media. Choose a
suitable preset or keep prose; do not discard text to force a fit.

[Complete Markdown example](../document/designs/examples/native-components.md).
