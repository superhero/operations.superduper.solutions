# Custom cursors

## Responsibility

`cursor-artwork.ts` holds self-contained SVG templates, dimensions and hotspots.
`cursor-theme.ts` renders them with the resolved foreground/background colors
and applies inherited `--cursor-*` values. No image requests, pointer tracking
or reference checkout are needed. Theme's **Custom cursors** setting is enabled
by default; disabling removes these values and restores native CSS fallbacks.

Call `syncCursorTheme` after applying appearance settings. Rendering is cached
per root and palette; invalid colors retain native cursors and report an error.
Only foreground/outline placeholders change. Masks, geometry and the light-mode
hand weight remain intact. Do not apply a universal cursor or replace native
`auto`, drag/drop feedback, text selection or textarea resize grips.

## Artwork

| Role | Design | Size | Hotspot |
| --- | --- | --- | --- |
| Default | Arrow selector | 24 × 24 | 6, 3 |
| Pointer | Touch app | 24 × 24 | 9, 5 |
| Grab / grabbing | Open / closed hand | 24 × 24 | 12, 12 |
| Not allowed | Arrow with hollow prohibition badge | 32 × 32 | 6, 3 |
| Text | I-beam | 24 × 24 | 12, 12 |
| Horizontal / vertical resize | Axis arrows | 24 × 24 | 12, 12 |
| Crosshair | Precision crosshair | 24 × 24 | 12, 12 |

Connection ring, selection plus and four-way movement templates are retained
for future use. Their presence does not add interaction states. Current eligible
connection handles use the precision crosshair; locked/structural ports keep
their existing cursor behavior.

## Provenance and licensing

Adapted from `laya-ai/public/icons/` at reference revision
`1df20ea1d4ff6c64b68dd737aa2c05aab7111f2c`. That project's
`public/fonts/README.md` records the source artwork.

Arrow Selector Tool, Touch App, Pan Tool, Circle Circle, Drag Pan and Add 2
derive from [Google Material Symbols Rounded](https://github.com/google/material-design-icons/tree/master/symbols/web)
under [Apache 2.0](LICENSE-APACHE-2.0). Adaptations include contrast outlines,
Touch App's removed halo, hand weights, and a smaller connection ring.
The closed hand is custom reference artwork without a separate source license
notice; it is not a Google glyph.

The I-beam, axis arrows, precision crosshair and redesigned prohibition badge
are original project artwork under AGPL-3.0-only with the project's additional
terms. The prohibition composite retains the Apache-licensed arrow, its mask
and hotspot. Preserve both license records when changing or copying templates.

## Verification

Source Cucumber scenarios cover rendering, palette validation, caching, masks
and cleanup. Browser scenarios cover settings, persistence, cursor states and
native fallbacks. OS-managed cursor presentation still needs manual review on
the target platform; computed CSS alone cannot prove its final appearance.
