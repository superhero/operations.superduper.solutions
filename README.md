# [operations.superduper.solutions](https://operations.superduper.solutions)

[![Main Release Gate](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-main.yml?label=Main%20Release%20Gate)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-main.yml)
[![Develop Integration Gate](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-develop.yml?label=Develop%20Integration%20Gate)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-develop.yml)
[![Production Deployment](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-main-cd.yml?label=Production%20Deployment)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-main-cd.yml)
![Coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fsuperhero%2Foperations.superduper.solutions%2Fdevelop%2Fcoverage.json)
[![Dependencies](https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies.json)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/dependency-status.yml)

A browser-based platform for composing OpenAPI operations into reusable workflows.

## Dependencies

<ul>
  <li>
    <sub><a href="https://www.npmjs.com/package/bits-ui"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Fbits-ui.json%3Fv%3D3&cacheSeconds=300" alt="bits-ui version status"></a></sub>
    <ul>
      <li>Provides accessible headless UI primitives used by the generated sheet components.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/c8"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Fc8.json%3Fv%3D3&cacheSeconds=300" alt="c8 version status"></a></sub>
    <ul>
      <li>Collects V8 code coverage and enforces the repository's 100% coverage thresholds.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/cn"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Fcn.json%3Fv%3D3&cacheSeconds=300" alt="cn version status"></a></sub>
    <ul>
      <li>Provides the `cn` class-name utility, re-exported from `src/lib/utils.ts`, for composing Tailwind CSS classes in UI components and resolving conflicting utility classes.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/@cucumber/cucumber"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Fcucumber--cucumber.json%3Fv%3D3&cacheSeconds=300" alt="@cucumber/cucumber version status"></a></sub>
    <ul>
      <li>Runs the source and acceptance tests defined with Cucumber feature files and step definitions.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/@lucide/svelte"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Flucide--svelte.json%3Fv%3D3&cacheSeconds=300" alt="@lucide/svelte version status"></a></sub>
    <ul>
      <li>Provides Svelte icon components used by the menu and sheet UI.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/multiple-cucumber-html-reporter"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Fmultiple-cucumber-html-reporter.json%3Fv%3D3&cacheSeconds=300" alt="multiple-cucumber-html-reporter version status"></a></sub>
    <ul>
      <li>Generates interactive HTML reports from Cucumber test runs for reviewing features, scenarios, and failures.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/svelte"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Fsvelte.json%3Fv%3D3&cacheSeconds=300" alt="svelte version status"></a></sub>
    <ul>
      <li>Application UI framework used for the app, components, and reactive state.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/svelte-check"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Fsvelte-check.json%3Fv%3D3&cacheSeconds=300" alt="svelte-check version status"></a></sub>
    <ul>
      <li>Runs Svelte-aware TypeScript and component diagnostics in CI.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/@sveltejs/vite-plugin-svelte"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Fsveltejs--vite-plugin-svelte.json%3Fv%3D3&cacheSeconds=300" alt="@sveltejs/vite-plugin-svelte version status"></a></sub>
    <ul>
      <li>Integrates Svelte compilation into the Vite build.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/tailwind-merge"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Ftailwind-merge.json%3Fv%3D3&cacheSeconds=300" alt="tailwind-merge version status"></a></sub>
    <ul>
      <li>Required by `tailwind-variants` in shadcn-svelte-generated UI components to merge Tailwind CSS classes and resolve conflicting utility classes.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/tailwind-variants"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Ftailwind-variants.json%3Fv%3D3&cacheSeconds=300" alt="tailwind-variants version status"></a></sub>
    <ul>
      <li>Used by shadcn-svelte-generated UI components to define typed Tailwind CSS style variants.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/tailwindcss"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Ftailwindcss.json%3Fv%3D3&cacheSeconds=300" alt="tailwindcss version status"></a></sub>
    <ul>
      <li>Provides the utility CSS system and project theme used by the application.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/@tailwindcss/vite"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Ftailwindcss--vite.json%3Fv%3D3&cacheSeconds=300" alt="@tailwindcss/vite version status"></a></sub>
    <ul>
      <li>Integrates Tailwind CSS processing into the Vite build.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/tw-animate-css"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Ftw-animate-css.json%3Fv%3D3&cacheSeconds=300" alt="tw-animate-css version status"></a></sub>
    <ul>
      <li>Provides Tailwind-compatible animation utilities imported by the application stylesheet.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/typescript"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Ftypescript.json%3Fv%3D3&cacheSeconds=300" alt="typescript version status"></a></sub>
    <ul>
      <li>Provides the TypeScript compiler and type system used by Svelte and project source files.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/vite"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Fvite.json%3Fv%3D3&cacheSeconds=300" alt="vite version status"></a></sub>
    <ul>
      <li>Builds the browser application and produces the production `dist` output.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/vite-plugin-singlefile"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Fvite-plugin-singlefile.json%3Fv%3D3&cacheSeconds=300" alt="vite-plugin-singlefile version status"></a></sub>
    <ul>
      <li>Bundles the production build into a single self-contained `dist/index.html` file.</li>
    </ul>
  </li>
  <li>
    <sub><a href="https://www.npmjs.com/package/@xyflow/svelte"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Foperations-superduper-badges.pages.dev%2Fdependencies%2Fxyflow--svelte.json%3Fv%3D3&cacheSeconds=300" alt="@xyflow/svelte version status"></a></sub>
    <ul>
      <li>Provides the workflow canvas, nodes, edges, handles, background, and controls.</li>
    </ul>
  </li>
</ul>

## Development status

This project is under active development and is currently in a pre-release state.

## License

Licensed under the **GNU Affero General Public License, version 3 only** (`AGPL-3.0-only`).

See [`LICENSE`](LICENSE) and [`LICENSE-ADDITIONAL-TERMS`](LICENSE-ADDITIONAL-TERMS).

Third-party dependencies retain their respective licenses.
