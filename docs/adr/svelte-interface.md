# Svelte interface

> [!IMPORTANT]
> The interface is built around Svelte, with shared theme and interaction rules.

## Interface foundation

Svelte supplies the application UI, shadcn-svelte supplies common components,
and Svelte Flow (`@xyflow/svelte`) supplies graph interaction. Adapt owned
component source before building equivalent primitives. The archived `laya-ai`
0.13.11 editor is the reference for workflow behavior.

The product term is **workflow**, consistently across UI, code, filenames and
tests. Third-party identifiers and existing storage keys retain their compatibility.

## Shared theme

### Palettes and modes

Each palette defines exactly six hex values, `--palette-1` through `--palette-6`,
in `src/palette.css`. Values normally run from lightest to darkest; Neon and
Citrus retain their intentional accent placements rather than being sorted.

Palette identity and light/dark mode are independent. `src/app.css` maps them to
`--tone-1` through `--tone-6`: light mode preserves the order; dark mode reverses
it exactly and sets `color-scheme`.

Components consume shared semantic roles, never raw slots or palette/mode
conditions. Each role aliases a slot or another role; dark mode does not override
individual roles. New palettes change only the six values at the document root.
The animated background follows both palette and mode changes.

### Semantic roles

| Element | Fill slot | Text slot |
| --- | --- | --- |
| Page / panels | 1 / 2 | 6; secondary text 5 |
| Inputs | 6 | 1 |
| Field labels | 5 | 2 |
| Primary actions, including available progress steps | 4 | 3 |
| Label badges | 3 | 6 |
| Current/completed steps, opened catalog items, selected switches | 6 | 1 |
| Disabled controls | 5 | 2 |

Idle catalog items retain their secondary text color on hover. Ordinary frames
use slot 1, catalog tree connectors use the label role at slot 3, and dashed
operation separators use the page background. Library borders must not inherit
`currentColor`; focus, validation, selection and graph connections retain
separate semantic roles.

Progress buttons meet without gaps, with pane-colored chevron boundaries
separate from focus outlines. Disabled controls remain fully opaque, use native
disabled semantics, and neither activate nor scale on hover.

### Contrast and effects

Base surfaces, text, borders and hover states use exact palette colors; blending
does not create extra shades. Transparency is reserved for effects such as
shadows, focus halos, backdrops, scroll fades, canvas decoration and transitions.
Page backgrounds remain solid beneath animated lines.

Normal text and placeholders require at least 4.5:1 contrast, including hover
states. Required, selected and error states also use text, icons or structure.
Validate every palette in both modes, correcting palette values or shared roles
rather than adding mode-specific exceptions. Checks cover reversal, replacement
palettes, role bindings and contrast without duplicating shipped hex values.

## Settings and startup

### Storage and recovery

Only one Settings section opens at a time. Settings live outside workflow Git
history in IndexedDB `v1/settings`. Palette and mode are separate values;
renaming a palette preserves its identifier.

Read settings before mounting, using bounded readonly transactions without
forcing an upgrade. Retain access through the legacy `preferences` store when
present; queue preference migration and normalization separately from startup.
Namespace migration copies saved data before retiring its source. Legacy
localStorage choices migrate only into missing settings and are removed only
after a successful transaction.

Bound opens and writes, close late connections, and abort timed-out transactions
to prevent delayed writes. Unavailable storage releases startup with valid legacy
choices or temporary defaults, without persisting fallback values. Failed writes
retain session choices. Shared diagnostics explain failures and Settings offers
retry; recovered values must not overwrite edits made during retry.

### Appearance cache

The localStorage entry `v1/settings/appearance-cache` holds the last successfully
read or saved palette and mode. A synchronous head script and shared stylesheet
apply them before first paint, including the loading screen.

IndexedDB remains authoritative. Successful reads replace cached choices,
including defaults for missing settings; failed reads retain valid cached
appearance. Refresh the cache only after successful transactions, never import
it into IndexedDB, and tolerate missing, malformed or unavailable localStorage.

Theme choices preview all six colors. Surrounding controls use semantic roles;
a name highlight and star identify selection without relying on color alone.
Selection animation respects reduced motion.

### Workflow defaults

`workflowDefaults` stores connection styling, grid snapping and node-symbol
preferences. Missing or invalid values fall back independently: dashed lines,
curved lines, snapping and node symbols start enabled.
Load defaults before the editor mounts and apply them to
new workflows and the untouched initial canvas. Existing, edited and imported
workflows retain their flags; toolbar changes do not alter application defaults.

Grid size accepts whole pixels from 1–32, defaulting to 8. It applies immediately
to placement and center snapping on every canvas without repositioning nodes or
changing workflow documents. Decorative dots retain independent 24px spacing.
Dash length and gap accept 1–128 px, defaulting to 8 and 16 respectively.
Dash speed accepts 0–512 px/s, defaulting to 64; zero pauses motion.
Curve strength accepts 0–200%, defaulting to 100%. Node clearance accepts
0–128 diagram units, defaulting to 16, and applies to orthogonal routing and
manual segment adjustments.

### Locale

Date format, 12/24-hour time and timezone share the `locale` setting. Browser
defaults apply to absent or invalid fields individually. Explicit numeric patterns
use Gregorian dates and Latin digits; automatic and long formats follow the
browser locale. Language selection remains outside the current scope.

Apply preferences before mounting and update visible dates and chart tooltips
reactively. Calendar-only dates retain their day; timezones affect timestamp
display without changing stored instants or UTC aggregation boundaries.

### Resource monitoring

Browser settings expose resource measurements and history. Collection continues
while the section is closed; approximate storage usage, record counts and logical
file sizes remain distinct.

## Shared interactions

### Motion and layout

Hover enlargement adds at most 12px of width, subject to each control's scale
limit. A shared handler measures layout width on pointer entry or keyboard focus,
including portal content. Controls scale once with their text and icons;
native chevron rotation and switch-thumb movement stay independent.

Layout decisions use untransformed dimensions so hover cannot create a
resize/overflow feedback loop. Operation views ease discrete height changes but
follow animated disclosures directly, without restarting an outer transition
every frame. Apply the final height before restoring easing; reversals and
navigation discard stale animation completions.

On fine-pointer devices with hover support, enabled controls that scale retain
a composited layer through entry and exit to prevent text-rendering flashes.
Scope this to small controls and headings: enlarged text may soften and layers
consume memory. Touch-only and reduced-motion layouts do not request these layers.

Progress buttons stay above idle neighbors through hover-out; a newly hovered
or focused neighbor takes priority. Disabled controls and reduced-motion layouts
reset stacking immediately.

### Integer inputs

Integer fields share a logarithmic slider with editable exact-value entry.
Missing bounds extend to JavaScript's safe-integer limits, including negatives
when no minimum is declared. An explicit maximum selects a symmetric curve:
values change fastest near the midpoint and more slowly near the limits.

Round bounds inward, preserve optional blanks and restrict enums to permitted
integers. Arrow keys change the value by one; Home/End select limits. Exact entry
covers the full permitted range. Decimal fields retain numeric controls; the
grid slider saves only completed changes.

## Workflow canvas

### Graph structure

Operations own schema-derived input panels on the left and documented responses
on the right, including error, wildcard and default responses. Names and instance
numbers remain on one line; attachment labels distinguish input locations,
response codes and media types without changing saved handle IDs.

Ownership attachments are distinct from user mappings between output and input
fields. Schemas supply structure, never inferred response examples. Unsupported
or unavailable shapes remain explicit. Connection snapping considers only
visible, eligible inputs and previews the nearest target.

Hiding a branch preserves its structure for restoration but removes affected
mappings. Deleting an operation removes its owned panels and connections.
Existing document formats remain readable and editable; newer features do not
rewrite older documents until used. Selection, measurements and drag previews
remain transient.

### Connection paths

Orthogonal connections route around measured nodes in a dedicated worker, with
bounded crossing reduction and four-unit rounded corners. Shared runs are
intentional; adding a connection preserves the existing routes. Cached geometry
keeps endpoints attached while routing catches up, with ordinary paths available
if routing fails or exceeds its limits.

During connection dragging, retain the raw pointer line and a faint preview of
the eligible target. Reuse that preview on release. Dash spacing follows Settings;
shared straight runs synchronize in world coordinates at a constant speed, with
motion stopped for reduced-motion preferences. Curved connections retain their
adjustable strength. Generated paths, caches and worker state never enter saved
documents.

Orthogonal segments can be adjusted perpendicular to their direction, stopping
at node clearance. A completed gesture saves one authored route for undo and
redo; previews remain transient. Authored routes preserve attached endpoints
when nodes move. If blocked, automatic routing takes over temporarily without
discarding that intent. Reset restores automatic routing explicitly.

### Placement and selection

All added nodes align their measured centers to the grid, regardless of the snap
toggle. Finish placement before autosave so each addition records one version at
its final coordinates. Existing and loaded positions remain unchanged.

Snapping controls later movement by node center; documents retain top-left
coordinates. With snapping enabled, arrow keys move one cell, or four with Shift.
Nodes retain their size on hover, and position transforms update directly so
shared transitions cannot delay nodes behind their connections.

- Shift-click toggles a node without changing others; deselection also clears
  its selected incident connections. Node toggles precede rectangle capture.
- Shift-drag adds nodes and connections to the selection at gesture start.
  Shrinking the rectangle removes only new hits outside its bounds.
- Double-click replaces selection with an operation or nested workflow and its
  visible schema descendants on both sides. Data nodes select themselves and
  visible descendants upstream for inputs or downstream for outputs, never
  crossing user mappings into the opposite direction.
- Empty-space clicks and Escape clear selection and its group overlay.

Selection never creates a saved version. Editing inside nodes must not trigger
canvas shortcuts.

### Edits and history

Autosave records completed edits, with visible saving status and retry. Await
pending saves before changing workflows or workspace; page hiding starts a flush,
while pending asynchronous writes require an unload warning. Refuse to overwrite
workflows changed or deleted in another tab. Storage failures and conflicts
preserve drafts for retry, export or explicit replacement.
Untouched drafts stay out of the library; deleting the current saved workflow
cancels pending saves until another edit.

Undo, Redo and history cards navigate existing commits. Editing from the past
preserves the old future. History shows actual parent relationships, meaningful
change messages and the current version. Selecting a title-and-date card updates
the marker without closing the dialog or discarding later history.

### Utility and nested nodes

Switch uses the first matching gate, with connected operands replacing manual
values. Removing a gate removes its mappings; the last gate cannot be removed.
Cast converts primitives to Text, Number or Boolean. Comment Markdown escapes
text and permits safe links, never raw HTML.

Nested workflows embed validated snapshots, remaining portable and independent
of deleted originals. Interfaces expose unsupplied inputs and documented outputs;
endpoint identities match the embedded graph. Document size, aggregate graph
size and nesting depth are bounded.

### Additional properties

Object panels offer property editing when schemas permit additions, including
an omitted `additionalProperties`. Declared properties remain fixed. Unrestricted
additions allow concrete type selection; constrained additions use their
schema-defined type. Closed objects, synthetic parameter collections and fixed
nested-workflow interfaces do not allow additions.

Renaming preserves mappings and nested branches. Type changes remove incompatible
connections and obsolete children; removal clears descendants and incident
mappings. Escaped field pointers preserve names, duplicates are rejected, and
edits participate in autosave, Undo and exports. Existing workflows recover
permissions from their operation schema without a format migration.

## Request execution

### Shared validation

Standalone operations and workflow runs share typed controls, the catalog
registry and an injectable HTTP executor. Object and array drafts use JSON text.
Validate complete inputs against canonical schemas, including nested fields,
additional properties, array items, required values and supported bounds.
Unsupported input shapes, encodings and constraints produce explicit errors.

Assemble nested and array mappings before validation, retaining field types.
Conflicting mappings fail; Cast handles primitive conversions only. Routing and
nested nodes propagate outputs, and cycles fail instead of repeating API calls
indefinitely.

### Live requests

Workflow plans remain browser-local. Execution is explicit and never changes the
editor document. Workflow controls choose a starting operation, submit steps,
advance or end the run. Show the destination before submission; reports retain
declared server URLs, honoring
path/operation overrides, separately from the HTTP method. Destinations come from
the registry, never visible labels. Existing `demo:*` and legacy `mock*` identities
remain compatible.

Bundled examples send real requests; schema examples never substitute for server
responses. Test fixtures are injected outside production execution. Show progress
and actual status/body, retaining prepared inputs and error response bodies for
inspection and explicit retry. Browser-forbidden methods fail explicitly.

Prevent duplicate submissions, support cancellation, and cancel pending requests
on operation changes, response/workspace exit or run closure. Ignore stale
completions. Neither execution path fabricates responses or stores a local
substitute for server state.
