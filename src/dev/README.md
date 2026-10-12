# Development interface adapters

This directory integrates the Visulima error overlay and developer toolbar with
the application's diagnostics and palette. Keep dependency-specific DOM, theme
and error-transport adaptation here. Production logging and application recovery
remain in [lib](../lib/README.md) and the relevant workspaces.

## Entry points and lifetimes

[index.ts](../index.ts) loads the context adapter, toolbar theme and tooltips only
under `import.meta.env.DEV`. [vite.config.mjs](../../vite.config.mjs) injects the
error-chain hook before overlay listeners and supplies overlay CSS. Preserve
development-only loading and clean up observers, mounted components and listeners
during hot replacement.

The toolbar is opt-in through Settings → Developer; the overlay operates
independently. Theme adapters follow application palette changes, including
toolbar shadow roots. Dependency upgrades can change those private structures
and injected runtime shapes, so review the adapters as part of an upgrade.

## Diagnostic invariants

Keep native error stacks, codes and cause chains intact. Thrown non-Error values
may receive a descriptive wrapper, but reporting must not invent a stack or
source location. Cause navigation and unrelated error history are separate.
Preserve the configured console-forwarding limits to avoid error transport loops.
The [error-reporting decision](../../docs/adr/error-view.md) defines these rules.

Exercise the development overlay and toolbar smoke checks in
[tests](../../tests/README.md) after adapter changes; also verify that the
production build excludes these tools.
