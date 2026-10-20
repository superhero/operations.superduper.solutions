# Settings sections

These views supply focused sections of
[SettingsWorkspace.svelte](../SettingsWorkspace.svelte). That parent coordinates
the single-open-section behavior, appearance and workflow defaults.

## Ownership

| Section | Boundary |
| --- | --- |
| [KeybindingsSettings.svelte](KeybindingsSettings.svelte) | Configures workflow shortcuts and selection modifiers through app settings; text editing keeps native shortcuts |
| [ToolbarSettings.svelte](ToolbarSettings.svelte) | Controls individual toolbar-button visibility through app settings; keyboard shortcuts remain available |
| [LocaleSettings.svelte](LocaleSettings.svelte) | Receives preferences and change/retry callbacks; uses the shared locale formatter for its preview |
| [SchemaSettings.svelte](SchemaSettings.svelte) | Displays alphabetically ordered library records and callbacks for upload, replacement, rename, enablement, deletion and download |
| [SchemaHistory.svelte](SchemaHistory.svelte) | Loads schema branch ancestry and changed fields on demand; reviews conflicting updates and applies bundled revisions through library callbacks |
| [SecretsSettings.svelte](SecretsSettings.svelte) | Manages encrypted credentials, destination approvals, unlock methods, backups and locking through the dedicated vault worker |
| [StorageSettings.svelte](StorageSettings.svelte) | Presents browser resource metrics, availability and collection errors |
| [MetricsHistoryChart.svelte](MetricsHistoryChart.svelte) | Renders supplied series and intervals, with local metric/range selection |
| [ErrorHistory.svelte](ErrorHistory.svelte) | Supplies the Logs section with retained errors, cause chains, stacks, pagination and recorder recovery independently of resource sampling |

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

Secrets management clears temporary input on cancellation and teardown. Its lock
action must remain available during pending work. Unlike resource recording,
accepted secret operations are cancelled immediately when their UI closes.
