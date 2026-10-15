# Shared application controls

These Svelte components share interaction and presentation across workspaces.
Domain views live in [src/components](../../components/README.md); owned
shadcn primitives live in [ui](ui/README.md). This layer includes application-aware
adapters such as `OperationFieldControl`, not just generic widgets.

## Choose an existing control

| Need | Entry point |
| --- | --- |
| Schema-derived operation input | [OperationFieldControl.svelte](OperationFieldControl.svelte), backed by the `Field*` controls |
| Expandable content | [Disclosure.svelte](Disclosure.svelte) for a heading and panel; [Reveal.svelte](Reveal.svelte) for an externally controlled panel |
| Dialog or explanatory tooltip | [Modal.svelte](Modal.svelte), [HintButton.svelte](HintButton.svelte) |
| Structured data inspection | [JsonView.svelte](JsonView.svelte), [JsonSchemaView.svelte](JsonSchemaView.svelte) |
| Vault unlocking and operation credentials | [VaultAuthentication.svelte](VaultAuthentication.svelte), [CredentialBindingSelector.svelte](CredentialBindingSelector.svelte) |

Field controls accept editable values and callbacks; request validation remains in
[operation-input.ts](../operation-input.ts). Objects and arrays retain JSON text
drafts, while integer inputs reuse [integer-scale.ts](../integer-scale.ts).

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
