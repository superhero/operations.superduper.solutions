# Bundled assets

Store binary resources imported by application code or styles here. The current
assets are local [fonts](fonts/README.md), referenced by `@font-face` declarations
in [app.css](../app.css). Preserve license notices and provenance alongside
the assets.

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
