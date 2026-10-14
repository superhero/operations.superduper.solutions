# Bundled assets

Store artwork and resources bundled into the application here. Local
[fonts](fonts/README.md) are referenced by `@font-face` declarations in
[app.css](../app.css). Preserve license notices and provenance alongside assets.

[`favicon.svg`](favicon.svg) is original project artwork representing connected
API schemas: one square on the left connects to two squares on the right. The navy geometry sits
on an amber rounded square, using the default palette colors. Its source notice
records the project license; `index.html` references it with Vite's
explicit `?inline` option so the production favicon stays embedded in the
standalone page.

`npm run icons:generate` derives the checked-in compatibility files under
`src/public` from this SVG using the pinned Sharp version. `npm run icons:check`
verifies byte-for-byte freshness without writing; `npm run build` runs it first.
The ICO contains 16, 32 and 48 pixel BMP/DIB images; general raster exports are
96 pixels square, and the Apple touch PNG is 180 pixels square. PNG, BMP, GIF,
JPEG, PPM and TIFF exports preserve the same original artwork. Only ICO, PNG
and Apple touch fallbacks are declared in the page; the other formats are
compatibility downloads. There is no web manifest or installable PWA.

The SVG's title, creator and license notice are also carried in PNG, JPEG and
TIFF XMP fields, and in GIF/PPM comments. BMP and ICO retain only technical image
metadata. See [build tooling](../../build/README.md#image-metadata) for details.

## Adding or replacing resources

Use source imports or CSS URLs so Vite can include application resources in the
standalone HTML. Keep the source, license, relevant subset or variant, and checksum
with any third-party binary. Retain applicable notices when replacing a file and
check that its declared font weights and styles match the CSS consumer.

## Neighboring responsibilities

Keep authored OpenAPI documents in [catalogs](../catalogs/README.md) and reusable
visual controls in [lib/components](../lib/components/README.md). `src/public`
contains unchanged hosting metadata and generated favicon compatibility files.
Other application resources still use Vite imports to remain embedded.

## Verification

After asset changes, `npm run build && npm run test:acceptance` checks the
standalone package. Verify affected text and icons in the browser when changing
fonts or glyph coverage.
