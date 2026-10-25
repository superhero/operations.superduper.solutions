<!--
Copyright (C) 2026 Erik Landvall
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
-->
<script lang="ts">
  import { flushSync, onMount, untrack, type Snippet } from "svelte";
  import { Tooltip } from "bits-ui";
  import type { Operation } from "$lib/catalog.ts";
  import { operationCapabilityHint } from "$lib/operation-capabilities.ts";
  import Modal from "$lib/components/Modal.svelte";
  import OperationCapabilities from "$lib/components/OperationCapabilities.svelte";
  let { active, operations, revision, children }: {
    active: boolean; operations: Map<string, Operation>; revision: unknown; children: Snippet;
  } = $props();
  type Hint = { target: HTMLElement; label: string; side: "top" | "right" };
  let hint = $state<Hint | null>(null);
  let displayed = $state<Hint | null>(null);
  let open = $state(false);
  let content = $state<HTMLDivElement | null>(null);
  let detailsOpen = $state(false), detailsId = $state("");
  let detailsAnchor = $state.raw<HTMLElement>();
  let detailsFocus = $state<HTMLDivElement>();
  const details = $derived(operations.get(detailsId));
  const tooltip = Tooltip.createTether();
  const contentId = $props.id();
  function dismiss() { tooltip.close(); hint = null; }
  $effect(() => { void active; void operations; void revision; untrack(dismiss); });
  $effect(() => { if (!active || !details) detailsOpen = false; });
  $effect(() => { if (!content && !hint) displayed = null; });
  $effect(() => {
    const target = open ? hint?.target : undefined;
    if (!target) return;
    const previous = target.getAttribute("aria-describedby");
    const description = [previous, contentId].filter(Boolean).join(" ");
    target.setAttribute("aria-describedby", description);
    return () => {
      if (target.getAttribute("aria-describedby") !== description) return;
      if (previous) target.setAttribute("aria-describedby", previous);
      else target.removeAttribute("aria-describedby");
    };
  });
  function findHint(target: EventTarget | null): Hint | null {
    if (!active || !(target instanceof Element)) return null;
    const icon = target.closest<HTMLElement>(".catalog-action-icon");
    if (icon) return { target: icon, label: "Add to workflow", side: "right" };
    const row = target.closest<HTMLElement>('.catalog-operation-action[aria-disabled="true"]');
    const id = row?.closest<HTMLElement>("[data-operation-id]")?.dataset.operationId;
    const operation = id ? operations.get(id) : undefined;
    const reason = operation ? operationCapabilityHint(operation) : undefined;
    return row && reason ? { target: row, label: reason, side: "top" } : null;
  }
  function forward(props: Record<string, unknown>, name: string, event: Event) {
    const handler = props[name];
    if (typeof handler === "function") handler(event);
  }
  function update(event: PointerEvent | FocusEvent, props: Record<string, unknown>, target = event.target) {
    const blocked = props["data-disabled"] !== undefined || "pointerType" in event && event.pointerType === "touch";
    const next = blocked ? null : findHint(target);
    if (next?.target === hint?.target) return false;
    // Let the library cancel its delay/hover state before moving this one
    // trigger's anchor. Its provider still owns delay, dismissal and opt-out.
    forward(props, "onpointerleave", event);
    flushSync(() => { tooltip.close(); hint = next; if (next) displayed = next; });
    return true;
  }
  onMount(() => {
    const navigate = (event: KeyboardEvent) => { if (event.key === "Tab" && (open || hint)) flushSync(dismiss); };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("keydown", navigate, true);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("keydown", navigate, true);
    };
  });
</script>

<Tooltip.Root tether={tooltip} bind:open ignoreNonKeyboardFocus={false}>
  <Tooltip.Trigger tether={tooltip} disabled={!active}>
    {#snippet child({ props })}
      {@const { type: _type, tabindex: _tabindex, disabled: _disabled, "aria-describedby": _description, onfocus: _focus, onblur: _blur,
        onpointerenter: _enter, onpointerleave: _leave, ...triggerProps } = props}
      <div {...triggerProps} class="catalog-help-scope"
        onclick={(event) => {
          const row = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.catalog-operation-action[aria-disabled="true"]') : null;
          const id = row?.closest<HTMLElement>("[data-operation-id]")?.dataset.operationId;
          if (active && row && id && operations.has(id)) { event.preventDefault(); event.stopPropagation(); dismiss(); detailsId = id; detailsAnchor = row; detailsOpen = true; }
        }}
        onpointerover={(event) => { update(event, props); if (hint) forward(props, "onpointerenter", event); }}
        onpointermove={(event) => {
          const changed = update(event, props);
          if (hint) forward(props, changed ? "onpointerenter" : "onpointermove", event);
        }}
        onpointerout={(event) => { update(event, props, event.relatedTarget); }}
        onfocusin={(event) => {
          update(event, props);
          if (hint && event.target instanceof HTMLElement && event.target.matches(":focus-visible")) forward(props, "onfocus", event);
        }}
        onfocusout={(event) => { forward(props, "onblur", event); dismiss(); }}>
        {@render children()}
      </div>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Portal><Tooltip.Content bind:ref={content} id={contentId} customAnchor={displayed?.target ?? null} role="tooltip" aria-hidden={!open}
    class="app-tooltip" side={displayed?.side ?? "right"} sideOffset={8} collisionPadding={8}>
    <span class="capability-hint">{displayed?.label}</span><Tooltip.Arrow class="tooltip-arrow" />
  </Tooltip.Content></Tooltip.Portal>
</Tooltip.Root>
<Modal bind:open={detailsOpen} title={details ? `Requirements: ${details.name}` : "Operation requirements"}
  description="Review the operation's limitations and connection requirements."
  initialFocus={() => detailsFocus}
  onCloseAutoFocus={(event) => { if (detailsAnchor?.isConnected) { event.preventDefault(); detailsAnchor.focus(); } }}>
  <div tabindex="-1" bind:this={detailsFocus} data-capability-details>
    {#if details && (details.capabilities || details.capabilitySummary)}<OperationCapabilities operation={details} />
    {:else if details?.unavailableReason}<p>{details.unavailableReason}</p>{/if}
  </div>
</Modal>

<style>
  .catalog-help-scope { display: contents; }
  .capability-hint { white-space: pre-line; }
</style>
