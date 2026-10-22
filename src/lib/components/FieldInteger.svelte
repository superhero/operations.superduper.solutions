<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { createIntegerScale } from "$lib/integer-scale.ts";

  let { id, label, value, minimum, maximum, options, required = false, disabled = false, invalid = false,
    describedBy, valueText, showValue = true, stepped = false, logarithmic = false, onValueChange, onValueCommit }:
    { id: string; label: string; value: string; minimum?: number | undefined; maximum?: number | undefined; options?: number[] | undefined;
      required?: boolean; disabled?: boolean; invalid?: boolean; describedBy?: string | undefined; valueText?: string; showValue?: boolean; stepped?: boolean; logarithmic?: boolean;
      onValueChange: (value: string) => void; onValueCommit?: () => void } = $props();

  const allowed = $derived(options ? [...new Set(options)].filter(number => Number.isSafeInteger(number)
    && (minimum === undefined || number >= minimum) && (maximum === undefined || number <= maximum)).sort((a, b) => a - b) : undefined);
  const scale = $derived(createIntegerScale({ minimum: allowed?.[0] ?? minimum, maximum: allowed?.at(-1) ?? maximum }, logarithmic));
  const unavailable = $derived(scale.empty || allowed?.length === 0);
  const number = $derived(Number(value));
  const unset = $derived(value.trim() === "");
  const valid = $derived(!unavailable && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isSafeInteger(number)
    && number >= scale.minimum && number <= scale.maximum && (!allowed || allowed.includes(number)));
  const current = $derived(valid ? number : allowed?.[0] ?? Math.max(scale.minimum, Math.min(scale.maximum, 0)));
  const stops = $derived(stepped && allowed && allowed.length > 1 ? allowed : undefined);
  const position = $derived(stops ? stops.indexOf(current) / (stops.length - 1) : scale.position(current));
  const badValue = $derived(!unset && !valid);
  const validationMessage = $derived(unavailable ? "No safe integer satisfies this field's limits."
    : allowed ? "Choose one of the allowed integers."
    : `Enter a whole number between ${scale.minimum} and ${scale.maximum}.`);
  let exactInput = $state<HTMLInputElement>();
  let rangeWidth = $state(0);
  let rangeHeight = $state(0);

  $effect(() => { exactInput?.setCustomValidity(badValue || unavailable && required ? validationMessage : ""); });

  function emit(next: number) {
    if (disabled || unavailable) return;
    onValueChange(String(next));
  }

  function slide(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    let next = stops ? stops[Math.round(input.valueAsNumber * (stops.length - 1))] : scale.value(input.valueAsNumber);
    if (next === undefined) return;
    if (stops) input.valueAsNumber = stops.indexOf(next) / (stops.length - 1);
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

{#snippet rangeInput()}
  <input class="integer-range" bind:clientWidth={rangeWidth} bind:clientHeight={rangeHeight}
    style:--slider-hover-x={rangeWidth > 0 ? 1 + 8 / rangeWidth : 1}
    style:--slider-hover-y={rangeHeight > 0 ? 1 + 2 / rangeHeight : 1} {id} type="range" min="0" max="1" step={stops ? 1 / (stops.length - 1) : "any"} value={position}
    disabled={disabled || unavailable} aria-label={label} aria-valuemin={scale.minimum} aria-valuemax={scale.maximum}
    aria-valuenow={current} aria-valuetext={valueText ?? (unset ? "Not set" : valid ? number.toLocaleString() : "Invalid value")}
    aria-invalid={invalid || badValue || undefined} aria-describedby={describedBy}
    oninput={slide} onchange={() => onValueCommit?.()} onkeydown={keydown} />
{/snippet}

<div class="field-integer" class:disabled class:unset style:--slider-position={`${position * 100}%`}>
  {#if stops}
    <div class="integer-slider" style:--slider-hover-x={rangeWidth > 0 ? 1 + 8 / rangeWidth : 1}
      style:--slider-hover-y={rangeHeight > 0 ? 1 + 2 / rangeHeight : 1}>
      <div class="integer-ticks" aria-hidden="true">
        {#each stops as stop, index (stop)}
          <span class="integer-tick" class:active={stop === current} style:left={`${index / (stops.length - 1) * 100}%`}></span>
        {/each}
      </div>
      {@render rangeInput()}
    </div>
  {:else}
    {@render rangeInput()}
  {/if}
  {#if showValue}<input class="integer-value" id={`${id}-value`} type="text" inputmode="numeric" {value} {required} {disabled}
    bind:this={exactInput} aria-label={`${label} value`} aria-invalid={invalid || badValue || undefined}
    aria-describedby={describedBy} autocomplete="off" spellcheck={false}
    style:--value-width={`${Math.max(5, Math.min(18, value.length + 1))}ch`}
    oninput={event => onValueChange(event.currentTarget.value)} onchange={() => onValueCommit?.()} />{/if}
</div>

<style>
  .field-integer { display: flex; align-items: center; gap: 10px; min-width: 0; width: 100%; min-height: 40px; height: 100%; padding: 6px 10px; background: transparent; color: inherit; }
  .integer-slider { position: relative; flex: 1; min-width: 40px; height: 24px; }
  .integer-slider .integer-range { position: relative; display: block; }
  .integer-ticks { position: absolute; inset: 0 7px; pointer-events: none; }
  .integer-ticks::before { content: ""; position: absolute; top: 10px; left: 0; right: 0; height: 4px; background: linear-gradient(to right, var(--color-primary) var(--slider-position), var(--color-muted-foreground) var(--slider-position)); }
  .integer-tick { position: absolute; top: 7px; width: 1px; height: 10px; border-radius: 1px; background: var(--color-muted-foreground); transform: translateX(-50%); }
  .integer-tick.active { background: var(--color-primary); }
  .integer-range { flex: 1; min-width: 40px; width: 100%; height: 24px; padding: 0; margin: 0; border: 0; border-radius: 4px; appearance: none; background: transparent; color: inherit; cursor: pointer; }
  .integer-range::-webkit-slider-runnable-track { height: 4px; border-radius: 4px; background: linear-gradient(to right, var(--color-primary) var(--slider-position), var(--color-muted-foreground) var(--slider-position)); }
  .integer-range::-moz-range-track { height: 4px; border-radius: 4px; background: linear-gradient(to right, var(--color-primary) var(--slider-position), var(--color-muted-foreground) var(--slider-position)); }
  .integer-slider .integer-range::-webkit-slider-runnable-track { background: transparent; }
  .integer-slider .integer-range::-moz-range-track { background: transparent; }
  .integer-range::-webkit-slider-thumb { width: 14px; height: 14px; margin-top: -5px; border: 0; border-radius: 4px; appearance: none; background: var(--color-primary); }
  .integer-range::-moz-range-thumb { width: 14px; height: 14px; border: 0; border-radius: 4px; background: var(--color-primary); }
  .integer-range:focus-visible, .integer-value:focus-visible, .field-integer > .integer-range:hover:enabled, .integer-value:hover:enabled { outline: 2px solid var(--color-ring); outline-offset: 2px; }
  .integer-value { flex: 0 1 var(--value-width); width: var(--value-width); min-width: 4ch; max-width: 50%; padding: 3px; border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; font-variant-numeric: tabular-nums; text-align: right; }
  .disabled { color: var(--color-muted-foreground); }
  .integer-range:disabled { cursor: default; opacity: 0.5; }
  .unset .integer-range { opacity: 0.6; }
  @media (prefers-reduced-motion: no-preference) {
    .integer-range, .integer-slider { transition: transform 180ms ease-in; }
    .integer-range:hover:enabled { transform: scale(var(--slider-hover-x), var(--slider-hover-y)); }
    .integer-slider .integer-range:hover:enabled { transform: none; }
    .field-integer:not(.disabled) .integer-slider:hover { transform: scale(var(--slider-hover-x), var(--slider-hover-y)); }
  }
</style>
