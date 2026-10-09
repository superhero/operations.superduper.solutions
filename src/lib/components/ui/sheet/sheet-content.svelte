<script lang="ts" module>
	import { tv, type VariantProps } from "tailwind-variants";
	export const sheetVariants = tv({
		base: "bg-background border-border fixed z-50 flex flex-col gap-4 shadow-lg",
		variants: {
			side: {
				top: "inset-x-0 top-0 h-auto border-b",
				bottom: "inset-x-0 bottom-0 h-auto border-t",
				left: "inset-y-0 start-0 h-full w-3/4 border-e sm:max-w-sm",
				right: "inset-y-0 end-0 h-full w-3/4 border-s sm:max-w-sm",
			},
		},
		defaultVariants: {
			side: "right",
		},
	});

	export type Side = VariantProps<typeof sheetVariants>["side"];
</script>

<script lang="ts">
	import { Dialog as SheetPrimitive, mergeProps } from "bits-ui";
	import HintButton from "$lib/components/HintButton.svelte";
	import MaterialIcon from "$lib/components/MaterialIcon.svelte";
	import type { Snippet } from "svelte";
	import SheetPortal from "./sheet-portal.svelte";
	import SheetOverlay from "./sheet-overlay.svelte";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		side = "right",
		portalProps,
		children,
		...restProps
	}: WithoutChildrenOrChild<SheetPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof SheetPortal>>;
		side?: Side;
		children: Snippet;
	} = $props();
</script>

<SheetPortal {...portalProps}>
	<SheetOverlay />
	<SheetPrimitive.Content
		bind:ref
		data-slot="sheet-content"
		data-side={side}
		class={cn(sheetVariants({ side }), className)}
		{...restProps}
	>
		{@render children?.()}
		<SheetPrimitive.Close>
			{#snippet child({ props: closeProps })}
				<HintButton label="Close navigation" aria-label="Close">
					{#snippet child({ props: hintProps })}
						<button {...mergeProps(closeProps, hintProps)}
							class="ring-offset-background focus-visible:ring-ring text-muted-foreground hover:text-foreground absolute end-4 top-4 rounded-xs transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none">
							<MaterialIcon name="close" size={16} />
							<span class="sr-only">Close</span>
						</button>
					{/snippet}
				</HintButton>
			{/snippet}
		</SheetPrimitive.Close>
	</SheetPrimitive.Content>
</SheetPortal>

<style>
	/* Bits presence waits for this transition, including interrupted reversals. */
	:global([data-slot="sheet-content"]) {
		transform: translate(0, 0);
		transition: transform 200ms ease-in;
	}
	:global([data-slot="sheet-content"][data-side="top"]) { --sheet-hidden-transform: translateY(-100%); }
	:global([data-slot="sheet-content"][data-side="bottom"]) { --sheet-hidden-transform: translateY(100%); }
	:global([data-slot="sheet-content"][data-side="left"]) { --sheet-hidden-transform: translateX(-100%); }
	:global([data-slot="sheet-content"][data-side="right"]) { --sheet-hidden-transform: translateX(100%); }
	:global([data-slot="sheet-content"][data-side="left"]:dir(rtl)) { --sheet-hidden-transform: translateX(100%); }
	:global([data-slot="sheet-content"][data-side="right"]:dir(rtl)) { --sheet-hidden-transform: translateX(-100%); }
	:global([data-slot="sheet-content"]:is([data-starting-style], [data-state="closed"])) {
		transform: var(--sheet-hidden-transform);
	}
	@media (prefers-reduced-motion: reduce) {
		:global([data-slot="sheet-content"]) { transition: none; }
	}
</style>
