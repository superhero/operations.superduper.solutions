# Build tooling

`favicons.mjs` derives browser compatibility icons from the canonical artwork in
`src/assets/favicon.svg`. The implementation is shared with Code; each project
owns its own artwork and checked-in outputs under `src/public`.

Run `npm run icons:generate` after changing the SVG or reviewing a Sharp upgrade.
Run `npm run icons:check` to verify output bytes without writing. The normal
build checks freshness before Vite packages the application. Keep the pinned
Node.js, npm and Sharp versions so generated output is reproducible.

The generated set is `favicon.svg`, `favicon.ico`, `favicon.png`, `favicon.bmp`,
`favicon.gif`, `favicon.jpg`, `favicon.ppm`, `favicon.tiff` and
`apple-touch-icon.png`. The ICO has 16/32/48 pixel BMP/DIB entries, the general
rasters are 96 pixels square, and the Apple touch PNG is 180 pixels square.
The SVG remains embedded in the application HTML and also has a hosted export.

## Image metadata

The SVG title and copyright/license comment are the source for exported metadata.
PNG (including the Apple touch icon), JPEG and TIFF carry XMP title, creator and
rights fields. GIF and PPM carry equivalent comments, with an ASCII hyphen in
place of the title's em dash. BMP and DIB-based ICO have no standard descriptive
fields, so their bytes remain image-only. Metadata contains no build timestamps.

## Release contract

Any change to this finite set must update application acceptance, browser asset
serving, deployment validation and complete-bundle hashing together. Arbitrary
extra files, directories and symlinks remain unsupported.
