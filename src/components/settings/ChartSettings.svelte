<!-- Copyright (C) 2026 Erik Landvall; SPDX-License-Identifier: AGPL-3.0-only.
See LICENSE and LICENSE-ADDITIONAL-TERMS. -->
<script lang="ts">
  import FieldSelect from "$lib/components/FieldSelect.svelte";
  import { chartPatternKinds, chartPatternOptions, type ChartSettings, type ChartPattern } from "$lib/chart-settings.ts";
  let { value, onValueChange, error = "", onRetry }: { value: ChartSettings; onValueChange: (value: ChartSettings) => void; error?: string; onRetry: () => void } = $props();
</script>
<fieldset aria-label="Chart patterns">
  <legend>Chart patterns</legend>
  <p>Patterns are off by default. Choose them independently for each graph type.</p>
  <div class="pattern-options">
    {#each chartPatternKinds as kind}
      <div><label for={`chart-pattern-${kind}`}>{kind[0]!.toUpperCase() + kind.slice(1)}</label>
        <FieldSelect id={`chart-pattern-${kind}`} label={`${kind[0]!.toUpperCase() + kind.slice(1)} pattern`} value={value.patterns[kind]}
          options={[...chartPatternOptions(kind)]} includePlaceholder={false}
          onValueChange={pattern => onValueChange({ patterns: { ...value.patterns, [kind]: pattern as ChartPattern } })} />
      </div>
    {/each}
  </div>
  {#if error}<p role="alert">{error}</p><button type="button" onclick={onRetry}>Retry saving chart patterns</button>{/if}
</fieldset>
<style>
  fieldset { margin: 16px; padding: 12px; border: 1px solid var(--color-border); min-width: 0; container-type: inline-size; color: var(--color-foreground); background: var(--color-surface); --field-background: var(--color-background); --field-foreground: var(--color-foreground); }
  legend { font-size: 14px; font-weight: 700; padding: 4px 8px; background: var(--color-surface); color: var(--color-foreground); border-radius: 4px; }
  p, label, button { font-size: 12px; }
  .pattern-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .pattern-options > div { display: grid; gap: 6px; min-width: 0; }
  p[role="alert"] { color: var(--color-error-foreground); background: var(--color-error-background); padding: 10px; }
  @container (max-width: 480px) { .pattern-options { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @container (max-width: 280px) { .pattern-options { grid-template-columns: 1fr; } }
</style>
