<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { createIntegerScale } from "$lib/integer-scale.ts";

  let { id, label, value, minimum, maximum, options, required = false, disabled = false, invalid = false,
    describedBy, onValueChange, onValueCommit }:
    { id: string; label: string; value: string; minimum?: number | undefined; maximum?: number | undefined; options?: number[] | undefined;
      required?: boolean; disabled?: boolean; invalid?: boolean; describedBy?: string | undefined;
      onValueChange: (value: string) => void; onValueCommit?: () => void } = $props();

  const allowed = $derived(options ? [...new Set(options)].filter(number => Number.isSafeInteger(number)
    && (minimum === undefined || number >= minimum) && (maximum === undefined || number <= maximum)).sort((a, b) => a - b) : undefined);
  const scale = $derived(createIntegerScale({ minimum: allowed?.[0] ?? minimum, maximum: allowed?.at(-1) ?? maximum }));
  const unavailable = $derived(scale.empty || allowed?.length === 0);
  const number = $derived(Number(value));
  const unset = $derived(value.trim() === "");
  const valid = $derived(!unavailable && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isSafeInteger(number)
    && number >= scale.minimum && number <= scale.maximum && (!allowed || allowed.includes(number)));
  const current = $derived(valid ? number : allowed?.[0] ?? Math.max(scale.minimum, Math.min(scale.maximum, 0)));
  const position = $derived(scale.position(current));
  const badValue = $derived(!unset && !valid);
  const validationMessage = $derived(unavailable ? "No safe integer satisfies this field's limits."
    : allowed ? "Choose one of the allowed integers."
    : `Enter a whole number between ${scale.minimum} and ${scale.maximum}.`);
  let exactInput = $state<HTMLInputElement>();

  $effect(() => { exactInput?.setCustomValidity(badValue || unavailable && required ? validationMessage : ""); });

  function emit(next: number) {
    if (disabled || unavailable) return;
    onValueChange(String(next));
  }

  function slide(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    let next = scale.value(input.valueAsNumber);
    if (next === undefined) return;
    if (allowed?.length) next = allowed.reduce((closest, candidate) => Math.abs(candidate - next!) < Math.abs(closest - next!) ? candidate : closest);
    emit(next);
  }

  function keydown(event: KeyboardEvent) {
    if (disabled || unavailable || (event.currentTarget as HTMLInputElement).matches(":disabled")) return;
    const direction = ["ArrowRight", "ArrowUp", "PageUp"].includes(event.key) ? 1
      : ["ArrowLeft", "ArrowDown", "PageDown"].includes(event.key) ? -1 : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    event.stopPropagation();
    let next = event.key === "Home" ? scale.minimum : event.key === "End" ? scale.maximum
      : current + direction * (event.key.startsWith("Page") ? 10 : 1);
    if (allowed?.length && direction) next = direction > 0 ? allowed.find(candidate => candidate > current) ?? allowed.at(-1)!
      : allowed.findLast(candidate => candidate < current) ?? allowed[0]!;
    emit(Math.max(scale.minimum, Math.min(scale.maximum, next)));
    onValueCommit?.();
  }
</script>

<div class="field-integer" class:disabled class:unset style:--slider-position={`${position * 100}%`}>
  <input class="integer-range" {id} type="range" min="0" max="1" step="any" value={position}
    disabled={disabled || unavailable} aria-label={label} aria-valuemin={scale.minimum} aria-valuemax={scale.maximum}
    aria-valuenow={current} aria-valuetext={unset ? "Not set" : valid ? number.toLocaleString() : "Invalid value"}
    aria-invalid={invalid || badValue || undefined} aria-describedby={describedBy}
    oninput={slide} onchange={() => onValueCommit?.()} onkeydown={keydown} />
  <input class="integer-value" id={`${id}-value`} type="text" inputmode="numeric" {value} {required} {disabled}
    bind:this={exactInput} aria-label={`${label} value`} aria-invalid={invalid || badValue || undefined}
    aria-describedby={describedBy} placeholder="Not set" autocomplete="off" spellcheck={false}
    style:--value-width={`${Math.max(5, Math.min(18, value.length + 1))}ch`}
    oninput={event => onValueChange(event.currentTarget.value)} onchange={() => onValueCommit?.()} />
</div>

<style>
  .field-integer { display: flex; align-items: center; gap: 10px; min-width: 0; width: 100%; min-height: 40px; height: 100%; padding: 6px 10px; background: transparent; color: inherit; }
  .integer-range { flex: 1; min-width: 40px; width: 100%; height: 24px; padding: 0; margin: 0; border: 0; border-radius: 4px; appearance: none; background: transparent; color: inherit; cursor: pointer; }
  .integer-range::-webkit-slider-runnable-track { height: 4px; border-radius: 4px; background: linear-gradient(to right, var(--color-primary) var(--slider-position), var(--color-muted-foreground) var(--slider-position)); }
  .integer-range::-moz-range-track { height: 4px; border-radius: 4px; background: linear-gradient(to right, var(--color-primary) var(--slider-position), var(--color-muted-foreground) var(--slider-position)); }
  .integer-range::-webkit-slider-thumb { width: 14px; height: 14px; margin-top: -5px; border: 0; border-radius: 4px; appearance: none; background: var(--color-primary); }
  .integer-range::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: 4px; background: var(--color-primary); }
  .integer-range:focus-visible, .integer-value:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px; }
  .integer-value { flex: 0 1 var(--value-width); width: var(--value-width); min-width: 4ch; max-width: 50%; padding: 3px; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; font-variant-numeric: tabular-nums; text-align: right; }
  .integer-value::placeholder { color: var(--color-muted-foreground); font-style: italic; opacity: 1; }
  .disabled { color: var(--color-muted-foreground); }
  .integer-range:disabled { cursor: default; opacity: 0.5; }
  .unset .integer-range { opacity: 0.6; }
</style>
