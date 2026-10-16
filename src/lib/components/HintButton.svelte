<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->

<script lang="ts">
  import { Tooltip } from "bits-ui";
  import { flushSync, onMount, type ComponentProps, type Snippet } from "svelte";
  let { label, bottomLabel, labelAsName = true, tooltipEnabled = true, tooltipSide = "top", tooltipAnchorSelector, children, child, disabled, ref = $bindable(null), ...props }:
    Omit<ComponentProps<typeof Tooltip.Trigger>, "children"> & { label: string; bottomLabel?: string; labelAsName?: boolean; tooltipEnabled?: boolean; tooltipSide?: ComponentProps<typeof Tooltip.Content>["side"]; tooltipAnchorSelector?: string; children?: Snippet } = $props();
  const anchor = $derived.by(() => {
    const trigger = ref;
    const container = tooltipAnchorSelector ? trigger?.closest(tooltipAnchorSelector) : null;
    if (!trigger || !container) return null;
    return { contextElement: container, getBoundingClientRect: () => {
      // Keep the hovered row's height while clearing the whole container horizontally.
      const outer = container.getBoundingClientRect();
      const inner = trigger.getBoundingClientRect();
      return new DOMRect(outer.x, inner.y, outer.width, inner.height);
    } };
  });
  const tether = Tooltip.createTether();
  let open = $state(false);
  $effect(() => { if (!tooltipEnabled) tether.close(); });
  onMount(() => {
    const dismiss = () => tether.close();
    const navigate = (event: KeyboardEvent) => {
      // Release the tooltip's focus scope before a dialog handles Tab wrapping.
      if (event.key === "Tab" && open) flushSync(dismiss);
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("keydown", navigate, true);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("keydown", navigate, true);
    };
  });
</script>
  <Tooltip.Root {tether} bind:open disabled={tooltipEnabled ? undefined : true}>
    {#if disabled && !child}
      <Tooltip.Trigger bind:ref {...props} tabindex={-1} aria-label={props["aria-label"] ?? (labelAsName ? label : undefined)}>
        {#snippet child({ props: triggerProps })}
          <button {...triggerProps} class={[triggerProps.class, "disabled-hint-trigger"]} disabled>{@render children?.()}</button>
        {/snippet}
      </Tooltip.Trigger>
    {:else}
      <Tooltip.Trigger bind:ref {...props} {...(child ? { child } : {})} {disabled} aria-label={props["aria-label"] ?? (labelAsName ? label : undefined)}>
        {@render children?.()}
      </Tooltip.Trigger>
    {/if}
    <Tooltip.Portal><Tooltip.Content customAnchor={anchor} role={bottomLabel ? "presentation" : "tooltip"} aria-hidden={!open} class={bottomLabel ? "app-tooltip paired-tooltip" : "app-tooltip"} side={bottomLabel ? "top" : tooltipSide} sideOffset={8} collisionPadding={8}>
      {#if bottomLabel}
        <div role="tooltip" class="app-tooltip tooltip-primary" data-side="top">{label}</div>
        <div role="tooltip" class="app-tooltip tooltip-secondary" data-side="bottom">{bottomLabel}</div>
      {:else}
        {label}<Tooltip.Arrow class="tooltip-arrow" />
      {/if}
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root>

<style>
  /* Native disabled buttons can explain their state on hover without activation. */
  .disabled-hint-trigger { pointer-events: auto; }
  :global(.app-tooltip.paired-tooltip) { padding: 0; background: transparent; }
  :global(.paired-tooltip[data-side="bottom"]) { transform: translateY(calc(-100% - var(--bits-tooltip-anchor-height) - 16px)); }
  .tooltip-primary { position: relative; }
  .tooltip-secondary { position: absolute; top: calc(100% + var(--bits-tooltip-anchor-height) + 16px); left: 50%; width: max-content; transform: translateX(-50%); box-sizing: border-box; }
  .tooltip-primary::after, .tooltip-secondary::after { content: ""; position: absolute; left: calc(50% - 5px); width: 10px; height: 5px; background: var(--color-badge-background); }
  .tooltip-primary::after { top: 100%; clip-path: polygon(0 0, 100% 0, 50% 100%); }
  .tooltip-secondary::after { bottom: 100%; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
  :global(.app-tooltip) { --tooltip-x: 0px; --tooltip-y: 4px; pointer-events: none; }
  :global(.app-tooltip[data-side="bottom"]) { --tooltip-y: -4px; }
  :global(.app-tooltip[data-side="left"]) { --tooltip-x: 4px; --tooltip-y: 0px; }
  :global(.app-tooltip[data-side="right"]) { --tooltip-x: -4px; --tooltip-y: 0px; }
  @media (prefers-reduced-motion: no-preference) {
    :global(.app-tooltip[data-state="delayed-open"]), :global(.app-tooltip[data-state="instant-open"]) { animation: tooltip-in 200ms ease-in both; }
    :global(.app-tooltip[data-state="closed"]) { animation: tooltip-out 200ms ease-in 75ms both; }
  }
  @keyframes tooltip-in { from { opacity: 0; translate: var(--tooltip-x) var(--tooltip-y); } to { opacity: 1; translate: 0 0; } }
  @keyframes tooltip-out { from { opacity: 1; translate: 0 0; } to { opacity: 0; translate: var(--tooltip-x) var(--tooltip-y); } }
</style>
