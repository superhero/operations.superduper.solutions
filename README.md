## Webpage: [operations.superduper.solutions](https://operations.superduper.solutions)

A browser-based platform for composing OpenAPI operations into reusable workflows.

> [!NOTE]
> This project is under active development and is currently in a pre-release state.

## npm commands

<details>
<summary><code>npm ci</code></summary>

- **Purpose:** Install locked dependencies.
- **Requirements:** Use the Node.js and npm versions declared in [`package.json`](package.json).

</details>

<details>
<summary><code>npm run badges:coverage</code></summary>

- **Purpose:** Generate the source-coverage badge under `tmp/test/badges`.
- **Requirements:** Requires Bash, jq and a fresh `npm run test:source:coverage` followed by
  `npm run test:coverage`.

</details>

<details>
<summary><code>npm run badges:dependencies</code></summary>

- **Purpose:** Update dependency-version badges.
- **Requirements:** Requires Bash, jq and current dependency versions in `package.json`.

</details>

<details>
<summary><code>npm run badges:scenarios</code></summary>

- **Purpose:** Generate the test-scenario badge under `tmp/test/badges`.
- **Requirements:** Requires Bash, jq and fresh, complete results from all four test suites.

</details>

<details>
<summary><code>npm run build</code></summary>

- **Purpose:** Verify favicon freshness and build the embedded application,
  hosting headers and browser icon compatibility files in `dist`.
- **Requirements:** Run `npm ci` first.

</details>

<details>
<summary><code>npm run dev</code></summary>

- **Purpose:** Start the local development server.
- **Requirements:** Run `npm ci` first.
- **Guidance:** [Diagnostics and error reporting](docs/adr/error-view.md),
  and [startup progress and loading preview](docs/adr/dedicated-workers.md#startup-progress).

</details>

<details>
<summary><code>npm run icons:generate</code> / <code>npm run icons:check</code></summary>

- **Purpose:** Generate favicon compatibility files from the original SVG, or
  check their byte-for-byte freshness without writing.
- **Requirements:** Run `npm ci` first and use the pinned Node.js/npm versions.
- **Guidance:** [Bundled assets](src/assets/README.md).

</details>

<details>
<summary><code>npm run report:coverage</code></summary>

- **Purpose:** Package the generated coverage report into the standalone `tmp/test-coverage.html`.
- **Requirements:** Run `npm ci`, `npm run test:source:coverage` and `npm run test:coverage` first.

</details>

<details>
<summary><code>npm run report:tests</code></summary>

- **Purpose:** Generate the combined `tmp/test-report.html`.
- **Requirements:** Run `npm ci` first. Fresh, complete results from all four test suites are required.

</details>

<details>
<summary><code>npm run test:acceptance</code></summary>

- **Purpose:** Check the built output.
- **Requirements:** Run `npm ci` and `npm run build` first.

</details>

<details>
<summary><code>npm run test:acceptance:coverage</code></summary>

- **Purpose:** Run acceptance scenarios and collect coverage data.
- **Requirements:** Run `npm ci` and `npm run build` first.

</details>

<details>
<summary><code>npm run test:automation</code></summary>

- **Purpose:** Check repository automation without deploying.
- **Requirements:** Run `npm ci` first. Bash, Git and jq are required.

</details>

<details>
<summary><code>npm run test:browser</code></summary>

- **Purpose:** Run browser scenarios in Chromium.
- **Requirements:** Run `npm ci` and `npm run build` first. Bash and running Docker are required.

</details>

<details>
<summary><code>npm run test:coverage</code></summary>

- **Purpose:** Generate reports in `tmp/test/coverage/` and enforce 100% statement, branch,
  function and line coverage.
- **Scope:** Node-executable application logic; see [Testing, coverage and reporting](docs/adr/test-suite-reports.md)
  for the scope and exclusions.
- **Requirements:** Collect fresh coverage with `npm run test:source:coverage` first.

</details>

<details>
<summary><code>npm run test:source</code></summary>

- **Purpose:** Run all source behavior and unit scenarios through Cucumber,
  recording each result in `tmp/test/cucumber-source.json`.
- **Requirements:** Run `npm ci` first.

</details>

<details>
<summary><code>npm run test:source:coverage</code></summary>

- **Purpose:** Run all source Cucumber scenarios and collect coverage data.
- **Requirements:** Run `npm ci` first.

</details>

<details>
<summary><code>npm run typecheck</code></summary>

- **Purpose:** Check Svelte components and TypeScript source.
- **Requirements:** Run `npm ci` first.

</details>

<details>
<summary><code>npm test</code></summary>

- **Purpose:** Run the acceptance suite only; alias for `npm run test:acceptance`.
- **Requirements:** Run `npm ci` and `npm run build` first.

</details>

## Development status

[![Main CI/CD](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-main.yml?label=Main%20CI%2FCD)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-main.yml)

Creates releases from `develop` and validates and previews release and hotfix
pull requests before merging into `main`. Continues in the same release run to
tag and deploy, publish test and coverage reports, and synchronize released
changes back to `develop`.

---

[![Develop CI](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-develop.yml?label=Develop%20CI)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-develop.yml)

Checks branch policy, script linting, types and build output before merging into
`develop`, then updates the development preview. Test suites run on `develop`
only through the manual **test-develop** workflow; release candidates run them
automatically before release.

## Quality Assurance

Badges and linked reports describe the latest successfully published release.

[![Test Scenarios](https://status.operations.superduper.solutions/badges/test-scenarios.svg)](https://status.operations.superduper.solutions/test-report.html)

Test coverage of the application behavior, build output, and release automation,
showing which expected outcomes are verified and which scenarios fail, with
details to help investigate regressions.

---

[![Test Coverage](https://status.operations.superduper.solutions/badges/test-coverage.svg)](https://status.operations.superduper.solutions/test-coverage.html)

Code coverage of the measured application source, showing which statements,
branches, functions, and lines are exercised by tests and where additional
tests are needed.

## Dependency packages

<a href="https://www.npmjs.com/package/bits-ui"><img src=".github/badges/version-dependency-bits-ui.svg" alt="bits-ui declared version"></a>

Provides accessible dialog, select, popover, and tooltip primitives used by the
webpage’s shared controls and `shadcn-svelte` sheet components.

---

<a href="https://www.npmjs.com/package/buffer"><img src=".github/badges/version-dependency-buffer.svg" alt="buffer declared version"></a>

Provides the Node.js `Buffer` API that `isomorphic-git` needs to read and write
binary Git data in the browser. LightningFS stores the resulting repository
files locally in IndexedDB.

---

<a href="https://www.npmjs.com/package/c8"><img src=".github/badges/version-dependency-c8.svg" alt="c8 declared version"></a>

Supports application testing by measuring source code coverage and generating
coverage reports. The release workflow uses its coverage checks to enforce
requirements and block releases that leave measured code untested.

---

<a href="https://www.npmjs.com/package/cn"><img src=".github/badges/version-dependency-cn.svg" alt="cn declared version"></a>

Supports the webpage’s UI styling, combining default and custom `Tailwind CSS`
classes in `shadcn-svelte` components and resolving conflicts.

---

<a href="https://www.npmjs.com/package/@cucumber/cucumber"><img src=".github/badges/version-dependency-cucumber--cucumber.svg" alt="@cucumber/cucumber declared version"></a>

Supports application and CI validation by running source, acceptance, browser,
and automation scenarios defined in `Gherkin`, producing the results used by the
combined test report.

---

<a href="https://www.npmjs.com/package/hash-wasm"><img src=".github/badges/version-dependency-hash-wasm.svg" alt="hash-wasm declared version"></a>

Derives password wrapping keys with Argon2id inside the dedicated secrets
worker. Web Crypto encrypts the browser-local vault; the password and derived
key are never persisted.

---

<a href="https://www.npmjs.com/package/idb"><img src=".github/badges/version-dependency-idb.svg" alt="idb declared version"></a>

Provides promise-based IndexedDB access for settings, workflow and schema
catalogues, storage inspection, and database migrations.

---

<a href="https://www.npmjs.com/package/isomorphic-git"><img src=".github/badges/version-dependency-isomorphic-git.svg" alt="isomorphic-git declared version"></a>

Creates and reads local Git history for workflows, uploaded schemas, and recorded
resource metrics, using the LightningFS filesystem. Each workflow and uploaded
schema has its own repository.

---

<a href="https://www.npmjs.com/package/@isomorphic-git/lightning-fs"><img src=".github/badges/version-dependency-isomorphic-git--lightning-fs.svg" alt="@isomorphic-git/lightning-fs declared version"></a>

Provides the IndexedDB-backed filesystem that stores repository working files
and Git metadata in the browser.

---

<a href="https://www.npmjs.com/package/@lucide/svelte"><img src=".github/badges/version-dependency-lucide--svelte.svg" alt="@lucide/svelte declared version"></a>

Retained for optional SVG icons in Svelte components. The main interface uses
locally bundled, filled Material Symbols Rounded, documented with their license
in [`src/assets/fonts`](src/assets/fonts/README.md).

---

<a href="https://www.npmjs.com/package/@visulima/dev-toolbar"><img src=".github/badges/version-dependency-visulima--dev-toolbar.svg" alt="@visulima/dev-toolbar declared version"></a>

Provides the optional development toolbar with timing, performance, and Vite
configuration panels. It is excluded from production builds.

---

<a href="https://www.npmjs.com/package/@visulima/inspector"><img src=".github/badges/version-dependency-visulima--inspector.svg" alt="@visulima/inspector declared version"></a>

Formats object details when normalizing development runtime errors.

---

<a href="https://www.npmjs.com/package/@visulima/pail"><img src=".github/badges/version-dependency-visulima--pail.svg" alt="@visulima/pail declared version"></a>

Provides scoped logging for the application, workers, development server, scripts,
and tests. The browser reporter preserves native errors and forwards application
errors to the development overlay.

---

<a href="https://www.npmjs.com/package/@visulima/vite-overlay"><img src=".github/badges/version-dependency-visulima--vite-overlay.svg" alt="@visulima/vite-overlay declared version"></a>

Displays themed development errors with source frames and their cause chains.

---

<a href="https://www.npmjs.com/package/multiple-cucumber-html-reporter"><img src=".github/badges/version-dependency-multiple-cucumber-html-reporter.svg" alt="multiple-cucumber-html-reporter declared version"></a>

Supports release quality review by generating the combined test report from
source, acceptance, browser, and automation results, with scenario outcomes and failure
details.

---

<a href="https://www.npmjs.com/package/papaparse"><img src=".github/badges/version-dependency-papaparse.svg" alt="papaparse declared version"></a>
<a href="https://www.npmjs.com/package/@types/papaparse"><img src=".github/badges/version-dependency-types--papaparse.svg" alt="@types/papaparse declared version"></a>

Parses uploaded CSV data in a dedicated worker, supporting delimiter detection,
quoted multiline cells and configurable headers. `@types/papaparse` supplies its
TypeScript definitions during development.

---

<a href="https://www.npmjs.com/package/@playwright/test"><img src=".github/badges/version-dependency-playwright--test.svg" alt="@playwright/test declared version"></a>

Checks the webpage in Chromium through Cucumber scenarios, using Playwright's
browser controls and assertions to verify user interactions and responsive
layout. Captures screenshots and traces to explain browser test failures.

---

<a href="https://www.npmjs.com/package/sharp"><img src=".github/badges/version-dependency-sharp.svg" alt="sharp declared version"></a>

Generates checked-in favicon compatibility files from the original SVG during
development. It is build tooling and is not included in the browser application.

---

<a href="https://www.npmjs.com/package/svelte"><img src=".github/badges/version-dependency-svelte.svg" alt="svelte declared version"></a>

Provides the webpage’s component framework and reactive state, supporting the
workflow editor, navigation, and shared UI components.

---

<a href="https://www.npmjs.com/package/svelte-check"><img src=".github/badges/version-dependency-svelte-check.svg" alt="svelte-check declared version"></a>

Checks the webpage’s `Svelte` components and `TypeScript` source for errors,
allowing the integration and release workflows to catch type and component
problems before building.

---

<a href="https://www.npmjs.com/package/@sveltejs/vite-plugin-svelte"><img src=".github/badges/version-dependency-sveltejs--vite-plugin-svelte.svg" alt="@sveltejs/vite-plugin-svelte declared version"></a>

Connects the webpage’s `Svelte` components to the `Vite` build, compiling the
workflow editor, navigation, and controls into browser JavaScript and CSS.

---

<a href="https://www.npmjs.com/package/tailwind-variants"><img src=".github/badges/version-dependency-tailwind-variants.svg" alt="tailwind-variants declared version"></a>

Defines the webpage’s reusable component styles through its `shadcn-svelte`
button and sheet components, providing typed variants for button appearance,
size, and sheet placement.

---

<a href="https://www.npmjs.com/package/tailwindcss"><img src=".github/badges/version-dependency-tailwindcss.svg" alt="tailwindcss declared version"></a>

Provides the webpage’s utility classes and shared theme tokens, used by its
`shadcn-svelte` components for layout, styling, colors, and corner radii.

---

<a href="https://www.npmjs.com/package/@tailwindcss/vite"><img src=".github/badges/version-dependency-tailwindcss--vite.svg" alt="@tailwindcss/vite declared version"></a>

Integrates the webpage’s `Tailwind CSS` styles with the `Vite` build, generating
the utilities and theme styles used by its buttons and navigation sheet.

---

<a href="https://www.npmjs.com/package/tw-animate-css"><img src=".github/badges/version-dependency-tw-animate-css.svg" alt="tw-animate-css declared version"></a>

Supports motion in the webpage’s `shadcn-svelte` navigation sheet, providing the
slide and fade animations used when the panel and its overlay open and close.

---

<a href="https://www.npmjs.com/package/typescript"><img src=".github/badges/version-dependency-typescript.svg" alt="typescript declared version"></a>

Provides the type system used by the webpage’s application code and `Svelte`
components, with `svelte-check` validating workflow data, connections, and
component properties before integration or release.

> [!NOTE]
> The upgrade to TypeScript 7 is pending compatibility support by the `svelte-check` package.
> The badge below tracks the upstream issue’s status and links to progress updates.
>
> [![Status of upstream TypeScript 7 issue #3063](https://img.shields.io/github/issues/detail/state/sveltejs/language-tools/3063?label=upstream%20issue%20%233063)](https://github.com/sveltejs/language-tools/issues/3063)

---

<a href="https://www.npmjs.com/package/vite"><img src=".github/badges/version-dependency-vite.svg" alt="vite declared version"></a>

Builds the webpage for deployment by combining application code, `Svelte`
components, and styles. Coordinates the `Svelte`, `Tailwind CSS`, and single-file
plugins used to produce the release build.

---

<a href="https://www.npmjs.com/package/vite-plugin-singlefile"><img src=".github/badges/version-dependency-vite-plugin-singlefile.svg" alt="vite-plugin-singlefile declared version"></a>

Packages the webpage for deployment as one HTML file with embedded JavaScript
and CSS. The bundle also includes Cloudflare Pages `_headers` and nine favicon
compatibility files; acceptance and deployment checks verify this exact set.

---

<a href="https://www.npmjs.com/package/@xyflow/svelte"><img src=".github/badges/version-dependency-xyflow--svelte.svg" alt="@xyflow/svelte declared version"></a>

Provides the webpage’s workflow canvas, with draggable nodes, connection handles
and edges, and controls for navigating the diagram.

---

<a href="https://www.npmjs.com/package/@xyflow/system"><img src=".github/badges/version-dependency-xyflow--system.svg" alt="@xyflow/system declared version"></a>

Supplies Svelte Flow's measured handle geometry to the workflow connection router,
so previews and completed arrows meet the same endpoints.

---

<a href="https://www.npmjs.com/package/yaml"><img src=".github/badges/version-dependency-yaml.svg" alt="yaml declared version"></a>

Parses uploaded OpenAPI documents in YAML 1.2 format, converting their contents
into JSON-compatible values for schema validation and operation discovery.
