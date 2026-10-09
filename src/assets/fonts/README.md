# Fonts

Montserrat (variable Latin subset) and Rationale are bundled locally for the
interface. Their SIL Open Font License notices are included alongside the fonts.
Vite embeds these assets in the single-file build; no font service is contacted.

Material Symbols Rounded supplies the interface icons through the shared
`MaterialIcon.svelte` component. The unmodified local font has filled glyphs
(`FILL=1`), weight 400, optical size 24 and grade 0 baked in. Its complete glyph
set supports choosing additional icons without fetching a font at runtime.

- Source: [Google Fonts, Material Symbols Rounded v375](https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,1,0&display=block)
- File: `material-symbols-rounded.woff2` (459,096 bytes)
- SHA-256: `2b8339899e392ce26a96f86da3b4c581e218c4b463ee3b09d9c1431ed96da7b3`
- License: [Apache 2.0](Material-Symbols-Apache-2.0.txt)

Montserrat Latin italic (variable weights 100–900), copied unchanged from the reference on 2026-10-06. License: Montserrat-OFL.txt. SHA-256: `86589d0b59b311712c3cbaac0b94eb054ecda4be7b52d695588548e4754b3165`. Bundled in the standalone HTML.
