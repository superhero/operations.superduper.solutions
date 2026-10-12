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
| Connection rendering and target previews | `WorkflowCurveEdge`, `WorkflowConnectionLine`, `WorkflowConnectionSnap` |
| Selection and navigation aids | `WorkflowSelection`, `WorkflowMinimap`, `WorkflowToolbar` |
| Versions and execution | `WorkflowHistory`, `WorkflowRun` |

Context callbacks send node edits through the workspace. Keep document validation,
graph transformations, persistence and request execution in their existing
[`$lib` modules](../../lib/README.md). Preserve saved node/handle identities and
the distinction between ownership attachments and user mappings.

## Interaction constraints

Node controls use `nodrag`, `nopan`, `nokey` and, where needed, `nowheel` to keep
editing separate from canvas gestures. Preserve modal shortcut isolation,
connection eligibility, transient selection and completed-edit autosave. Comment
previews use the local Markdown parser with escaped text and restricted links.

Use shared semantic colors and reduced-motion behavior. The
[workflow canvas contract](../../../docs/adr/svelte-interface.md#workflow-canvas)
records selection, placement, history and execution expectations.
