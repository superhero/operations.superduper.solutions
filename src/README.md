# Application source

This is Vite's source root. `index.html` provides the loading page; `index.ts`
prepares browser storage, loads settings and schemas, mounts `App.svelte`, then
starts resource recording. `bootstrap.ts` owns the small mounting boundary.
Preserve that startup order: saved workflows depend on the active schema library.

## Place a change

| Responsibility | Location |
| --- | --- |
| Application composition, startup, global styles and palette tokens | This directory |
| Workspaces and feature-specific presentation | [components](components/README.md) |
| Domain logic, persistence, workers and shared controls | [lib](lib/README.md) |
| Bundled OpenAPI examples and navigation groups | [catalogs](catalogs/README.md) |
| Imported binary resources and license notices | [assets](assets/README.md) |
| Development overlay and toolbar adapters | [dev](dev/README.md) |
| Hosting metadata copied unchanged into the release | `public` |

`WorkflowNode.svelte` is the existing operation-node renderer at this root; other
workflow presentation lives under `components/workflows`. Follow the existing
boundary when modifying it rather than assuming all node renderers are colocated.

## Build boundary

[Vite configuration](../vite.config.mjs) embeds application code, styles, fonts and
workers into `dist/index.html`. `public/_headers` supplies hosting metadata and is
copied unchanged. Files added to `public` become extra distribution files; the
acceptance and deployment checks require exactly `index.html` and `_headers`.

## Verification

Source behavior scenarios pair `*.feature` with `*.test.mjs` here. Add both paths
to the explicit `source` profile in [cucumber.config.mjs](../cucumber.config.mjs).
`build.*` belongs to the separate acceptance profile. Use `npm run test:source`
for source checks; `npm run build && npm run test:acceptance` verifies packaging.
Browser-driven coverage belongs in [tests](../tests/README.md).
