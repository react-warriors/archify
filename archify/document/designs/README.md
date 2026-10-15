# Markdown report designs

Three standalone HTML inputs for the document renderer. Each file includes its
CSS, JavaScript and SVG drawing code; opening the rendered output requires no
chart library, network request or asset directory.

| HTML input | Intended use | Reading structure |
| --- | --- | --- |
| `decision.html` | Recommendation, proposal or resource decision | Full-width opening and evidence sections; parallel option conditions and two-axis measurement views |
| `analysis.html` | Investigation, experiment or technical analysis | A continuous reading column with object/condition branches, dot comparisons and measured sample profiles |
| `review.html` | Retrospective, delivery review or improvement follow-up | Complete chapter bodies follow authored record order; differences, date intervals, observations and ordered actions stay together |

These files are design instances. The CLI scans and fills them through the same
pipeline as any other HTML input. Their chart behavior stays inside the HTML;
the scanner and renderer contain no report-name dispatch or business rules.

## Use

From the repository root:

```sh
node archify/bin/archify.mjs document report.md report.html --design archify/document/designs/decision.html
node archify/bin/archify.mjs document report.md report.html --design archify/document/designs/analysis.html
node archify/bin/archify.mjs document report.md report.html --design archify/document/designs/review.html
```

Use an H1 for the document title, introductory paragraphs for the lead, and H2s
for chapters. H3s, quotes, emphasis, lists, tables and code blocks keep their
ordinary Markdown roles. The design does not classify a chapter by keywords:
put the recommendation first when writing a decision brief. The renderer can
repeat the chapter containers for additional chapters.

`examples/common.md` compares all three layouts with the same content.
`examples/decision.md`, `examples/analysis.md` and `examples/review.md` demonstrate
their respective uses. All example measurements are fictional and identified
as demonstration data in the source.

The toolbar uses the repository's canonical Archify symbol and wordmark.
Review uses a light header and restrained blue accents. Its guide labels suggest
results, differences and improvements; Markdown determines the actual chapter
content and order.

## Purpose-specific body composition

Choosing a report selects a presentation, without assigning meanings to arbitrary
sentences or classifying headings by keywords. Put the intended reading order
in the Markdown itself; quotations and leading emphasis provide explicit
highlights, while the actual columns and list structure supply diagram inputs.

- Decision uses a prominent opening quote, full-width comparisons, parallel
  text conditions for 2–4 records, and clear authored next steps. A larger text
  table stays a table rather than becoming a crowded comparison board.
- Analysis connects each text-table object to its stated conditions or
  explanations from left to right. Code and prose remain in the reading flow.
  Numeric input coordinates can supply a sample profile alongside the existing
  comparisons, so variation and measured differences can be read separately.
- Review keeps the complete body of each chapter on a restrained record rail.
  The rail expresses chapter order, with no inferred event dates or statuses.
  Text records show their observations together; explicit date intervals and
  numbered steps keep their existing figures.

These three report designs use ordinary Markdown. The optional
[native component design](../../references/document-components.md)
supports explicit paragraph placement through the same renderer; its declarations
do not change the ordinary report layouts.

## SVG figures

Figures read the mapped HTML tables and lists after the renderer fills the new
content. Measurement figures retain their original table alongside the figure.
Text diagrams present the original cells or list nodes directly, including
their links, emphasis and code; there is no second body-text viewer.
Hovering or focusing a plotted item highlights its source row. Unrelated units
have separate scales; two columns with the same explicit unit can share a scale.
List diagrams keep the original list under an expandable source control.

- **Object attributes:** a text table with 2–4 columns and 2–12 rows can become
  an object-and-attribute diagram. The first cell is the object node; branches
  connect it to the other cells in that same row, labelled by the original
  column headers. Entire explanations appear in the diagram, with their
  original inline markup. Lines express row membership, without inferred
  dependencies, causality or chronology. Missing cells, numeric/date content,
  media, merged cells and oversized labels retain their ordinary table view.
  Decision limits its parallel comparison to four rows; analysis uses horizontal
  branches, and review uses record lanes. All retain the original cell nodes.
- **Labelled statements:** flat unordered lists of 2–12 items whose opening
  `strong` or `code` element labels a following explanation become labelled
  statement diagrams. Each branch connects an original label to its own full
  explanation. Lists without that explicit shape retain their normal view.
  Chapters made only of prose remain prose, without an extra heading graph.
- **Numeric comparison:** the first column supplies category labels. A later
  column becomes a chart only when every row contains a finite number and its
  unit is explicit: a header such as `时间（ms）`, or consistent suffixes such as
  `12ms` and `18ms`. If both declare units, they must match exactly. Missing
  values, mixed units and unqualified identifier columns stay in the table.
  Decision and review use bars; analysis uses dots. No conversion or completion
  percentage is inferred.
- **Paired comparison:** when exactly two eligible numeric columns have the
  same unit, their original headers identify two endpoints on a shared axis.
  The connecting segment shows the gap, with an explicitly signed difference
  calculated as the second column minus the first. Percentages use percentage
  points for the difference. No column is assumed to mean a target, baseline,
  improvement or progress; other numeric tables keep their independent plots.
- **Two-axis positions:** decision adds a position plot when there are exactly
  two eligible numeric columns with different explicit units and 2–12 rows.
  Each axis uses its original header and unit; the row label identifies the
  record. Coincident records share one marker with all their source ordinals.
  This adds no score, preferred direction, ranking or automatic recommendation.
  Both original single-column plots remain available below it.
- **Sample profiles:** analysis adds a connected sample plot when the first
  column has finite numeric coordinates with an explicit unit, and 1–3 later
  eligible columns share one unit. Points retain the original measurements;
  connections follow increasing input coordinate. The table stays in authored
  order. No fitted curve, interpolation or causal relation is supplied, and
  the original numeric or paired comparisons remain available.
- **Date intervals:** the first column supplies labels; distinct columns named
  `开始` / `起始` / `开始日期` / `起始日期` / `start` and
  `结束` / `截止` / `结束日期` / `截止日期` / `end` supply dates. Every value must be
  a valid `YYYY-MM-DD`, with end on or after start. Missing or invalid dates keep
  the original table without a timeline. Dates express an interval, not progress.
- **Ordered steps:** review also draws immediate chapter-body ordered lists
  containing 2–12 flat items. Short sequences use connected horizontal cards
  when there is sufficient room; others use a vertical flow. Authored numbering
  and complete text remain intact. The arrows express order, without assuming
  causality, duration or status. Nested ordered lists retain the original list.
- **List hierarchy:** nested unordered lists become node-and-branch diagrams.
  Each line follows an existing parent/child list relationship, without merging
  labels or inventing a common root. Flat lists stay as ordinary lists. Large
  lists (over 32 nodes) retain their source without an extra diagram.

`examples/information.md` combines paired values, a nested list, ordered actions
and dated intervals. It uses ordinary Markdown, without chart directives or
extra metadata. These drawings consume the mapped HTML structure; they do not
repair Markdown parsing. The existing compiler limitation with list continuation
paragraphs and deeper nesting remains a separate concern.

These are optional presentation choices of these three designs. Other supplied
HTML files keep their own computations and input requirements.

`content-graphs.js` draws the text connectors over the positions of the original
HTML cells and list nodes. `content-graphs.css` controls those diagram surfaces;
`purpose-layouts.css` gives each family its own body composition. `report.css`
retains the existing report appearance and layout safeguards. `report.js` owns
the shared unit checks and all measurement figures, including the added views.

## Interactive queries

Static Markdown supplies the facts; the reader changes the question asked of
them. Controls operate locally in the HTML and never modify the original
Markdown, table values, list relationships or authored order.

- **Compare gaps:** paired charts can sort by absolute difference, switch which
  original column is the reference, and switch between endpoints and a signed
  difference distribution. The equation and largest gap update with the query.
  The original source table stays in its original order. Reset restores all
  three controls; reversing the reference changes the sign, not the raw values.
- **Inspect a date:** an interval chart's day slider draws a cursor and highlights
  intervals covering that date, including both endpoints. A readout gives the
  exact date, count and labels. Same-day records also participate. Coverage does
  not indicate task completion; clearing the cursor restores an unfiltered view.
- **Trace a relationship:** selecting a hierarchy node highlights its ancestors
  and descendants while retaining the other nodes as context. The path and
  descendant count come from the list structure. Use the node picker, click a
  node, or press Enter/Space on a focused node; Esc or reset shows all relations.

These interactions are queries and alternative views of existing information.
Simulating a change would additionally require an explicit formula or dependency
model; the designs do not infer one from prose. Query state resets when reopening
the page. Printing hides controls, keeps the current comparison/date readout and
complete source, and shows the full hierarchy.

Linked resources remain ordinary links; the report designs do not expand or embed them.

## Edit and verify

Edit `report.css`, `report.js` or the shell in `build.mjs`, then rebuild the three
self-contained inputs:

```sh
node archify/document/designs/build.mjs
npm run test:focus -- test/document-report-designs.test.mjs test/document-html-render.test.mjs
```

The browser checks cover data replacement, preserved source, missing inputs,
signed values, paired differences, comparison controls, date coverage queries,
hierarchy selection, numbering, chapter navigation, narrow viewports, keyboard
chart focus, appearance switching and print media. Printing hides reading
controls and retains the source tables and SVG figures. Paragraphs and tables share their chapter width. Long cell values wrap; tables
that still exceed that width scroll inside their own container on screen.

## Design references

- Archify's existing SVG renderers provide examples of native SVG primitives,
  view boxes and readable text; no typed diagram input is required here.
- [IBM Design Language — Data visualization basics](https://www.ibm.com/design/language/data-visualization/design/basics/)
  informed hierarchy, restrained emphasis and direct labels.
- [Observable Plot — Bar marks](https://observablehq.github.io/plot/marks/bar)
  provides the reference for categorical comparisons against a quantitative
  axis. The designs draw native SVG and do not load Observable Plot.

AM's chapter containers and navigation were a layout reference. These designs
use their own structure and controls, without annotation or replay features.
