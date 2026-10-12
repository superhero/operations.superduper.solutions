# Sheet

Import the namespace from `$lib/components/ui/sheet/index.js` and compose
`Sheet.Root`, `Sheet.Content`, `Sheet.Title` and `Sheet.Description`.
[index.ts](index.ts) exports both short names and `Sheet*` aliases. The wrappers
use Bits UI Dialog primitives for modal behavior.

## Composition

`Root` exposes bindable `open`. `Content` provides its own portal, overlay and
close control, accepts `side` (`right` by default), and forwards dialog content
props and a bindable element ref. Use `Title` and `Description` even when their
surrounding header is visually hidden.

The current consumer is [SideNavigation.svelte](../../../../components/SideNavigation.svelte).
It coordinates focus restoration, deferred navigation and canvas isolation after
closing. Its mobile navigation styles live in [app.css](../../../../app.css);
the built-in close tooltip currently says “Close navigation.” Review that wording
when introducing another use.

## Presence and motion

Content translation and overlay opacity follow Bits presence attributes, including
interrupted transitions. Preserve `data-slot`/`data-side` hooks and the close-complete
callback timing; removing content early can release focus or graph shortcuts too
soon. Left/right transforms account for RTL, and reduced motion removes transitions.
Keep these behaviors when adapting the [owned primitive](../README.md).
