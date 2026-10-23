## Webpage: [operations.superduper.solutions](https://operations.superduper.solutions)

A browser-based platform for composing OpenAPI operations into reusable workflows.

Settings includes a [browser-local Bonsai assistant](docs/browser-assistant.md)
for inspecting the application and arranging workflows without running them.

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
- **Requirements:** Requires Bash, jq and fresh, complete results from all six Gherkin suites.

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
<summary><code>npm run report:tests</code></summary>

- **Purpose:** Merge Vitest results into `tmp/test/report/`, including coverage and attachments.
- **Requirements:** Run `npm ci` first. Complete, unfiltered results, execution proofs and
  coverage from all six suites are required; merging does not rerun tests.

</details>

<details>
<summary><code>npm run test:acceptance</code></summary>

- **Purpose:** Check the built output.
- **Requirements:** Run `npm ci` and `npm run build` first.

</details>

<details>
<summary><code>npm run test:automation</code></summary>

- **Purpose:** Check repository automation without deploying.
- **Requirements:** Run `npm ci` first. Bash, Git 2.45+ and jq are required.

</details>

<details>
<summary><code>npm run test:browser</code></summary>

- **Purpose:** Run application browser scenarios and Svelte component scenarios in Chromium.
  Focused browser selections run only the selected application scenarios.
- **Requirements:** Run `npm ci` and `npm run build` first. Bash and running Docker are required.

</details>

<details>
<summary><code>npm run test:components</code></summary>

- **Purpose:** Check Svelte state, bindings, props and cleanup through Gherkin in Vitest Browser Mode.
- **Requirements:** Run `npm ci` first and provide matching Playwright browser binaries.
  The unfiltered `test:browser` command runs these cases in its pinned container.

</details>

<details>
<summary><code>npm run test:coverage</code></summary>

- **Purpose:** Check the generated coverage summary against 100% statement, branch,
  function and line requirements; this command does not rerun tests.
- **Scope:** Node-executable application logic; see [Testing, coverage and reporting](docs/adr/test-suite-reports.md)
  for the scope and exclusions.
- **Requirements:** Collect fresh coverage with `npm run test:source:coverage` first.

</details>

<details>
<summary><code>npm run test:runner</code></summary>

- **Purpose:** Check Gherkin discovery, scenario identities, cancellation, cleanup and report evidence.
- **Requirements:** Run `npm ci` first.

</details>

<details>
<summary><code>npm run test:source</code></summary>

- **Purpose:** Run source behavior and unit scenarios through QuickPickle and Vitest,
  recording each case in `tmp/test/vitest-source.json`.
- **Requirements:** Run `npm ci` first.

</details>

<details>
<summary><code>npm run test:source:coverage</code></summary>

- **Purpose:** Run source Gherkin scenarios and collect V8 coverage in `tmp/test/coverage/`.
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
tag and deploy, publish the combined test and coverage report, and synchronize
released changes back to `develop`.

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

[![Test Coverage](https://status.operations.superduper.solutions/badges/test-coverage.svg)](https://status.operations.superduper.solutions/test-report.html)

Code coverage of the measured application source, showing which statements,
branches, functions, and lines are exercised by tests and where additional
tests are needed.

## Dependency packages

<a href="https://www.npmjs.com/package/@actions/artifact"><img src=".github/badges/version-dependency-actions--artifact.svg" alt="@actions/artifact declared version"></a>

Publishes and restores verified test feature checkpoints in GitHub Actions so
CI retries can reuse successful work.

---

<a href="https://www.npmjs.com/package/@earendil-works/pi-agent-core"><img src=".github/badges/version-dependency-earendil-works--pi-agent-core.svg" alt="@earendil-works/pi-agent-core declared version"></a>
<a href="https://www.npmjs.com/package/@earendil-works/pi-ai"><img src=".github/badges/version-dependency-earendil-works--pi-ai.svg" alt="@earendil-works/pi-ai declared version"></a>

Provide the browser assistant's streaming agent loop, native tool transcript,
validated tool execution and progressive skill reads. Inference uses the pinned
WebML adapter; no hosted model provider is selected.

---

<a href="https://www.npmjs.com/package/@codemirror/commands"><img src=".github/badges/version-dependency-codemirror--commands.svg" alt="@codemirror/commands declared version"></a>
<a href="https://www.npmjs.com/package/@codemirror/lang-markdown"><img src=".github/badges/version-dependency-codemirror--lang-markdown.svg" alt="@codemirror/lang-markdown declared version"></a>
<a href="https://www.npmjs.com/package/@codemirror/language"><img src=".github/badges/version-dependency-codemirror--language.svg" alt="@codemirror/language declared version"></a>
<a href="https://www.npmjs.com/package/@codemirror/state"><img src=".github/badges/version-dependency-codemirror--state.svg" alt="@codemirror/state declared version"></a>
<a href="https://www.npmjs.com/package/@codemirror/view"><img src=".github/badges/version-dependency-codemirror--view.svg" alt="@codemirror/view declared version"></a>
<a href="https://www.npmjs.com/package/@lezer/highlight"><img src=".github/badges/version-dependency-lezer--highlight.svg" alt="@lezer/highlight declared version"></a>

Provide the comment editor's Markdown syntax highlighting, document state,
selection, keyboard commands and editing view.

---

<a href="https://www.npmjs.com/package/markdown-it"><img src=".github/badges/version-dependency-markdown-it.svg" alt="markdown-it declared version"></a>
<a href="https://www.npmjs.com/package/@mdit/plugin-footnote"><img src=".github/badges/version-dependency-mdit--plugin-footnote.svg" alt="@mdit/plugin-footnote declared version"></a>
<a href="https://www.npmjs.com/package/@mdit/plugin-img-lazyload"><img src=".github/badges/version-dependency-mdit--plugin-img-lazyload.svg" alt="@mdit/plugin-img-lazyload declared version"></a>
<a href="https://www.npmjs.com/package/@mdit/plugin-img-size"><img src=".github/badges/version-dependency-mdit--plugin-img-size.svg" alt="@mdit/plugin-img-size declared version"></a>
<a href="https://www.npmjs.com/package/@mdit/plugin-ins"><img src=".github/badges/version-dependency-mdit--plugin-ins.svg" alt="@mdit/plugin-ins declared version"></a>
<a href="https://www.npmjs.com/package/@mdit/plugin-mark"><img src=".github/badges/version-dependency-mdit--plugin-mark.svg" alt="@mdit/plugin-mark declared version"></a>
<a href="https://www.npmjs.com/package/@mdit/plugin-sub"><img src=".github/badges/version-dependency-mdit--plugin-sub.svg" alt="@mdit/plugin-sub declared version"></a>
<a href="https://www.npmjs.com/package/@mdit/plugin-sup"><img src=".github/badges/version-dependency-mdit--plugin-sup.svg" alt="@mdit/plugin-sup declared version"></a>
<a href="https://www.npmjs.com/package/@mdit/plugin-tasklist"><img src=".github/badges/version-dependency-mdit--plugin-tasklist.svg" alt="@mdit/plugin-tasklist declared version"></a>

Render stored Markdown with shared extensions for footnotes, images, inserted
and highlighted text, subscripts, superscripts and task lists.

---

<a href="https://www.npmjs.com/package/@cucumber/gherkin"><img src=".github/badges/version-dependency-cucumber--gherkin.svg" alt="@cucumber/gherkin declared version"></a>

Parses Gherkin features and scenario-outline examples. Independent case discovery
checks that the combined report contains every declared scenario.

---

<a href="https://www.npmjs.com/package/@cucumber/messages"><img src=".github/badges/version-dependency-cucumber--messages.svg" alt="@cucumber/messages declared version"></a>

Provides the Gherkin message types and identifiers used when parsing features
and preserving canonical scenario and example-row locations.

---

<a href="https://www.npmjs.com/package/flatted"><img src=".github/badges/version-dependency-flatted.svg" alt="flatted declared version"></a>

Reads and rewrites Vitest blob references when results move between CI jobs,
so reports retain attachments and coverage without changing the original evidence.

---

<a href="https://www.npmjs.com/package/quickpickle"><img src=".github/badges/version-dependency-quickpickle.svg" alt="quickpickle declared version"></a>

Registers Gherkin scenarios and steps with Vitest. The maintained local package
in `tests/gherkin/quickpickle` preserves example identities, cancellation, cleanup
and failure details needed by the shared report.

---

<a href="https://www.npmjs.com/package/vitest"><img src=".github/badges/version-dependency-vitest.svg" alt="vitest declared version"></a>

Executes all Gherkin suites and produces mergeable results. Its built-in HTML
report presents scenario outcomes, diagnostics and coverage in one report.

---

<a href="https://www.npmjs.com/package/@vitest/ui"><img src=".github/badges/version-dependency-vitest--ui.svg" alt="@vitest/ui declared version"></a>

Provides the built-in Vitest HTML interface used to browse the combined results.
Publish the complete report directory with its metadata and assets.

---

<a href="https://www.npmjs.com/package/@vitest/coverage-v8"><img src=".github/badges/version-dependency-vitest--coverage-v8.svg" alt="@vitest/coverage-v8 declared version"></a>

Measures V8 coverage within the explicit application scope, including unexecuted
files. Release validation requires 100% statements, branches, functions and lines.

---

<a href="https://www.npmjs.com/package/@vitest/browser-playwright"><img src=".github/badges/version-dependency-vitest--browser-playwright.svg" alt="@vitest/browser-playwright declared version"></a>

Connects Vitest Browser Mode to Playwright for Gherkin component scenarios
using native browser interactions.

---

<a href="https://www.npmjs.com/package/vitest-browser-svelte"><img src=".github/badges/version-dependency-vitest-browser-svelte.svg" alt="vitest-browser-svelte declared version"></a>

Mounts, updates and unmounts Svelte components in Vitest Browser Mode while
retaining native bindings and lifecycle cleanup.

---

<a href="https://www.npmjs.com/package/bits-ui"><img src=".github/badges/version-dependency-bits-ui.svg" alt="bits-ui declared version"></a>

Provides accessible dialog, select, popover, and tooltip primitives used by the
webpage’s shared controls and `shadcn-svelte` sheet components.

---

<a href="https://www.npmjs.com/package/buffer"><img src=".github/badges/version-dependency-buffer.svg" alt="buffer declared version"></a>

Provides the Node.js `Buffer` API that `isomorphic-git` needs to read and write
binary Git data in the browser. LightningFS stores the resulting repository
files locally in IndexedDB.

---

<a href="https://www.npmjs.com/package/cn"><img src=".github/badges/version-dependency-cn.svg" alt="cn declared version"></a>

Supports the webpage’s UI styling, combining default and custom `Tailwind CSS`
classes in `shadcn-svelte` components and resolving conflicts.

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

<a href="https://www.npmjs.com/package/papaparse"><img src=".github/badges/version-dependency-papaparse.svg" alt="papaparse declared version"></a>
<a href="https://www.npmjs.com/package/@types/papaparse"><img src=".github/badges/version-dependency-types--papaparse.svg" alt="@types/papaparse declared version"></a>

Parses uploaded CSV data in a dedicated worker, supporting delimiter detection,
quoted multiline cells and configurable headers. `@types/papaparse` supplies its
TypeScript definitions during development.

---

<a href="https://www.npmjs.com/package/@playwright/test"><img src=".github/badges/version-dependency-playwright--test.svg" alt="@playwright/test declared version"></a>

Checks the webpage in Chromium through Gherkin scenarios, using Playwright's
browser controls and assertions to verify user interactions and responsive
layout. Captures screenshots and traces to explain browser test failures.

---

<a href="https://www.npmjs.com/package/@apidevtools/json-schema-ref-parser"><img src=".github/badges/version-dependency-apidevtools--json-schema-ref-parser.svg" alt="@apidevtools/json-schema-ref-parser declared version"></a>

Bundles external schema references into the checked-in service packs during an
explicit refresh. Ordinary builds do not download provider schemas.

---

<a href="https://www.npmjs.com/package/swagger2openapi"><img src=".github/badges/version-dependency-swagger2openapi.svg" alt="swagger2openapi declared version"></a>

Converts Swagger 2 service descriptions to OpenAPI 3 during schema refresh.
It is development tooling and is not shipped in the browser runtime.

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
