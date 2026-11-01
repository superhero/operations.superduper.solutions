# Workflow visualization nodes

Add one visualization node and choose **Line**, **Bar**, **Pie**, **Area**,
**Scatter**, **Sankey**, or **Table**. The selection changes its input ports and
configuration using the same pattern as logical nodes. The workflow canvas owns
configuration and connections; rendered results belong to the workflow run.

The run opens on **Forms**, with a named tab for each visualization, including
views inside nested workflows. Switch tabs to inspect results while retaining
form values and active requests. Wheel over an overflowing tab bar to scroll it
left/right; horizontal trackpad scrolling and Shift+wheel also work. The run uses the available window with compact
margins, leaving most of its height for the active graph. Arrow keys, Home and End navigate tabs. Quit
cancels the run and releases its requests and chart resources.

Charts use the active theme's tones and blends of those tones for marks, axes,
legends and tooltips. Data colors interpolate between four authored tones; the
other two provide backgrounds and outlines. Colors are based on normalized series
or category names and follow palette and light/dark changes. Exact RGB collisions
are resolved in name order within a view, so reordered inputs keep their colors.
A single series with the default name uses
its view title. Graphs use solid colors by default. Under **Settings → Application
→ Chart patterns**, opt in separately for each graph type: dashed/dotted Line
styles, or diagonal/vertical/horizontal lines and dots for Bar, Area, Pie, Scatter
and Sankey. These browser preferences persist independently of workflow files.
Pie shows percentages inside slices.
Overlapping slice labels are hidden. Legends wrap onto multiple rows with space
reserved above the plot. Very crowded legends keep paging to preserve graph space;
wheel over the legend to navigate it without zooming the plot. Long individual
names truncate with hover details. Legend selection and page position survive tab
changes and live updates during the run; Reset view restores both.

## Inspection controls

Chart action buttons use bundled font icons with tooltips and accessible names.
Production serves the modular graph engine and its notices under `charts/` to
keep the main HTML below the hosting file limit. Both files belong to the verified
static deployment bundle; development resolves the same pinned ECharts modules.
Pause switches to a resume symbol while frozen; Sankey's clear-selection icon
retains a visible selection-count badge.

Drag directly on Line, Bar, Area or Scatter to select the region to zoom into.
A plain drag selects a rectangle on both axes. Hold Shift to select only the
dominant horizontal or vertical axis; narrow drags without Shift are ignored.
A theme-colored outline previews the selection. Escape cancels it.
These graphs also have range handles below the plot and **Zoom in** / **Zoom out**
buttons. The wheel zooms over the plot without a modifier key; Alt+drag pans.
Pie and Sankey also support wheel magnification around the pointer. Use Shift+wheel
or their scrollbars to pan.
**Reset view** restores the full extent and shows all legend entries again.
Click legend labels to hide or show series/categories. Zoom and legend choices
survive tab changes and live updates during the run.

In Sankey, click a node to highlight its connected flows, or click a flow to
highlight that connection and its endpoints. Multiple clicks combine highlights;
click an explicitly selected item again to remove its selection. Hover shows
values without changing highlights. **Clear highlights** removes all selections
while keeping zoom; **Reset view** clears them and restores the full extent.
Selections follow node names and source/target pairs across tab changes and live
updates, and belong only to the current run.

**Pause updates** freezes this view for inspection while its requests and other
views continue. **Resume updates** shows the latest bounded display window; it does
not accumulate an unbounded backlog. Paused snapshots, zoom and filters belong only
to the current run. **Save SVG** downloads the current graph. Table has a text
filter, 50-row pages and **Save JSON** for the matching rows and column headings.
Paging uses circled arrow icons and shows only the directions available on the
current page. The page/row count stays centered when a direction is unavailable.

Table data uses monospace text and subtle alternating row tints. Numeric columns
and their headings align right; genuine boolean columns and headings center, with
theme-blended green `true` and red `false` labels. Missing values stay blank.
Mixed columns and literal strings keep their original text, including numeric IDs.
Types and decimal precision are inferred from the full retained window, so filters
and pages do not change the column format. Numeric columns use shared fixed
decimals, ignoring small floating-point tails. Extremely small/large values use
scientific notation to avoid excessive padding. Formatting affects display and
search only; JSON exports retain the original cell text.

## Inputs

- Line, Area, Bar and Scatter have one input port per named series. Add or remove
  series independently; their stable identities preserve connections when renamed.
  A series accepts numbers or rows with optional X/value field selections. Use
  JSON pointers such as `/time` and `/cpu`; an empty value path uses numeric rows,
  and an empty X path uses consecutive sample numbers. X axes support labels,
  numbers or timestamps. Zero values and null gaps are preserved.
- Pie has a Slices input with optional label/value fields.
- Sankey has separate Nodes and Links inputs. Nodes are names or records with a
  name field. Links have source, target and nonnegative value fields. Paths default
  to `/name`, `/source`, `/target` and `/value`. Names must be unique, references
  must exist, and links must form an acyclic graph.
- Table has a Rows input. Columns are detected from the first record, or configured
  as headings and field paths. Cells render as text; pages contain 50 rows.

For example, connect `[{"time":0,"cpu":42,"memory":68}]` to both CPU and Memory
series ports. Choose `/time` for X in both, `/cpu` for CPU's value and `/memory`
for Memory's value. These optional field selections interpret connected values;
general transformations remain ordinary workflow nodes.

Switching views removes connections to ports that no longer exist. Undo restores
the previous configuration and connections. Display limits keep the latest points
or rows in memory: 300 by default, up to 2,000 per series/view, with at most 16
series and 32 table columns. These are display windows; upstream systems own
retained measurement history.

## JSON response streams

An imported OpenAPI operation can explicitly declare
`"x-operations-response-stream": "ndjson"` or `"sse-json"`. Declare both its wire
media (`application/x-ndjson` or `text/event-stream`) and `application/json`, whose
schema describes a sample. Each complete JSON frame updates directly connected
visualization inputs before the request finishes. One response can feed multiple
series and visualization tabs without duplicate requests.

Line/Area/Bar/Scatter and Table append samples to bounded display windows. Pie and
Sankey replace their current values. Malformed values show a view error; they do
not become saved workflow data. The JSON stream reader retains one frame and
supports cancellation, bounded frames and a 15-second idle timeout. SSE sources
can send comment heartbeats. Existing provider-specific AI stream adapters retain
their terminal-response behavior.

After the first JSON sample, choose **Next operation** to continue with later
forms while the stream keeps updating its views. Starting each later request still
requires confirmation. Other downstream nodes receive the first sample once;
later frames update directly connected visualization inputs only. Finishing the
workflow steps leaves its streams running. The Streams section shows each source's
state and update count, with a separate **Stop stream** control. Quit cancels all
remaining sources. Up to eight streams can be active together. Streams that end
or fail retain their last chart values and display their final state; they do not
restart automatically. No polling or WebSocket connector is included.

Monitoring runs entirely in the browser. Save configuration with the workflow,
while keeping received samples separate from saved documents and editing history.
Credential-backed streams check values inside the vault boundary before publishing
samples; private vault values cannot be displayed. CORS and retained history remain
responsibilities of the upstream API. The vault retains its existing serialized
execution boundary: an active credential-backed stream can delay another request
that also needs the vault.

## Example and implementation

Import [workflow-charts.json](../examples/workflow-charts.json) to try all seven
views using illustrative file data, including two series and selected table columns.
It sends no external requests. Rendering uses modular ECharts and a native HTML
Table view, shared controls, semantic palettes and local fonts. Package notices
are retained. Focused source and browser scenarios cover mapping, persistence,
stream cancellation and chart inspection. Release verification follows the normal
repository CI pipeline.

For a larger comparison, import
[workflow-charts-expanded.json](../examples/workflow-charts-expanded.json). It
includes all seven original views and their original data, plus seven larger views:

- Line and Area: six named series with 1,000 samples each, including a short gap.
- Scatter: six series with 6,000 points in total.
- Bar: six series across 24 regions.
- Pie: 24 named services with solid blended colors.
- Sankey: 23 nodes and 60 links across regions, edges, services and storage. Each
  intermediate node preserves its incoming total when splitting to the next stage.
- Table: 1,000 rows and seven columns, paged in groups of 50.

These are deterministic illustrative data, not measurements from a live service.
Existing browser-saved workflows keep their current data; import the expanded file
to get the additional comparison tabs.

Basis: developer decisions for a single node, seven views, multiple named series,
input ports, optional field selection and Forms/view tabs with live data. Optional
field controls and exact schemas are implementation choices under delegated scope.
Revisit when input contracts, execution concurrency or run interaction changes.
