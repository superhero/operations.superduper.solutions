<script lang="ts">
	import { Dialog as SheetPrimitive } from "bits-ui";
	import { cn } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: SheetPrimitive.OverlayProps = $props();
</script>

<SheetPrimitive.Overlay
	bind:ref
	data-slot="sheet-overlay"
	class={cn(
		"fixed inset-0 z-50 bg-background/65",
		className
	)}
	{...restProps}
/>

<style>
	:global([data-slot="sheet-overlay"]) {
		opacity: 1;
		transition: opacity 200ms ease-in;
	}
	:global([data-slot="sheet-overlay"]:is([data-starting-style], [data-state="closed"])) { opacity: 0; }
	@media (prefers-reduced-motion: reduce) {
		:global([data-slot="sheet-overlay"]) { transition: none; }
	}
</style>
