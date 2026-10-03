# [operations.superduper.solutions](https://operations.superduper.solutions)

[![Main Release Gate](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-main.yml?label=Main%20Release%20Gate)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-main.yml)
[![Develop Integration Gate](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-develop.yml?label=Develop%20Integration%20Gate)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-develop.yml)
[![Production Deployment](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-main-cd.yml?label=Production%20Deployment)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-main-cd.yml)
![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsuperhero%2Foperations.superduper.solutions%2Fdevelop%2Fcoverage.json)
[![Dependencies](https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies.json)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/dependency-status.yml)

A browser-based platform for composing OpenAPI operations into reusable workflows.

## Dependencies

<details>
<summary><a href="https://www.npmjs.com/package/bits-ui"><code>bits-ui</code></a> <sub><img src="https://img.shields.io/npm/v/bits-ui" alt="bits-ui npm version"></sub></summary>

Provides accessible headless UI primitives used by the generated sheet components.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/c8"><code>c8</code></a> <sub><img src="https://img.shields.io/npm/v/c8" alt="c8 npm version"></sub></summary>

Collects V8 code coverage and enforces the repository's 100% coverage thresholds.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/cn"><code>cn</code></a> <sub><img src="https://img.shields.io/npm/v/cn" alt="cn npm version"></sub></summary>

Provides the `cn` class-name utility, re-exported from `src/lib/utils.ts`, for composing Tailwind CSS classes in UI components and resolving conflicting utility classes.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/@cucumber/cucumber"><code>@cucumber/cucumber</code></a> <sub><img src="https://img.shields.io/npm/v/%40cucumber%2Fcucumber" alt="@cucumber/cucumber npm version"></sub></summary>

Runs the source and acceptance tests defined with Cucumber feature files and step definitions.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/@lucide/svelte"><code>@lucide/svelte</code></a> <sub><img src="https://img.shields.io/npm/v/%40lucide%2Fsvelte" alt="@lucide/svelte npm version"></sub></summary>

Provides Svelte icon components used by the menu and sheet UI.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/multiple-cucumber-html-reporter"><code>multiple-cucumber-html-reporter</code></a> <sub><img src="https://img.shields.io/npm/v/multiple-cucumber-html-reporter" alt="multiple-cucumber-html-reporter npm version"></sub></summary>

Generates interactive HTML reports from Cucumber test runs for reviewing features, scenarios, and failures.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/svelte"><code>svelte</code></a> <sub><img src="https://img.shields.io/npm/v/svelte" alt="svelte npm version"></sub></summary>

Application UI framework used for the app, components, and reactive state.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/svelte-check"><code>svelte-check</code></a> <sub><img src="https://img.shields.io/npm/v/svelte-check" alt="svelte-check npm version"></sub></summary>

Runs Svelte-aware TypeScript and component diagnostics in CI.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/@sveltejs/vite-plugin-svelte"><code>@sveltejs/vite-plugin-svelte</code></a> <sub><img src="https://img.shields.io/npm/v/%40sveltejs%2Fvite-plugin-svelte" alt="@sveltejs/vite-plugin-svelte npm version"></sub></summary>

Integrates Svelte compilation into the Vite build.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/tailwind-merge"><code>tailwind-merge</code></a> <sub><img src="https://img.shields.io/npm/v/tailwind-merge" alt="tailwind-merge npm version"></sub></summary>

Required by `tailwind-variants` in shadcn-svelte-generated UI components to merge Tailwind CSS classes and resolve conflicting utility classes.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/tailwind-variants"><code>tailwind-variants</code></a> <sub><img src="https://img.shields.io/npm/v/tailwind-variants" alt="tailwind-variants npm version"></sub></summary>

Used by shadcn-svelte-generated UI components to define typed Tailwind CSS style variants.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/tailwindcss"><code>tailwindcss</code></a> <sub><img src="https://img.shields.io/npm/v/tailwindcss" alt="tailwindcss npm version"></sub></summary>

Provides the utility CSS system and project theme used by the application.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/@tailwindcss/vite"><code>@tailwindcss/vite</code></a> <sub><img src="https://img.shields.io/npm/v/%40tailwindcss%2Fvite" alt="@tailwindcss/vite npm version"></sub></summary>

Integrates Tailwind CSS processing into the Vite build.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/tw-animate-css"><code>tw-animate-css</code></a> <sub><img src="https://img.shields.io/npm/v/tw-animate-css" alt="tw-animate-css npm version"></sub></summary>

Provides Tailwind-compatible animation utilities imported by the application stylesheet.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/typescript"><code>typescript</code></a> <sub><img src="https://img.shields.io/npm/v/typescript" alt="typescript npm version"></sub></summary>

Provides the TypeScript compiler and type system used by Svelte and project source files.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/vite"><code>vite</code></a> <sub><img src="https://img.shields.io/npm/v/vite" alt="vite npm version"></sub></summary>

Builds the browser application and produces the production `dist` output.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/vite-plugin-singlefile"><code>vite-plugin-singlefile</code></a> <sub><img src="https://img.shields.io/npm/v/vite-plugin-singlefile" alt="vite-plugin-singlefile npm version"></sub></summary>

Bundles the production build into a single self-contained `dist/index.html` file.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/@xyflow/svelte"><code>@xyflow/svelte</code></a> <sub><img src="https://img.shields.io/npm/v/%40xyflow%2Fsvelte" alt="@xyflow/svelte npm version"></sub></summary>

Provides the workflow canvas, nodes, edges, handles, background, and controls.

</details>

## Development status

This project is under active development and is currently in a pre-release state.

## License

Licensed under the **GNU Affero General Public License, version 3 only** (`AGPL-3.0-only`).

See [`LICENSE`](LICENSE) and [`LICENSE-ADDITIONAL-TERMS`](LICENSE-ADDITIONAL-TERMS).

Third-party dependencies retain their respective licenses.
