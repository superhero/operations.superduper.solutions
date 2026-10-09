# UI

## Stack

- use **Svelte** for application UI;
- use **shadcn-svelte** for common UI components, adapting the owned component source when needed;
- use **Svelte Flow** (`@xyflow/svelte`) for workflow graph interaction.

Prefer these before creating equivalent UI primitives from scratch.

Use **workflow** consistently for the product concept in UI copy, code, filenames and tests. Preserve third-party API and icon identifiers, and existing storage keys needed to keep saved workflows compatible.

## Colors

A color palette is exactly six hex values, ordered by relative luminance from lightest to darkest: `--palette-1` through `--palette-6`. Define them in `src/palette.css`. Palette identity and display mode are independent: every palette supports both light and dark mode through the same mapping.

`src/app.css` exposes six active slots, `--tone-1` through `--tone-6`. Light mode uses the palette in order; dark mode reverses it exactly:

| Active slot | Light mode | Dark mode |
| --- | --- | --- |
| 1 | Palette 1 | Palette 6 |
| 2 | Palette 2 | Palette 5 |
| 3 | Palette 3 | Palette 4 |
| 4 | Palette 4 | Palette 3 |
| 5 | Palette 5 | Palette 2 |
| 6 | Palette 6 | Palette 1 |

Define every component-facing role once, as an alias to an active slot or another role. The dark-mode selector only reverses these six slots and sets `color-scheme`; it must not override individual semantic roles. Inputs, reports, interaction states and effects follow the same reversal as the rest of the interface. Components must not reference palette or active slots directly, nor branch on the selected palette or mode.

Use slot 1 for the page and input surfaces, 2 for panels, 6 for ordinary text, and 5 for secondary text. Filled primary actions use 4 with text 1; label badges use 3 with text 6. Completed steps, selected or hovered catalog items, and similar neutral button highlights use the ordinary text color as their fill (slot 6) with opposite text (slot 1): darkest on light mode and lightest on dark mode. This employs all six colors during normal use. Choose role pairs for readable contrast in both their original and reversed forms; avoid assigning a middle color to small text on an adjacent middle-colored surface.

Decorative borders, separators and tree connectors use the shared border role at slot 1, which becomes palette slot 6 in dark mode. Do not borrow text colors for ordinary frames or allow library borders to inherit `currentColor`. Focus, selection, validation and graph connections retain their distinct, stronger roles because they communicate interaction or relationships.

Progress buttons sit directly together without layout gaps. Their chevron edges have fixed 4px borders: right edges except on the last button, and left edges except on the first. Borders always match the pane's surface color, including during hover. There are no borders along the top or bottom. Keep these separate from the keyboard focus outline and disabled-state colors.

Available progress steps use slot 6 with text in slot 1: darkest in light mode and lightest in dark mode, distinct from the pane surface.

Disabled buttons use slot 5 for the background and slot 2 for the foreground, reversed with the theme. Progress steps, toolbar controls and shared buttons use these same disabled roles at full opacity, with native disabled semantics and no hover activation or scaling. Do not use opacity alone to represent an unavailable action.

Replacing a palette changes only its six ordered values. Additional named palettes can define those same six variables under `:root[data-palette="name"]`; mode and component rules stay shared. Apply palette selection at the document root, where the aliases resolve. The animated background observes palette selection as well as mode changes. Keep the currently selected hex values out of this ADR.

Settings lists the available palettes with six swatches and a single selected choice. These swatches preview palette values directly; the surrounding controls still use semantic color roles. Store the chosen palette separately from light/dark mode, restore it before rendering, and fall back to the default palette for an unknown selection or unavailable browser storage.

Both page backgrounds are solid colors beneath the animated lines. Ordinary fills, text, borders and hover states must use one of the six exact colors. Never mix two palette colors to manufacture another shade. Mixing a palette color with transparency is reserved for effects: shadows, focus halos, modal backdrops, scroll fades, canvas grid/wave decoration and selection/minimap masks. Transitional opacity is also an effect, not an additional base color.

Lightness order alone does not guarantee contrast. Keep normal text and placeholders at least 4.5:1 against their surfaces, including hovered controls, and distinguish required, selected and error states through text, icons or structure as well as color. Validate each palette with the shared mappings in both modes; revise unsuitable palette values or shared role assignments instead of adding mode-specific exceptions. Browser checks cover exact reversal, replacement palettes, semantic role bindings, contrast and behavior without duplicating the shipped hex values.

## Hover scaling

Limit hover enlargement to 12px of total width, capped by each control's scale limit. Measure layout width on pointer entry or keyboard focus so wide rows grow less than compact buttons, using one shared document handler that also covers portal content. Preserve uniform scaling of the surface and its contents.

Scale controls once, keeping their nested text and icons in the same animation. On devices with a fine pointer and hover support, retain a composited layer only for enabled controls that actually scale. This avoids the text-rendering change observed in Brave when its temporary animation layer disappeared at transition completion. Do not add or remove the hint on hover: both entering and leaving must keep the same rendering mode. Reduced-motion and touch-only layouts do not request these layers.

Keep progress buttons above idle neighbors until their hover-out scaling finishes. Use the same duration for the scale transition and delayed stacking reset, with immediate elevation on entry. A newly hovered or keyboard-focused neighbor takes priority over a button still returning to rest. Disabled controls and reduced-motion layouts reset without this delay.

The tradeoff is slightly softer enlarged text and some additional rendering memory. Keep the treatment scoped to small controls and headings, not page panels or every element. Native disclosure chevron rotation and switch-thumb movement remain independent of this scaling treatment.

## Workflow canvas

Use the archived `laya-ai` 0.13.11 workflow editor as the behavioral reference for operation owners, schema panels, field connections, routing nodes, comments and saved workflows. Adapt those behaviors to the shared semantic theme and Svelte Flow. Plans remain browser-local; execution is a separate, explicit action.

Each newly added operation owns input panels on the left and successful-response panels on the right. Named object properties and array items come from documented schemas, never inferred response examples. Unsupported or unavailable schema shapes show a notice. Keep structural schema attachments distinct from user mappings: users connect named output fields to named input fields; operation ports and panel headers only express ownership. Body snapping considers visible, eligible input handles before choosing the nearest one and shows a faint target preview alongside the pointer connection.

Hiding a branch preserves its structure for restoration and removes affected mappings. Deleting an operation removes its owned panels and connections. Persist ownership, field handles and hidden branches in version 2 documents, while continuing to read and edit version 1 operation-only plans under the existing storage key. Selection, measurements and drag previews are transient UI state. Canvas nodes retain their size on hover so ports remain stable during connection gestures. Their position transforms must update directly during pointer and keyboard movement: exclude focusable Svelte Flow node wrappers from shared transform transitions, which otherwise make rendered nodes trail behind their connections. Keep hover and focus color feedback on the node contents.

Version 3 adds descriptions, Switch, Cast, Comment and nested workflow nodes without rewriting old documents until a new feature is used. A Switch emits its input through its first matching gate; connected operands replace manual values. Removing a gate also removes its mappings, and the final gate cannot be removed. Cast converts primitive values to Text, Number or Boolean. Comment Markdown renders escaped text and safe links, never raw HTML. Editing a node must not trigger canvas delete, pan or selection shortcuts.

Nested workflow nodes contain a validated snapshot, so exported plans remain portable and deleting a saved original does not break its copies. Their interface exposes unsupplied inputs and documented outputs; endpoint identities must match the embedded graph. Bound document size, aggregate graph size and nesting depth. Saved-library updates, description saves and bulk removals report storage errors and allow retry without discarding the draft.

Run controls use explicit step submission, starting-operation choice, Next operation and End run. Show the selected operation's execution mode and destination before submission. Route execution through the shared catalog registry and an injectable executor: **Examples · example.com** contains 19 local mock operations, while **Examples · httpbin** contains 14 operations that send real requests to `https://httpbin.org`. The mock catalog's URLs use [IANA's documentation domain](https://www.iana.org/help/example-domains/) without contacting it; project/task fixture changes are scoped to a run. The live catalog uses [httpbin's request and response service](https://httpbin.org/) and reports actual transport, HTTP and response-decoding failures with retry. Browser tests intercept live requests and verify that mock runs make no network requests.

Both catalogs demonstrate GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS; TRACE is mock-only because browser Fetch forbids it. Preserve the existing `demo:*` project/task operation identifiers, paths and field identities so saved documents remain compatible. Register source schemas, navigation groups and execution origins together; do not infer a destination from an operation's visible label.

Use the same typed input controls for request previews and workflow runs. Render object and array drafts as JSON text, and validate declared nested properties, item types, required fields and supported bounds before execution. Support primitive path/header parameters, repeated query-array parameters and explicitly declared flat `deepObject` query objects. Request bodies may be named JSON objects with structured properties, root JSON values, plain text, URL-encoded forms or multipart forms with primitive text fields. Each operation declares one request media type; multipart file uploads, dynamic properties, schema unions/composition, remote references and unsupported constraints remain explicit errors. The curated httpbin schemas define example forms for arbitrary echo inputs, not additional requirements imposed by the service.

Preserve mapped field types and assemble declared nested-property and array-item mappings before validating the complete input. Conflicting mapped values fail; Cast remains limited to primitive conversions. Propagate routing and nested outputs, and cancel pending live requests when the run closes. Running does not modify the editor's document, and cycles fail rather than repeat API calls indefinitely.
