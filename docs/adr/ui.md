# UI

## Stack

- use **Svelte** for application UI;
- use **shadcn-svelte** for common UI components, adapting the owned component source when needed;
- use **Svelte Flow** (`@xyflow/svelte`) for workflow graph interaction.

Prefer these before creating equivalent UI primitives from scratch.

## Colors

Use five semantic color tokens:

- `--color-background`: base background;
- `--color-surface`: panels and controls;
- `--color-foreground`: text and structural foreground;
- `--color-accent`: interactions, selections, and primary actions;
- `--color-emphasis`: stronger highlights and attention states.

Themes define their values. Components use the semantic tokens rather than hard-coded palette values.

Derived shades use the same tokens, for example with `color-mix()`, instead of adding unrelated palette constants.
