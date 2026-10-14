# Bundled assets

Store artwork and resources bundled into the application here. Local
[fonts](fonts/README.md) are referenced by `@font-face` declarations in
[app.css](../app.css). Preserve license notices and provenance alongside assets.

[`favicon.svg`](favicon.svg) is original project artwork: connected workflow
nodes on an amber rounded square, using the default palette colors. Its source
notice records the project license; `index.html` references it with Vite's
explicit `?inline` option so the production favicon stays embedded in the
standalone page.

## Adding or replacing resources

Use source imports or CSS URLs so Vite can include application resources in the
standalone HTML. Keep the source, license, relevant subset or variant, and checksum
with any third-party binary. Retain applicable notices when replacing a file and
check that its declared font weights and styles match the CSS consumer.

## Neighboring responsibilities

Keep authored OpenAPI documents in [catalogs](../catalogs/README.md) and reusable
visual controls in [lib/components](../lib/components/README.md). `src/public` is
for unchanged hosting files; putting an application asset there creates a separate
distribution file instead of an embedded resource.

## Verification

After asset changes, `npm run build && npm run test:acceptance` checks the
standalone package. Verify affected text and icons in the browser when changing
fonts or glyph coverage.
