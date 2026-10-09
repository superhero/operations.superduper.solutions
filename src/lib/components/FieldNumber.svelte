<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import MaterialIcon from "./MaterialIcon.svelte";

  let { id, label, value, integer = false, minimum, maximum, required = false, disabled = false, invalid = false, describedBy, onValueChange }:
    { id: string; label: string; value: string; integer?: boolean; minimum?: number | undefined; maximum?: number | undefined;
      required?: boolean; disabled?: boolean; invalid?: boolean; describedBy?: string | undefined; onValueChange: (value: string) => void } = $props();
  let input: HTMLInputElement;

  function change(direction: 1 | -1) {
    if (disabled || input.disabled || input.readOnly || input.matches(":disabled")) return;
    input.focus({ preventScroll: true });
    const previous = input.value;
    if (integer) input.stepUp(direction);
    else {
      // Native stepping rejects step="any"; preserve the entered decimal precision.
      const current = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0;
      const [significand = "", exponent = "0"] = previous.toLowerCase().split("e");
      const precision = Math.max(0, (significand.split(".")[1]?.length ?? 0) - Number(exponent));
      let next = Number((current + direction).toFixed(Math.min(100, precision)));
      if (minimum !== undefined) next = Math.max(next, minimum);
      if (maximum !== undefined) next = Math.min(next, maximum);
      if (!Number.isFinite(next) || previous !== "" && (next - current) * direction < 0) return;
      input.valueAsNumber = next;
    }
    if (input.value !== previous) {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
</script>

<div class="field-number" class:disabled>
  <input bind:this={input} class="field-input" {id} type="number" {value} {required} {disabled}
    min={minimum} max={maximum} step={integer ? 1 : "any"} aria-label={label}
    aria-invalid={invalid || undefined} aria-describedby={describedBy}
    oninput={(event) => onValueChange(event.currentTarget.value)} />
  <div class="field-number-steppers">
    <button type="button" tabindex="-1" {disabled} aria-label={`Increase ${label}`} aria-controls={id}
      onpointerdown={(event) => event.preventDefault()} onclick={() => change(1)}><MaterialIcon name="keyboard_arrow_up" size={18} /></button>
    <button type="button" tabindex="-1" {disabled} aria-label={`Decrease ${label}`} aria-controls={id}
      onpointerdown={(event) => event.preventDefault()} onclick={() => change(-1)}><MaterialIcon name="keyboard_arrow_down" size={18} /></button>
  </div>
</div>

<style>
  .field-number { position: relative; min-width: 0; width: 100%; overflow: hidden; }
  .field-number input.field-input { height: 100%; padding-right: 36px; appearance: textfield; -moz-appearance: textfield; }
  .field-number input::-webkit-inner-spin-button, .field-number input::-webkit-outer-spin-button { margin: 0; -webkit-appearance: none; }
  .field-number-steppers { position: absolute; inset: 0 0 0 auto; display: grid; grid-template-rows: 1fr 1fr; width: 28px; background: var(--control-addon); color: var(--control-label); visibility: hidden; translate: 100% 0; pointer-events: none; transition: translate 180ms ease-in, visibility 0s linear 180ms; }
  :global(.joined-field:is(:hover, :focus-within)) .field-number input:not(:disabled):not([readonly]) + .field-number-steppers { visibility: visible; translate: 0 0; pointer-events: auto; transition-delay: 0s; }
  .field-number-steppers button { display: grid; place-items: center; min-width: 0; min-height: 20px; padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; outline: none; }
  .field-number-steppers :global(.material-symbols-rounded) { font-variation-settings: "FILL" 1; }
  @media (hover: none), (pointer: coarse) {
    .field-number input:not(:disabled):not([readonly]) + .field-number-steppers { visibility: visible; translate: 0 0; pointer-events: auto; transition-delay: 0s; }
  }
  @media (prefers-reduced-motion: reduce) {
    .field-number-steppers { transition: none; }
  }
</style>
