# Application views

This directory composes the application's workspaces and shared shell. Start at
[App.svelte](../App.svelte) for coordination between navigation, settings and the
active workspace; use [$lib/components](../lib/components/README.md) for controls
reused across those views.

## Where changes belong

| Concern | Entry point |
| --- | --- |
| Live prompt matching and catalog filtering | [SideNavigation.svelte](SideNavigation.svelte), [CatalogPrompt.svelte](CatalogPrompt.svelte) |
| Operation input and execution | [workflows/WorkflowRun.svelte](workflows/WorkflowRun.svelte), [OperationFields.svelte](../lib/components/OperationFields.svelte) |
| Canvas editing, autosave and history coordination | [WorkflowWorkspace.svelte](WorkflowWorkspace.svelte), then [workflows](workflows/README.md) |
| Appearance, defaults and browser resources | [SettingsWorkspace.svelte](SettingsWorkspace.svelte), then [settings](settings/README.md) |
| Catalog navigation and workspace switching | [SideNavigation.svelte](SideNavigation.svelte) |
| Read-only operation and matching details | [reports](reports/README.md) |

Workspaces own view state and coordinate library services. Schema interpretation,
request preparation and persistence rules belong with their existing modules in
[lib](../lib/README.md), so multiple views use the same behavior.

## Interaction contracts

Preserve workspace focus handoffs and cancellation of requests on exit. Navigation
uses a desktop panel and a mobile Sheet; its closing transition participates in
focus restoration and canvas shortcut isolation.

Use semantic theme roles from [app.css](../app.css), accessible names for icon
controls, and reduced-motion behavior. The [Svelte interface ADR](../../docs/adr/svelte-interface.md)
defines the shared theme and interaction rules.
