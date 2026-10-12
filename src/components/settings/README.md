# Settings sections

These views supply focused sections of
[SettingsWorkspace.svelte](../SettingsWorkspace.svelte). That parent coordinates
the single-open-section behavior, appearance and workflow defaults.

## Ownership

| Section | Boundary |
| --- | --- |
| [LocaleSettings.svelte](LocaleSettings.svelte) | Receives preferences and change/retry callbacks; uses the shared locale formatter for its preview |
| [SchemaSettings.svelte](SchemaSettings.svelte) | Receives library records and callbacks for upload, replacement, rename, ordering, enablement, deletion and download |
| [StorageSettings.svelte](StorageSettings.svelte) | Subscribes to the existing metrics recorder and presents resource availability and errors |
| [MetricsHistoryChart.svelte](MetricsHistoryChart.svelte) | Renders supplied series and intervals, with local metric/range selection |

Keep persistence and collection in the existing library services. Closing the
resource section must not stop background collection. Settings remain outside
workflow Git history; uploaded schemas and completed resource aggregates have
their own histories, as described in the
[local resource management ADR](../../../docs/adr/local-resource-management.md).

## Display and feedback

Keep unavailable measurements distinct from zero, and browser storage estimates
distinct from logical repository sizes and record counts. Date displays use the
shared locale helpers without changing stored timestamps or aggregation boundaries.
Preserve busy/disabled states, save errors and explicit retry paths. Reuse
[shared controls](../../lib/components/README.md) for consistent keyboard access
and theme behavior.
