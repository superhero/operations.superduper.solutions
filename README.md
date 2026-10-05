## App: [operations.superduper.solutions](https://operations.superduper.solutions)

A browser-based platform for composing OpenAPI operations into reusable workflows.

## Development status

[![Develop CI](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-develop.yml?label=Develop%20CI)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-develop.yml)
[![Coverage](.github/badges/test-coverage.svg)](https://status.operations.superduper.solutions/test-coverage.html)
[![Scenarios](.github/badges/test-scenarios.svg)](https://status.operations.superduper.solutions/test-report.html)
[![Main CI/CD](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-main.yml?label=Main%20CI%2FCD)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-main.yml)

Latest released reports: [test suites](https://status.operations.superduper.solutions/test-report.html)
and [coverage](https://status.operations.superduper.solutions/test-coverage.html).

> [!NOTE]
> This project is under active development and is currently in a pre-release state.

## Dependencies

Package badges below show the versions declared in this revision's
[package.json](package.json).

The [dependency workflow](https://github.com/superhero/operations.superduper.solutions/actions/workflows/cron-outdated.yml)
checks every existing repository branch daily at 06:00 UTC and on manual runs,
using each branch's commit at discovery time. Open a run's summary to see
outdated packages and their current, wanted, and latest versions.

<a href="https://www.npmjs.com/package/bits-ui"><img src=".github/badges/version-dependency-bits-ui.svg" alt="bits-ui declared version"></a>

Provides accessible headless UI primitives used by the generated sheet components.

---

<a href="https://www.npmjs.com/package/c8"><img src=".github/badges/version-dependency-c8.svg" alt="c8 declared version"></a>

Collects `V8` code coverage and enforces the repository's 100% coverage thresholds.

---

<a href="https://www.npmjs.com/package/cn"><img src=".github/badges/version-dependency-cn.svg" alt="cn declared version"></a>

Provides the `cn` class-name utility, re-exported from `src/lib/utils.ts`, for composing `Tailwind CSS` classes in UI components and resolving conflicting utility classes.

---

<a href="https://www.npmjs.com/package/@cucumber/cucumber"><img src=".github/badges/version-dependency-cucumber--cucumber.svg" alt="@cucumber/cucumber declared version"></a>

Runs the source and acceptance tests defined with `Gherkin` feature files and `Cucumber` step definitions.

---

<a href="https://www.npmjs.com/package/@lucide/svelte"><img src=".github/badges/version-dependency-lucide--svelte.svg" alt="@lucide/svelte declared version"></a>

Provides icons used by the application's `Svelte` UI components.

---

<a href="https://www.npmjs.com/package/multiple-cucumber-html-reporter"><img src=".github/badges/version-dependency-multiple-cucumber-html-reporter.svg" alt="multiple-cucumber-html-reporter declared version"></a>

Generates interactive `HTML` reports from `Cucumber` test runs for reviewing features, scenarios, and failures.

---

<a href="https://www.npmjs.com/package/svelte"><img src=".github/badges/version-dependency-svelte.svg" alt="svelte declared version"></a>

Application UI framework used for the app, components, and reactive state.

---

<a href="https://www.npmjs.com/package/svelte-check"><img src=".github/badges/version-dependency-svelte-check.svg" alt="svelte-check declared version"></a>

Runs `Svelte`-aware `TypeScript` and component diagnostics in CI.

---

<a href="https://www.npmjs.com/package/@sveltejs/vite-plugin-svelte"><img src=".github/badges/version-dependency-sveltejs--vite-plugin-svelte.svg" alt="@sveltejs/vite-plugin-svelte declared version"></a>

Integrates `Svelte` compilation into the `Vite` build.

---

<a href="https://www.npmjs.com/package/tailwind-merge"><img src=".github/badges/version-dependency-tailwind-merge.svg" alt="tailwind-merge declared version"></a>

Required by `tailwind-variants` in `shadcn-svelte`-generated UI components to merge `Tailwind CSS` classes and resolve conflicting utility classes.

---

<a href="https://www.npmjs.com/package/tailwind-variants"><img src=".github/badges/version-dependency-tailwind-variants.svg" alt="tailwind-variants declared version"></a>

Used by `shadcn-svelte`-generated UI components to define typed `Tailwind CSS` style variants.

---

<a href="https://www.npmjs.com/package/tailwindcss"><img src=".github/badges/version-dependency-tailwindcss.svg" alt="tailwindcss declared version"></a>

Provides the utility CSS system and project theme used by the application.

---

<a href="https://www.npmjs.com/package/@tailwindcss/vite"><img src=".github/badges/version-dependency-tailwindcss--vite.svg" alt="@tailwindcss/vite declared version"></a>

Integrates `Tailwind CSS` processing into the `Vite` build.

---

<a href="https://www.npmjs.com/package/tw-animate-css"><img src=".github/badges/version-dependency-tw-animate-css.svg" alt="tw-animate-css declared version"></a>

Provides `Tailwind CSS`-compatible animation utilities imported by the application stylesheet.

---

<a href="https://www.npmjs.com/package/typescript"><img src=".github/badges/version-dependency-typescript.svg" alt="typescript declared version"></a>

Provides the `TypeScript` compiler and type system used by `Svelte` and project source files.

---

<a href="https://www.npmjs.com/package/vite"><img src=".github/badges/version-dependency-vite.svg" alt="vite declared version"></a>

Builds the browser application and produces the production `dist` output.

---

<a href="https://www.npmjs.com/package/vite-plugin-singlefile"><img src=".github/badges/version-dependency-vite-plugin-singlefile.svg" alt="vite-plugin-singlefile declared version"></a>

Bundles the production build into a single self-contained `dist/index.html` file.

---

<a href="https://www.npmjs.com/package/@xyflow/svelte"><img src=".github/badges/version-dependency-xyflow--svelte.svg" alt="@xyflow/svelte declared version"></a>

Provides the workflow canvas, nodes, edges, handles, background, and controls.
