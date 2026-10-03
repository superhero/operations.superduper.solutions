# [operations.superduper.solutions](https://operations.superduper.solutions)

[![Main Release Gate](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-main.yml?label=Main%20Release%20Gate)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-main.yml)
[![Develop Integration Gate](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-develop.yml?label=Develop%20Integration%20Gate)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-develop.yml)
[![Production Deployment](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-main-cd.yml?label=Production%20Deployment)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-main-cd.yml)
![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsuperhero%2Foperations.superduper.solutions%2Fdevelop%2Fcoverage.json)
[![Dependencies](https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies.json)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/dependency-status.yml)

A browser-based platform for composing OpenAPI operations into reusable workflows.

## Dependencies

<details>
<summary><a href="https://www.npmjs.com/package/bits-ui"><code>bits-ui</code></a> <code>2.14.4</code></summary>

Provides accessible headless UI primitives used by the generated sheet components.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/c8"><code>c8</code></a> <code>12.0.0</code></summary>

Collects V8 code coverage and enforces the repository's 100% coverage thresholds.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/cn"><code>cn</code></a> <code>0.3.0</code></summary>

Provides the `cn` class-name utility, re-exported from `src/lib/utils.ts`, for composing Tailwind CSS classes in UI components and resolving conflicting utility classes.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/@cucumber/cucumber"><code>@cucumber/cucumber</code></a> <code>13.2.1</code></summary>

Runs the source and acceptance tests defined with Cucumber feature files and step definitions.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/jsdom"><code>jsdom</code></a> <code>30.1.1</code></summary>

Provides the DOM environment used by source tests without a browser.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/@lucide/svelte"><code>@lucide/svelte</code></a> <code>0.562.0</code></summary>

Provides Svelte icon components used by the menu and sheet UI.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/multiple-cucumber-html-reporter"><code>multiple-cucumber-html-reporter</code></a> <code>4.3.0</code></summary>

Generates interactive HTML reports from Cucumber test runs for reviewing features, scenarios, and failures.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/svelte"><code>svelte</code></a> <code>5.57.1</code></summary>

Application UI framework used for the app, components, and reactive state.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/svelte-check"><code>svelte-check</code></a> <code>4.7.6</code></summary>

Runs Svelte-aware TypeScript and component diagnostics in CI.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/@sveltejs/vite-plugin-svelte"><code>@sveltejs/vite-plugin-svelte</code></a> <code>7.3.1</code></summary>

Integrates Svelte compilation into the Vite build.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/tailwind-merge"><code>tailwind-merge</code></a> <code>3.7.0</code></summary>

Required by `tailwind-variants` in shadcn-svelte-generated UI components to merge Tailwind CSS classes and resolve conflicting utility classes.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/tailwind-variants"><code>tailwind-variants</code></a> <code>3.2.2</code></summary>

Used by shadcn-svelte-generated UI components to define typed Tailwind CSS style variants.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/tailwindcss"><code>tailwindcss</code></a> <code>4.3.3</code></summary>

Provides the utility CSS system and project theme used by the application.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/@tailwindcss/vite"><code>@tailwindcss/vite</code></a> <code>4.3.3</code></summary>

Integrates Tailwind CSS processing into the Vite build.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/tw-animate-css"><code>tw-animate-css</code></a> <code>1.4.0</code></summary>

Provides Tailwind-compatible animation utilities imported by the application stylesheet.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/typescript"><code>typescript</code></a> <code>6.0.3</code></summary>

Provides the TypeScript compiler and type system used by Svelte and project source files.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/vite"><code>vite</code></a> <code>8.3.2</code></summary>

Builds the browser application and produces the production `dist` output.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/vite-plugin-singlefile"><code>vite-plugin-singlefile</code></a> <code>2.3.3</code></summary>

Bundles the production build into a single self-contained `dist/index.html` file.

</details>

<details>
<summary><a href="https://www.npmjs.com/package/@xyflow/svelte"><code>@xyflow/svelte</code></a> <code>1.6.3</code></summary>

Provides the workflow canvas, nodes, edges, handles, background, and controls.

</details>

## Development status

This project is under active development and is currently in a pre-release state.

## License

Licensed under the **GNU Affero General Public License, version 3 only** (`AGPL-3.0-only`).

See [`LICENSE`](LICENSE) and [`LICENSE-ADDITIONAL-TERMS`](LICENSE-ADDITIONAL-TERMS).

Third-party dependencies retain their respective licenses.
