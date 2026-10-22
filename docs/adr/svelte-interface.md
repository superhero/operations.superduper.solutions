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
| Primary actions | 4 | 3 |
| Label badges | 3 | 6 |
| Opened catalog items, selected switches | 6 | 1 |
| Disabled controls | 5 | 2 |

Idle catalog items retain their secondary text color on hover. Ordinary frames
use slot 1, catalog tree connectors use the label role at slot 3, and dashed
operation separators use the page background. Library borders must not inherit
`currentColor`; focus, validation, selection and graph connections retain
separate semantic roles.

Disabled controls remain fully opaque, use native disabled semantics, and
neither activate nor scale on hover.

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

## Operation discovery

The prompt sits below the navigation buttons and filters operation leaves as the
user types. Empty categories are hidden, with matching paths expanded.
Clearing the prompt restores ordinary browsing and its saved expansion state.
The evaluation report is opt-in through **Settings → Developer → Evaluation
details**, off by default. This preference does not affect operation matching.

Evaluation runs in a dedicated worker after a short typing delay. Further edits
abort the previous calculation; only results for the current prompt and catalog
may be displayed. Matching never moves focus or changes the workflow. Selecting
a match adds an operation to the canvas; execution happens in Run workflow.

Window resizing preserves workflow zoom and node dimensions. If the smaller
canvas hides every operation node, it pans to a nearby node at the current zoom;
it does not automatically fit the whole graph. Explicit Zoom and Fit controls
remain available. Viewport width alone does not select smaller node defaults.
Fit View centers the graph in the uncovered canvas between the open panes,
using their current widths and leaving room below the workflow toolbar.

## Settings and startup

Settings has a draggable left-edge splitter, with arrow-key resizing (Shift for
larger steps), Home/End limits and a double-click reset. Its preferred width is
saved separately from workflow documents, defaults to 900px and ranges from
360px to 1440px, limited while dragging to leave 250px of the viewport visible.

The catalog has the same splitter on its right edge and saves its own preferred
width, with its original 320px width as the minimum and a 1440px maximum. On
smaller desktop viewports it temporarily clamps to leave 250px of canvas and
restores the preference when space returns. Its existing mobile sheet stays
320px wide (bounded by 90vw), without a resize grip.

Both panes can stay open when the viewport fits their chosen widths and 500px
of canvas. Below that, opening one closes the other;
shrinking keeps the most recently opened pane. Settings fills the viewport when
its preferred width would leave less than 250px of canvas, or below 900px viewport
width. Growing the window restores the chosen pane width. Selecting a catalog
item keeps Settings open when both panes fit. Escape closes the focused catalog
when both are open; otherwise it follows the existing Settings-first dismissal.

Touch capability is independent of viewport size: docked panes remain resizable
on tablets and other touchscreens. Coarse-pointer devices get a visible 44px-wide
grip with a bounded vertical touch area, leaving content editing and scrolling
untouched. Tap a splitter (or press Enter/Space) for Narrow, Medium, Wide, Reset
and Close controls; desktop arrow keys and the delayed hover highlight remain.

Compact panes replace the X with a visible, accessible dismissal grip. Navigation
swipes left and Settings swipes right, following the finger while moving. Short,
wrong-direction, vertical and cancelled gestures do not dismiss. Only the grip
handles swipes; its header sits outside the scroll area so it cannot cover the
search field or catalog rows. Normal content remains scrollable. Tap or keyboard
activation of the same grip also closes the pane. Navigation restores its scroll
position when reopened. Width-based layout does not react to a keyboard-only
height change.

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
workflows restore their own flags; toolbar changes do not alter application defaults.

Grid size accepts whole pixels from 1–32, defaulting to 8. It applies immediately
to placement and center snapping on every canvas without repositioning nodes or
changing workflow documents. Decorative dots retain independent 24px spacing.
Dash length and gap accept 1–128 px, defaulting to 8 and 16 respectively.
Dash speed accepts 0–512 px/s, defaulting to 64; zero pauses motion.
Curve strength accepts 0–1000%, defaulting to 100%, and controls Bézier handles.
Its slider uses a logarithmic scale with a zero-inclusive offset, giving finer
pointer adjustments at low strengths; exact entry and keyboard steps retain
whole percentages.
Clear connections retain their original diagonal cubic shape. Blocked paths
use smooth cubic detours fitted to the checked route, with conservative curve
bounds keeping them outside nodes. Node clearance accepts 0–128 diagram units,
defaulting to 16, and applies to both connection styles and manual adjustments.
Both styles share the same worker-routed corridors, editable segment anchors
and saved manual routes. Style changes redraw existing geometry without
replacing the routing worker or rewriting authored anchors.
Explicit changes to Curved lines, Dashed lines and Snap to grid in Settings
also update the open workflow and its saved display preferences, using the same
updates as the toolbar. Changing snapping does not reposition existing nodes.
Unrelated defaults leave these flags alone; startup and imports restore their
own flags. Updating an untouched canvas does not create a saved workflow.

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
resize/overflow feedback loop. Disclosures animate their own size; parent views
do not restart that animation every frame. Navigation discards stale animation
completions.

On fine-pointer devices with hover support, enabled controls that scale retain
a composited layer through entry and exit to prevent text-rendering flashes.
Scope this to small controls and headings: enlarged text may soften and layers
consume memory. Touch-only and reduced-motion layouts do not request these layers.

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
Cast converts primitives to Text, Number or Boolean. Comments store Markdown
source unchanged. Editing uses CodeMirror's Markdown language support: source
markers remain visible while headings, emphasis and inline code are styled.
The editor exists only during editing and releases its view/listeners on exit;
contenteditable focus participates in the existing grouped autosave history.

Viewing uses the shared `src/lib/markdown.ts` markdown-it configuration, replacing
the custom comment parser. CommonMark/GFM blocks and tables are supplemented by
the mdit tasklist, footnote, mark, ins, sub and sup plugins. Markdown images use
the mdit img-size and img-lazyload plugins, and fit inside the comment width.
Raw HTML stays escaped and links permit only HTTP(S) and mailto. Plugin-generated
task and footnote identifiers are scoped to each rendered comment. Plugin extensions must preserve these
[markdown-it safety rules](https://github.com/markdown-it/markdown-it/blob/master/docs/safety.md).

Transform, Filter and Assert are separate node types. Their validated, versioned
operation definitions provide the selector choices, configuration fields and port
types. A configured card names its action, such as Encode Base64 or Substring.
Transform and Filter input badges and port labels show the types accepted by the selected
operation before and after wiring, such as `Text | Binary` or `Object | Array`. JSON
serialization displays JSON. Connected-type inference still determines the
types propagated through the graph.
Configurations participate in workflow history, Undo, clipboard and portable
documents; existing document versions retain their prior behavior.

Workflow node selects reuse the scrolling option list from form/settings selects.
The popup caps its height to available viewport space and its inner viewport owns
native scrolling, with a visible scrollbar. Wheel input stays inside the list;
keyboard navigation, disabled options, node tooltips and compact styling retain
their existing behavior.
Selector tooltips describe the control's purpose rather than repeating its value
(for example, Transformation or Assertion condition). Operation names show their
full catalog category path in the shared tooltip. Other node headers have no
tooltips. Category labels use title case and replace underscores with spaces in
navigation, tooltip paths and reports, preserving acronyms and source identifiers.
Node headers never use native title popups. Utility connector tooltips identify their
purpose and types; Assert additionally explains that Success and Failure each
pass the original input through unchanged. Connected inputs remain hoverable
without allowing an additional incoming connection.
Hovering a partly clipped option leaves the list and active highlight in place;
the visible portion remains clickable. Wheel/touch scrolling and keyboard
navigation still reveal options normally. Hover geometry is cached until the
row changes or the viewport scrolls/resizes, and released when the popup closes.

Transform supports UTF-8, Base64/Base64url and hexadecimal encoding/decoding,
JSON parsing/serialization, field mapping, SHA-256,
HMAC-SHA256 and JWT signing. JSON parsing has no result-type selector: its known
output alternatives are `Object | Text | Number | Boolean | Array | Null`, shown
as `JsonValue` in type badges and port labels. Integer is included in Number.
A matching receiving port may assume one of these
types; the executor validates the actual value without inserting a cast. The
union stays available through Assert and Switch. Earlier saved Parse JSON nodes
discard their obsolete result-type setting when loaded. Field selection still
declares its output type. Map fields uses editable source → new-name rows,
with Add/Remove and atomic Save/Cancel. Sources are the entire input or literal
field/item names entered one level at a time, with zero-based array positions.
Only listed fields appear in the result. The editor escapes JSON pointers
internally and preserves the existing saved mapping format and executor;
duplicate names and existing size limits are validated before saving.
Binary values retain exact bytes; connecting an original file
to a binary-only processing input inserts the visible Binary Cast.

Signing-key ports show their accepted `Text | Binary` types. JWT Key ID also
has a Text input port: a connection disables manual editing and supplies the
header's `kid` during execution. Disconnecting restores the saved manual value;
connected empty text omits `kid`. Connected parameters retain their own types
and bounds and remain opaque when supplied by vault values. Unmatched Assert
outputs and inactive Switch branches follow the same routing rules as other
processing inputs, without falling back to disabled manual values.

Filter trims either or both ends of text, selects a substring or a field by JSON
pointer, selects an array range or keeps array items matching a predicate. Older
Select field Transform nodes load as Filter nodes with the same identity,
configuration and connections; older private recipes remain executable. Select
field returns JsonValue without a result-type selector. Older selected result
types are removed on load without coercing or narrowing the actual result;
downstream ports check the value under their receiving type assumption.
Text indices count Unicode
code points; ranges include their start and exclude their end, with negative
indices counting from the end. Array filtering retains input order. Predicates
use explicit field paths and comparisons; equality preserves value types.
Substring and Array range bounds accept Integer connections. Select field paths
accept Text connections. Connected parameters show type badges, disable manual
editing and retain their saved values for disconnection or Undo.

Filter array delegates its predicate to a separate Assert. Its main input and
result are Array; Assertion emits an Unknown value for each element. A bounded
path of Cast, Transform or other Filter operations ends at one Assert. Connect
its Success outcome to Keep and Failure to Remove. Keep retains the original
array item and Remove discards it. Swapping the returns inverts the selection.
Casting affects the assertion without changing retained items or their order.
Unknown item/return badges resolve on the assertion side when a Cast supplies a
known type. No duplicate condition editor appears in Filter array.

An unconnected Assertion offers the same add-location button as hidden schema
branches. It creates an Assert with Is set selected and wires all three
connections in one undoable edit, without moving existing nodes. The button
returns when the assertion path is deleted. Older saved inline predicates and
private recipes remain executable until an assertion path replaces them;
connected legacy operands remain visible until then. Wiring the callback clears
the old predicate and its operand connections as one undoable change.

The runner compiles each item path once and evaluates the array in one worker
request, producing one bounded result preview rather than per-item graph state
or rendering. Paths are limited to 32 processing steps and 100,000 item/step
evaluations. Both outcomes return to the same filter; branching outside the
item path, nested filter callbacks and ordinary routing cycles are rejected.
External predicate operands are captured once, preserving their value types.
Private arrays or operands execute entirely inside vault processing; no item
values or predicate intermediates are returned to the page. Ending the run
cancels its public worker and discards pending results.

Assert passes the original input unchanged through Success or Failure. The
field-path editor appears only for connected Object, Array or JsonValue inputs.
Disconnected, scalar and unresolved inputs hide it while retaining its saved
path; scalar inputs are checked directly. The expected-value editor appears only
for conditions that use it; Is set and Is not set hide it while preserving the
saved value for reuse.
Expected value also accepts one connection, which disables its manual editor.
Its badge and connection compatibility follow the condition and checked type:
numeric comparisons require Number, text comparisons and type checks require
Text, and equality uses the known checked type. Unresolved nested values use
Any, while a known JSON union uses JsonValue. Connected values retain their
original types; private operands are compared inside the vault. Changing the
condition or path removes incompatible operand connections through Undo history.
The unmatched output leaves its connected input unsupplied and editable in the next
operation, including through another utility node. Assertion failure is ordinary
data flow, including when Failure has no connection; it does not raise an
assertion error or automatically skip the next operation. Switch retains its
existing branch-routing behavior.

Stop has one value input and no output or configuration. Any supplied value,
including false, zero, null, empty data or an opaque vault reference, ends the
whole run normally with “Workflow stopped.” This also applies inside nested
workflows. Unmatched Assert outputs and inactive Switch outputs do not activate
Stop. For example, connect Assert Failure to Stop when a failed expectation
should end execution. Delivery ends the run before another operation is prepared,
clears pending steps and releases processing resources without decrypting input.

Processing runs on demand through asynchronous runner advancement. One public
worker is created lazily per run and terminated on completion, cancellation or
closure. Substantial encoding, parsing, filtering and cryptography stay outside
rendering. Operation-free processing chains are supported. Result previews are
bounded and rendered only when their section opens.

Vault-backed inputs propagate opaque processing recipes. The vault worker
validates and evaluates them during request injection; original and derived
secrets remain absent from public previews and are scrubbed from responses.
Private assertions return only a predicate decision, then preserve the original
opaque reference on their selected output. Session checks apply after evaluation.
No general decryption method is exposed. Portable documents clear vault selections.

JWT signing selects HS256 or RS256 explicitly, with an optional key ID. HS256
requires at least 32 key bytes; RS256 imports PKCS8 PEM/DER keys of at least 2048
bits, following [JWA](https://www.rfc-editor.org/rfc/rfc7518.html#section-3).
Caller-supplied claim objects determine the signed payload. Provider connection
profiles continue to own issuer/audience rules, expiry, acquisition and destination
binding; see [JWT practices](https://www.rfc-editor.org/rfc/rfc8725.html).

The processing worker/client adapters use the same browser-verification boundary
as file worker adapters. Source coverage includes the pure operation and private
recipe logic; browser scenarios exercise real worker creation, disposal and vault
RPC. Development verification remains focused on these contracts.

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

Run workflow uses schema-derived controls, the catalog registry and an injectable
HTTP executor. Fields are grouped by request location, with optional field help,
operation details and inline validation. Connected inputs stay read-only. Object
and array drafts use JSON text.
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

Prevent duplicate submissions. Cancelling a request preserves its step and draft
for explicit retry; quitting the run aborts pending requests and ends execution.
Ignore stale completions, including late responses to cancelled requests. No
execution path fabricates responses or stores a local substitute for server state.
