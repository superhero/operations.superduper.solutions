# Owned UI primitives

This is the local source for shadcn-svelte primitives, currently
[Button](button/README.md) and [Sheet](sheet/README.md). Components are adapted to
the application's theme, tooltips and motion behavior; review those adaptations
before replacing source from the registry.

## Integration

[components.json](../../../../components.json) routes generated UI here through
`$lib/components/ui` and points Tailwind at [app.css](../../../app.css). Public
component exports live in each directory's `index.ts`; consumers use imports such
as `$lib/components/ui/button/index.js`. Shared class composition and prop utility
types come from [utils.ts](../../utils.ts).

Bits UI supplies headless behavior, while local source supplies styling and
composition. Keep workspace orchestration in
[src/components](../../../components/README.md) and application control patterns in
the [parent directory](../README.md).

## Change carefully

Retain forwarded props, bindable refs, child snippets and accessible semantics.
`data-slot` attributes also connect primitives to global styles, including disabled
and hover behavior. Use semantic theme tokens rather than palette-specific values.
The [Svelte interface ADR](../../../../docs/adr/svelte-interface.md) asks contributors
to adapt owned primitives before building equivalents; it also defines focus,
contrast and reduced-motion expectations.
