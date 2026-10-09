<script lang="ts" module>
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
	import { type VariantProps, tv } from "tailwind-variants";

	export const buttonVariants = tv({
		base: "focus-visible:border-ring aria-invalid:ring-invalid-ring aria-invalid:border-destructive inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap disabled:pointer-events-none aria-disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary shadow-xs",
				destructive:
					"bg-destructive text-primary-foreground hover:bg-destructive shadow-xs",
				outline:
					"bg-background hover:bg-[var(--color-secondary-hover)] hover:text-[var(--color-secondary-hover-foreground)] border-input border shadow-xs",
				secondary: "bg-secondary text-secondary-foreground hover:bg-[var(--color-secondary-hover)] hover:text-[var(--color-secondary-hover-foreground)] shadow-xs",
				ghost: "hover:bg-[var(--color-secondary-hover)] hover:text-[var(--color-secondary-hover-foreground)]",
				link: "text-accent underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-4 py-2 has-[svg]:px-3",
				sm: "h-8 gap-1.5 rounded-md px-3 has-[svg]:px-2.5",
				lg: "h-10 rounded-md px-6 has-[svg]:px-4",
				icon: "size-9",
				"icon-sm": "size-8",
				"icon-lg": "size-10",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
	export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
			tooltip?: string;
		};
</script>

<script lang="ts">
	import HintButton from "$lib/components/HintButton.svelte";
	import { mergeProps } from "bits-ui";
	let {
		class: className,
		variant = "default",
		size = "default",
		ref = $bindable(null),
		href = undefined,
		type = "button",
		disabled,
		tooltip,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#snippet control(triggerProps: Record<string, unknown> = {})}
	{#if href}
		<a
			{...mergeProps(triggerProps, restProps)}
			bind:this={ref}
			data-slot="button"
			class={cn(buttonVariants({ variant, size }), className)}
			href={disabled ? undefined : href}
			aria-disabled={disabled}
			role={disabled ? "link" : undefined}
			tabindex={disabled ? -1 : undefined}
		>
			<span class="button-content">{@render children?.()}</span>
		</a>
	{:else}
		<button
			{...mergeProps(triggerProps, restProps)}
			bind:this={ref}
			data-slot="button"
			class={cn(buttonVariants({ variant, size }), tooltip && "disabled:pointer-events-auto", className)}
			{type}
			{disabled}
		>
			<span class="button-content">{@render children?.()}</span>
		</button>
	{/if}
{/snippet}

{#if tooltip}
	<HintButton label={tooltip} labelAsName={false} {...(restProps.id ? { id: restProps.id } : {})}>
		{#snippet child({ props })}
			{@render control(props)}
		{/snippet}
	</HintButton>
{:else}
	{@render control()}
{/if}
