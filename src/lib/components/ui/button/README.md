# Button

Import `Button` from `$lib/components/ui/button/index.js`.
[index.ts](index.ts) also exports `Root`, `buttonVariants` and the public prop,
variant and size types. [button.svelte](button.svelte) owns both rendering and
the `tailwind-variants` definitions.

## Behavior

| Prop | Effect |
| --- | --- |
| `variant`, `size` | Select shared appearance and dimensions |
| `href` | Renders an anchor; without it, renders a native button |
| `disabled` | Disables the button or removes the anchor destination and tab stop |
| `tooltip` | Composes [HintButton](../../HintButton.svelte) without replacing the accessible name |
| `ref`, `class`, remaining attributes | Bind the element and pass through caller customization |

Buttons default to `type="button"`; use `type="submit"` explicitly in forms.
Supply an accessible name for icon-only content. Tooltip copy supplements that
name, so it does not replace a label.

## Styling contract

Preserve `data-slot="button"`, the content wrapper and merged trigger/caller props.
[app.css](../../../../app.css) supplies shared disabled and hover behavior around
these hooks. Keep disabled controls opaque and non-activating, and retain focus
and invalid-state styling when adding variants. Follow the
[UI ownership guidance](../README.md) when updating registry-derived source.
