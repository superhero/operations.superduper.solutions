# Workflow edge routing

This module routes both workflow edge styles around measured node rectangles
using a shared orthogonal backbone, reduces crossings within bounded work,
and keeps attached edges and connection
previews aligned while asynchronous routing catches up. Automatic geometry is
derived editor state. Explicit segment adjustments are saved as authored routes.

The JavaScript geometry is ported from Laya AI's verified `browser/flow-routing`
module at commit `5aca42485e2056f8e3a622157fac6a66fbb250f0`; its latest routing
change is `7cf2158b416d03fd7b6bc25b8fec87210f689c06` (four-unit bends).
The original search, tie-breaking, projection, and work limits are retained with
project copyright headers. Clearance handling has been tightened: a constrained
terminal no longer removes spacing around every node. Adjacent declaration files
expose a strict TypeScript boundary.

## Geometry API

Import functions from their `.js` module. Use `import type` for `types.js` (a
declaration module), or the main type re-exports in `router.js`.

| Module | Responsibility |
| --- | --- |
| `router.js` | `routeEdges(scene, options?)` returns `Map<string, Route>`; `routeConnection(edge, nodes, existingRoutes?, options?)` routes one connection |
| `geometry.js` | `routingScene` reads measured XYFlow internals; `connectionGeometry` resolves outer handle endpoints; `pointerGeometry` follows the raw pointer |
| `path.js` | `routePath`, `routeMidpoint`, `matchesEndpoints`, `cachedPreview`, `projectRoute`, and `previewPath` share path and cache rules |
| `rounding.js` | `roundedSegments` provides straight and circular SVG drawing primitives |
| `dashes.js` | `dashSegments(route, period?, radius?, obstacles?)` aligns each visible dash piece to signed world coordinates |
| `session.js` | Worker-local scene cache; adding or removing a connection retains unchanged routes |
| `handoff.js` | Transfers the latest displayed snap projection to a new edge, including reversed native drags and delayed replies |
| `manual.js` | Validates authored routes, exposes segment midpoints, and clamps segment movement to a continuous clearance-safe interval |
| `clearance.js` | Shares obstacle bounds and terminal exemptions between automatic routing and manual editing |

`NodeRect` is `{ id, x, y, width, height }` in absolute diagram coordinates.
`RoutingEdge` carries an ID, source and optional target node IDs, numeric source
and target coordinates, and their `left`, `right`, `top`, or `bottom` port sides.
`Route` contains points, Manhattan length, and a `routed` or `fallback` status.
Existing routes supply their ID and points. No geometry helper reads the DOM.
The XYFlow adapter imports `@xyflow/system`; the routing and drawing algorithms
are independent of Svelte, XYFlow, and browser globals.

Use `bendRadius` from `path.js` for orthogonal rendering: it is four diagram units.
Curved connections use the same routed backbone with a strength-controlled
radius (0–100 diagram units). Both styles clamp rounding against the same
clearance obstacles, use matching hit areas/previews, and expose segment controls.
The low-level `roundedSegments` default remains eight for reference compatibility;
path and dash helpers default to sharp corners. Pass the rendered dash-plus-gap
period to `dashSegments`, including when user settings change dash size. It is
not limited to the default period of ten.

## Routing policy and limits

First find a short node-avoiding orthogonal route with port directions intact,
preferring fewer bends among equally short routes. Try the requested clearance
first. If a terminal cannot escape that buffer, reduce only the facing clearances
in its narrow corridor, sharing the available gap between the affected faces.
Every unconstrained face keeps its requested spacing. Then reduce crossings within a length cap and
align interior parallel runs when this increases shared length without adding
bends, length, crossings, or losing the existing clearance. Existing routes
remain fixed when routing one connection. Shared stems and joining existing
bends are intentional overlaps.

| Option | Default | Meaning |
| --- | --- | --- |
| `nodePadding` | 12 | Requested clearance in diagram units; the host's minimum-clearance setting |
| `stubLength` | 20 | Preferred straight segment leaving a port |
| `maxLengthRatio` | 4 | Crossing detour cap relative to the node-avoiding baseline |
| `maxGridPoints` | 8192 | Grid vertices per search |
| `maxWork` | 500000 | Shared geometry-check budget per scene or preview |
| `maxRoutedEdges` | 250 | Scene edges eligible for routing searches |

The host exposes **Settings → Workflows → Node clearance**, from 0 to 128 diagram
units with an application default of 16, as `options.nodePadding`. Changes reroute existing
geometry without modifying workflow documents.

The cap permits 300% extra length for crossing reduction; it does not cap node
avoidance. Routing is a deterministic bounded heuristic, not a global optimum.
Searches select nearby obstacle boundaries but check segments against every
obstacle. If both clearance-preserving searches fail, a final bounded search
tries to avoid node bodies with no clearance. Its `fallback` status disables
crossing reduction and alignment, so lost spacing cannot become an optimization
opportunity. This last resort handles crowded layouts where the requested gap
cannot be maintained. If even that search fails or exhausts its work budget,
the visible fallback can cross nodes or edges. Invalid
endpoints can produce an empty fallback, so `routeMidpoint` can be undefined.

Circular bends are clamped to half each adjacent leg and remain sharp where the
arc's bounds overlap a node's requested clearance buffer. Pass the same padded
obstacles to solid paths, labels, hit areas, dashes, and previews; this preserves
clearance by keeping a constrained corner sharp. Crossing reduction and shared
line alignment never reduce the baseline's clearance. `projectRoute` only updates cached
display geometry; its intermediate result can cross an obstacle until checked
worker output arrives. `cachedPreview` also requires the same drag session,
source geometry, and port directions, while allowing snap-target changes.

## Host and worker boundary

Svelte components own context, rendering, measured scene snapshots, and drag
sessions. The worker host owns worker creation, application registration,
teardown, error reporting, and the rendering fallback. Keep expensive routing
searches in the dedicated worker: display projection does not run a search.
See the application's [dedicated-worker contract](../../../docs/adr/dedicated-workers.md).

Allow one calculation in flight and retain only the latest pending snapshot.
Reject obsolete scene replies and late drag-session replies. Reuse unchanged
routes when only connection geometry changes, and transfer a matching snapped
preview to its completed edge on release. Cancel scheduled callbacks, release
worker registration, and terminate the worker when the scope unmounts or the
worker fails. Connection validation and final graph edits belong to the host.

Mount `RoutingScope` inside `SvelteFlowProvider`, surrounding `SvelteFlow`, and
register `RoutedEdge` as the `smoothstep` edge renderer. The host's curved renderer
also delegates to `RoutedEdge`, supplying its radius and temporary curve fallback.
Supply a client with
`calculate`/`dispose`, an error callback, and the host's validated connection
resolver. `RoutedConnection` draws the raw pointer; the host draws the faint
resolved target with the same `previewPath` geometry. Both previews prefer the
shared checked route; a supplied curve function is only a temporary fallback.
The application keeps its configurable curve strength
and stricter live-handle eligibility checks.

Supply `onroutechange(id, points)` to persist completed adjustments; `undefined`
points reset the edge. The host's `editable` flag disables segment controls when
the canvas is unavailable for editing. Selection and pointer previews never
invoke this callback.

`workflow-routing-client.ts` supplies a tracked, inline RPC worker. Leaving the
workspace or replacing the graph terminates it
immediately; there are no writes to drain. A failure preserves its error cause
and leaves ordinary paths usable until the workspace is reopened. Switching
connection styles reuses the worker and its checked geometry.

## Manual adjustments

Hover or select an edge in either style to expose segment handles. Horizontal runs
move vertically; vertical runs move horizontally. Terminal and straight edges
gain endpoint stubs when needed. Pointer motion stops at the configured node
clearance, including obstacles crossed by adjoining segments. A fast pointer
cannot jump through a blocked interval. An already constrained terminal uses
the same narrower corridor as automatic routing; body-only fallback routes
remain uneditable until clearance is available.

Arrow keys move a focused handle by one diagram unit, or ten with Shift.
Release the pointer or arrow key to save one edit; Escape, lost capture or
window blur cancels. Handles retain their screen size at every zoom. Reset
connection route returns an adjusted edge to automatic routing.

Only explicit edits persist `manualRoute`: 2–128 orthogonal points including
the captured endpoint anchors. Documents retain no rendered arcs, length,
clearance state or worker cache. Undo, redo, import and export preserve authored
routes. Moving nodes projects those anchors onto the current ports without
rewriting the saved intent. If a route becomes blocked, automatic routing
temporarily takes over; the authored route returns when feasible. Curved mode
draws and edits the same authored route with its configured bend radius.

The scope keeps pointer updates transient and retains a completed draft until
its matching worker reply arrives. Geometry or clearance changes cancel an
active gesture. Route validation and interval preparation have bounded work;
pointer updates copy at most 128 points and perform no routing search.

## Dash settings and motion

The application exposes dash length and gap (1–128px), and travel speed
(0–512px/s). Application defaults are 8px, 16px and 64px/s. Pass the same `length + gap`
period to the scope and `--flow-routing-dash-period`; set
`--flow-routing-dash-duration` to `(length + gap) / speed` seconds. At zero speed,
use a finite duration and set `--flow-routing-dash-play-state` to `paused`.
Changing dash dimensions preserves the selected travel speed. The inherited CSS
clock synchronizes late-added edges without a JavaScript animation loop.
Reduced motion stops it.

Same-direction shared straight segments align regardless of preceding path
length. Reverse-direction connections travel oppositely. Rounded corners inherit
their incoming phase; each following straight segment anchors to its world
coordinate, so this does not represent a particle travelling continuously through
every corner. Curved and fallback edges use the ordinary dash animation.

## Verification

Run the routing scenarios beside [source](../../README.md) through
`npm run test:source`; their reference scenarios cover routing policy, measured
geometry, worker caching, projection, rounded corners, and dash alignment. Every
reference case is an individual Cucumber scenario. Browser cases tagged
`@workflow-routing` exercise actual handles, dragging, worker teardown, motion,
settings, and persistence; run them after `npm run build` with
`npm run test:browser -- --tags @workflow-routing`.
Manual controls and persistence are covered by `@workflow-manual-routing`.
