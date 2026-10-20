# Shared application controls

These Svelte components share interaction and presentation across workspaces.
Domain views live in [src/components](../../components/README.md); owned
shadcn primitives live in [ui](ui/README.md). This layer includes application-aware
adapters such as `OperationFieldControl`, not just generic widgets.

## Choose an existing control

| Need | Entry point |
| --- | --- |
| Schema-derived operation input | [OperationFieldControl.svelte](OperationFieldControl.svelte), backed by the `Field*` controls |
| Grouped operation forms | [OperationFields.svelte](OperationFields.svelte), including field information, validation, optional bodies and connected inputs |
| Omitted and nullable field controls | [OperationFieldToggle.svelte](OperationFieldToggle.svelte), preserving drafts while selecting request presence |
| Expandable content | [Disclosure.svelte](Disclosure.svelte) for a heading and panel; [Reveal.svelte](Reveal.svelte) for an externally controlled panel |
| Dialog or explanatory tooltip | [Modal.svelte](Modal.svelte), [HintButton.svelte](HintButton.svelte) |
| Structured data inspection | [JsonView.svelte](JsonView.svelte), [JsonSchemaView.svelte](JsonSchemaView.svelte) |
| Vault unlocking and operation credentials | [VaultAuthentication.svelte](VaultAuthentication.svelte), [CredentialBindingSelector.svelte](CredentialBindingSelector.svelte) |

Field controls accept editable values and callbacks; request validation remains in
[operation-input.ts](../operation-input.ts). Objects and arrays retain JSON text
drafts, while integer inputs reuse [integer-scale.ts](../integer-scale.ts).
Request values distinguish omitted fields (`undefined`), explicit `null` and text.
Required and nullable are independent; connected values cannot be overridden.

Vault controls keep temporary passwords in DOM inputs, clear them on use or
teardown, and pass only opaque bindings into operation/workflow state. Transfer
plain descriptors to workers; Svelte state proxies cannot be structured-cloned.
Cryptography and destination authorization belong in [secrets](../secrets/README.md).

## Preserve shared behavior

Carry labels, descriptions, invalid/disabled state and focus behavior through
wrappers. Account for portalled menus and tooltips when setting active state or
dialog layering. Hidden animated panels must remain inaccessible while closing.
Reuse semantic roles from [app.css](../../app.css), and preserve reduced-motion
handling and cancellation of stale animation completions. See the
[interface ADR](../../../docs/adr/svelte-interface.md) before changing a shared
interaction.

## Large JSON sources

`JsonSchemaView` accepts an asynchronous source loader and revision key. It loads
on open, ignores obsolete replies and releases data after the closing transition.
Pass a page limit for large sources. `JsonView`'s `validated` path accepts only
owned, immutable JSON that has already passed domain validation; arbitrary inputs
retain normalization. Formatted copy text is created only when requested.

`Disclosure.onClosed` and `Reveal.onClosed` support release after animation.
Invalidate pending replies when closing starts, then release outgoing data in the
callback so its intrinsic height remains available to the slide. Reopening cancels
obsolete completions; reduced motion settles and releases without animation.
Disabling a Disclosure tooltip uses a native summary without instantiating tooltip
state; preserve nested-control events, keyboard focus and reduced-motion behavior.
