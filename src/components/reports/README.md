# Operation reports

These components explain an operation or a completed matching evaluation inside
[Run workflow](../workflows/WorkflowRun.svelte) and the
[catalog prompt](../CatalogPrompt.svelte). They present data;
they do not submit requests or choose the active operation.

## Data boundaries

| View | Source of truth |
| --- | --- |
| [OperationReport.svelte](OperationReport.svelte) | [`getOperationReport`](../../lib/operation-report.ts), the selected operation and its registered OpenAPI document |
| [EvaluationReport.svelte](EvaluationReport.svelte) | Candidate/result snapshots supplied by the catalog prompt; thresholds from [matching.ts](../../lib/matching.ts) |

Keep schema resolution and matching policy in those library modules. The operation
report includes declared server URLs, inputs, grouping and schema warnings; these
are documentation, not an executed response. The evaluation report distinguishes
proposed candidates from considered candidates and explains omitted rows.

## Presentation

[reports.css](reports.css) supplies shared report layout and is imported by their
host views. Keep report-specific styles local and reuse
[JsonSchemaView](../../lib/components/JsonSchemaView.svelte) for schema inspection.
Preserve table captions, header associations, status/error announcements and
keyboard-accessible score explanations when changing compact layouts. Follow the
[shared theme rules](../../../docs/adr/svelte-interface.md#shared-theme) for report
colors and contrast.
