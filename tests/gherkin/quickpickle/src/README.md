# Runner source

## Registration and transformation

`index.mjs` exposes the package and Vite plugin. `render.mjs` turns feature
documents into Vitest registrations, source maps and canonical case metadata.
`steps.mjs` matches expressions; `tags.mjs` handles tag selection.

## Ownership and diagnostics

`runtime.mjs` owns each World, deadlines, abort/drain and cleanup completion.
`hooks.mjs` orders callbacks and continues cleanup after failures.
`diagnostics.mjs` preserves nested native errors across reporter boundaries.

## Compatibility

`world.mjs`, `models` and `shims` retain upstream's public helpers. Keep matching
`.d.mts` declarations beside runtime modules. Preserve upstream attribution and
update the package/cache identity when changing execution contracts.
