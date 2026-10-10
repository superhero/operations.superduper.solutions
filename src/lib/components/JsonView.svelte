<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import Disclosure from "./Disclosure.svelte";
  import MaterialIcon from "./MaterialIcon.svelte";

  type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
  let { value, label = "JSON document", wrap = true }: { value: unknown; label?: string; wrap?: boolean } = $props();
  let expanded = $state<Record<string, boolean>>({});

  const document = $derived.by(() => {
    try {
      const text = JSON.stringify(value, null, 2);
      if (text === undefined) return { text: null, value: null, error: "This value cannot be represented as JSON." };
      const parsed: JsonValue = JSON.parse(text);
      return { text, value: parsed, error: "" };
    } catch {
      return { text: null, value: null, error: "This value cannot be represented as JSON." };
    }
  });

  $effect(() => {
    document.text;
    expanded = {};
  });

</script>

{#snippet property(key: string | null)}
  {#if key !== null}<span class="json-key">{JSON.stringify(key)}</span><span class="json-punctuation">{": "}</span>{/if}
{/snippet}

{#snippet entry(item: JsonValue, path: string, key: string | null, comma: boolean, depth: number)}
  {#if item !== null && typeof item === "object"}
    {@const array = Array.isArray(item)}
    {@const entries = Object.entries(item)}
    {#if key !== null}<div class="json-line json-container-key">{@render property(key)}</div>{/if}
    {#if entries.length}
      {@const open = expanded[path] ?? true}
      <Disclosure class="json-branch" {open} groupLabel={`${label}: ${path}`}
        label={`${path}: ${entries.length} ${array ? "items" : "properties"}`} tooltipEnabled={false}
        onToggle={(next) => { expanded[path] = next; }}>
        {#snippet summary()}
          <span class="json-toggle" aria-hidden="true"><MaterialIcon name="chevron_forward" size={16} /></span><span class="json-bracket">{array ? "[" : "{"}</span>{#if !open}<span class="json-folded">{" … "}</span><span class="json-bracket">{array ? "]" : "}"}</span><span class="json-punctuation">{comma ? "," : ""}</span>{/if}
        {/snippet}
          <div class="json-children" style:--json-depth-indent={`${(depth + 1) * 2}ch`}>
            {#each entries as [childKey, childValue], index (childKey)}
              {@render entry(childValue, array ? `${path}[${childKey}]` : `${path}[${JSON.stringify(childKey)}]`, array ? null : childKey, index < entries.length - 1, depth + 1)}
            {/each}
          </div><div class="json-line json-closing"><span class="json-bracket">{array ? "]" : "}"}</span><span class="json-punctuation">{comma ? "," : ""}</span></div>
      </Disclosure>
    {:else}
      <div class="json-line"><span class="json-bracket">{array ? "[" : "{"}</span></div>
      <div class="json-line json-closing"><span class="json-bracket">{array ? "]" : "}"}</span><span class="json-punctuation">{comma ? "," : ""}</span></div>
    {/if}
  {:else}
    <div class="json-line" class:json-string-line={typeof item === "string"}>{#if key !== null}<span class="json-property">{@render property(key)}</span>{/if}<span class="json-value"><span class:json-string={typeof item === "string"} class:json-description={typeof item === "string" && key !== null && ["description", "title", "version", "openapi", "summary"].includes(key)} class:json-description-text={key === "description" && typeof item === "string"} class:json-number={typeof item === "number"} class:json-boolean={typeof item === "boolean"} class:json-null={item === null}>{JSON.stringify(item)}</span><span class="json-punctuation">{comma ? "," : ""}</span></span></div>
  {/if}
{/snippet}

<section class="json-view" aria-label={label}>
  {#if document.error}
    <p class="json-error" role="alert">{document.error}</p>
  {:else}
    <div class="json-scroll" role="document" aria-label={`Read-only ${label}`}>
      <div class="json-tree" class:wrap>
        {@render entry(document.value, "$", null, false, 0)}
      </div>
    </div>
  {/if}
</section>

<style>
  .json-view { min-width: 0; max-width: 100%; color: var(--color-foreground); }
  .json-error { color: var(--color-error-foreground); background: var(--color-error-background); }
  .json-error { padding: 12px; font-size: 12px; }
  .json-scroll { width: 100%; min-width: 0; max-width: 100%; overflow: auto; border: 1px solid transparent; border-radius: 4px; background: var(--color-report-card); outline: 2px solid transparent; outline-offset: 2px; transition: outline-color 180ms ease-in; }
  .json-scroll:focus-visible { outline-color: var(--color-foreground); }
  .json-tree { --json-white-space: pre-wrap; --json-indent: 0ch; min-width: 0; padding: 12px 0; font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  .json-tree.wrap { container-type: inline-size; }
  .json-tree:not(.wrap) { --json-white-space: pre; width: max-content; min-width: 100%; overflow-wrap: normal; }
  .json-view :global(.json-branch) { min-width: 0; white-space: normal; }
  .json-view :global(.json-branch > summary) { position: relative; white-space: var(--json-white-space); margin-left: 8px; padding: 0 12px 0 calc(4px + var(--json-indent) + 1.1rem); list-style: none; border-radius: 2px; outline: 2px solid transparent; outline-offset: -2px; transition: background-color 180ms ease-in, outline-color 180ms ease-in; }
  .json-toggle { position: absolute; left: 2px; top: 2px; display: grid; place-items: center; width: 16px; height: 16px; color: var(--color-surface); transition: transform 180ms ease-in, color 180ms ease-in; }
  .json-view :global(.json-branch > summary[aria-expanded="true"] > .json-toggle) { transform: rotate(90deg); }
  .json-view :global(.json-branch > summary:is(:hover, :focus-visible)) { background: var(--color-surface); }
  .json-view :global(.json-branch > summary:is(:hover, :focus-visible) > :is(.json-toggle, .json-bracket)),
  .json-view :global(.json-branch > summary:is(:hover, :focus-visible) + .disclosure-panel > .json-closing > .json-bracket) { color: var(--color-foreground); }
  .json-view :global(.json-branch > summary:focus-visible) { outline-color: var(--color-foreground); }
  .json-line { white-space: var(--json-white-space); padding: 0 12px 0 calc(12px + var(--json-indent) + 1.1rem); }
  .json-tree.wrap .json-string-line { display: flex; flex-wrap: wrap; }
  .json-tree.wrap .json-string-line > .json-property { flex: 0 0 auto; max-width: 100%; }
  .json-tree.wrap .json-string-line > .json-value { flex: 1; min-width: min(100%, 4ch); padding-left: 1ch; text-indent: -1ch; }
  .json-children { position: relative; --json-indent: var(--json-depth-indent); }
  .json-tree.wrap .json-children { --json-indent: min(var(--json-depth-indent), max(0px, calc(100cqi - 24px - 1.1rem - 4ch))); }
  .json-children::before { content: ''; position: absolute; top: 4px; bottom: 4px; left: calc(12px + 1.1rem + var(--json-indent) - 1.5ch); width: 1px; color: var(--color-surface); background: radial-gradient(circle at 0.5px 0.5px, currentColor 0.5px, transparent 0.5px) 0 0 / 1px 3px repeat-y; opacity: 0.5; pointer-events: none; transition: color 180ms ease-in; }
  .json-view :global(.json-branch > summary:is(:hover, :focus-visible) + .disclosure-panel > .json-children)::before { color: var(--color-foreground); }
  .json-punctuation { color: var(--color-muted-foreground); }
  .json-bracket { color: var(--color-surface); }
  .json-folded { color: var(--color-accent); }
  .json-key { color: var(--color-json-key); font-weight: 600; }
  .json-key, .json-bracket { transition: color 180ms ease-in; }
  .json-string { color: var(--color-json-string); }
  .json-description { color: var(--color-json-description); }
  .json-description-text { font-style: italic; }
  .json-number { color: var(--color-json-value); font-weight: 700; }
  .json-boolean { color: var(--color-json-value); font-weight: 700; }
  .json-null { color: var(--color-muted-foreground); font-style: italic; }
  @media (prefers-reduced-motion: reduce) { .json-scroll, .json-toggle, .json-key, .json-bracket, .json-children::before, .json-view :global(.json-branch > summary) { transition: none; } }
  @media (forced-colors: active) { .json-scroll:not(:focus-visible), .json-view :global(.json-branch > summary:not(:focus-visible)) { outline-style: none; } }
</style>
