<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import HintButton from "./HintButton.svelte";
  import MaterialIcon from "./MaterialIcon.svelte";

  let { label, hint, icon, controls, checked, disabled = false, onchange }: {
    label: string; hint: string; icon: string; controls: string; checked: boolean;
    disabled?: boolean; onchange: (checked: boolean) => void;
  } = $props();
</script>

<HintButton label={hint} labelAsName={false}>
  {#snippet child({ props })}
    <span class="field-toggle" class:checked class:disabled>
      <input {...props} type="checkbox" aria-label={label} aria-controls={controls} {checked} {disabled}
        onchange={event => onchange(event.currentTarget.checked)} />
      <MaterialIcon name={icon} size={18} />
    </span>
  {/snippet}
</HintButton>

<style>
  .field-toggle { position: relative; display: grid; place-items: center; flex-shrink: 0; width: 34px; color: var(--control-label); }
  .field-toggle.checked { background: var(--color-badge-background); color: var(--color-badge-foreground); }
  input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
  .field-toggle:has(input:focus-visible) { outline: 2px solid var(--color-ring); outline-offset: -4px; }
  .disabled { background: var(--color-disabled); color: var(--color-disabled-foreground); }
  input:disabled { cursor: not-allowed; }
</style>
