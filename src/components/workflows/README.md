# Workflow editor views

This directory contains Svelte Flow node/edge renderers, canvas interaction helpers,
toolbar/history views and the run interface.
[WorkflowWorkspace.svelte](../WorkflowWorkspace.svelte) registers the renderers,
coordinates edits and supplies their Svelte contexts. The operation renderer
currently lives at [WorkflowNode.svelte](../../WorkflowNode.svelte).

## Follow the existing boundary

| Change | Start here |
| --- | --- |
| Node fields and utility interactions | `WorkflowDataNode`, `WorkflowSwitchNode`, `WorkflowCastNode`, `WorkflowCommentNode`, `WorkflowReferenceNode` |
| Shared operation and workflow-reference card layout | `workflow-owner-nodes.css` |
| Connection rendering and target previews | `WorkflowCurveEdge`, `WorkflowConnectionLine`, `WorkflowConnectionSnap` |
| Selection and navigation aids | `WorkflowSelection`, `WorkflowMinimap`, `WorkflowToolbar` |
| Versions and execution | `WorkflowHistory`, `WorkflowRun` |

Context callbacks send node edits through the workspace. Keep document validation,
graph transformations, persistence and request execution in their existing
[`$lib` modules](../../lib/README.md). Preserve saved node/handle identities and
the distinction between ownership attachments and user mappings.

Orthogonal edges use the portable [`flow-routing`](../../lib/flow-routing/README.md)
module. This directory retains the application-specific curve controls and
connection eligibility checks; route geometry stays outside persisted documents.

## Interaction constraints

Node controls use `nodrag`, `nopan`, `nokey` and, where needed, `nowheel` to keep
editing separate from canvas gestures. Preserve modal shortcut isolation,
connection eligibility, transient selection and completed-edit autosave. Comment
previews use the local Markdown parser with escaped text and restricted links.

Each input accepts one active value connection and unlocks when it is disconnected.
Outputs can feed multiple inputs; schema attachments do not occupy value inputs.
Keep handle availability and connection validation aligned through
`workflowInputConnected`. Previously saved connections remain readable.

New connections require matching declared types, with Integer also accepted by
Number inputs. Cast nodes provide scalar conversions; Switch outputs retain their
incoming type. Object and Array connections still require runtime schema validation.

Native Tab order follows each operation's input columns inward, then the operation,
then its output columns outward; Shift+Tab reverses it. `workflow-focus-order.ts`
orders rendered nodes by schema branches while retaining their saved order and
positions. Keep each node's controls together and hidden nodes out of navigation.

The Workflows setting **Node symbols** controls decorative header/footer icons
across all node types. Action icons remain visible; this preference is stored with
browser settings and applies immediately to existing workflows.

Use shared semantic colors and reduced-motion behavior. The
[workflow canvas contract](../../../docs/adr/svelte-interface.md#workflow-canvas)
records selection, placement, history and execution expectations.

## Running operations

`WorkflowRun` is the execution view for every operation. It composes shared
`OperationFields`, operation reports and credential controls, while
`workflow-runner` owns mapped inputs, branching and request execution. Selecting
an operation in navigation adds a node; it never sends a request.

Keep connected inputs read-only. Cancelling a pending request retains the step
for retry; quitting ends the run. Completed steps remain read-only and their
actual responses and prepared requests remain available in run history.

## Vault variables

The toolbar's **Variable Add** icon creates a connectable vault-variable node.
Select a saved vault entry, then connect its Text output to an operation's Text
input. Switch and Cast nodes do not consume vault values.

Nodes retain only the local entry ID. The vault worker resolves values when a
request runs, and validates them against the operation schema. Exporting or
importing workflows clears these selections, including nested workflows.

## Utility placement

Vault variables, comments, switches and casts use their rendered bounds to find
free space nearest the visible workspace center. Placement first searches inside
the viewport, then outside it when needed, and preserves existing node positions.
Grid snapping applies when enabled. Adding a utility pans to center it in the
usable area beside open panes and below the toolbar. Operation trees retain
their ordered placement after existing content.
