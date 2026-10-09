## Webpage: [operations.superduper.solutions](https://operations.superduper.solutions)

A browser-based platform for composing OpenAPI operations into reusable workflows.

## Local development

Use the Node.js and npm versions declared in `package.json`, then run `npm ci`
and `npm run dev`. `npm run build` produces a standalone `dist/index.html`.

Two **Examples** catalogs provide 33 operations: 19 local mocks under
**example.com** and 14 live requests under **httpbin**. Find operations by name
or identifier using local Levenshtein matching, review their inputs, and compose
a workflow. Request previews and diagram connections do not execute API calls.
The separate **Run workflow** action identifies the selected catalog's execution
mode and submits each operation only when confirmed.

The example.com catalog runs entirely in the browser, including its fictional
project/task data and echoed example requests. Mock changes last for that run.
Its displayed URLs use [IANA's documentation domain](https://www.iana.org/help/example-domains/);
no requests are sent to example.com. The httpbin catalog sends real requests to
[httpbin.org's HTTP request and response service](https://httpbin.org/).
Network and HTTP failures remain visible and retryable; the live service must
be available and allow browser access. Both catalogs cover GET, POST, PUT,
PATCH, DELETE, HEAD and OPTIONS. TRACE is available only as a local mock because
browser Fetch does not permit it.

Named workflows are saved in this browser; use JSON export/import to keep a
portable copy. Browsing, editing, matching and mock runs work without a backend.
Existing `demo:*` project/task identifiers, paths and field identities are
preserved, so saved workflows continue to resolve their operations.

Adding an operation to the canvas creates separate input and response panels
from its documented schemas. Connect named output fields to input fields, or
drop onto an input panel to select the nearest available field. Nested object
and array branches can be hidden and restored; deleting an operation removes
its owned panels and connections. Version 2 exports retain these field mappings
and branch visibility. Existing version 1 plans remain readable and editable.
Undocumented, recursive, or unsupported schema shapes show an explicit notice;
response examples are never used to invent fields.

The canvas also supports **Switch** gates (first matching branch), **Cast**
conversions and editable Markdown **Comments**. Describe a workflow from the
toolbar, and add saved workflows from the sidebar to nest them. Nested nodes
carry a saved copy of their workflow and expose its unconnected inputs and
documented outputs; later edits or deletion of the original do not change that
copy. Version 3 exports include these nodes and descriptions while preserving
version 1/2 compatibility. The saved-workflow dialog supports selecting several
documents for deletion and retrying storage failures.

Runs ask for a starting operation when needed, validate inputs, pass mapped
responses through routing nodes and nested workflows, and offer **Next operation**
and **End run**. Ending a run cancels a pending request; it cannot undo an API
operation already processed. Cycles and unsupported input shapes report an
error instead of repeatedly issuing requests.

The bundled schemas are [`demo.openapi.json`](src/catalogs/demo.openapi.json)
and [`httpbin.openapi.json`](src/catalogs/httpbin.openapi.json). Their source
identities, navigation groups and execution destinations are registered together
in [`src/lib/catalog-registry.ts`](src/lib/catalog-registry.ts).
`extractOperations(document, source)` in [`src/lib/catalog.ts`](src/lib/catalog.ts)
validates each OpenAPI 3.0/3.1 document using its distinct source name. The
httpbin schemas describe the example forms we provide for its arbitrary echo
inputs; their chosen names and required fields are not service requirements.

Forms support string, number, integer, boolean, object, array and null values.
Objects and arrays use JSON text with nested type and required-field checks;
primitive fields also support enums, numeric bounds and Unicode text lengths,
and arrays support item-count bounds. Local schema references resolve up to a
12-level nesting limit. Path and header parameters accept primitive values;
query arrays repeat their parameter name, and flat query objects require
explicit `deepObject` serialization. Bodies support named JSON objects with
structured properties, root JSON arrays/scalars/null, plain text, URL-encoded
forms and multipart forms containing primitive text fields.

Workflow mappings preserve these types and can assemble declared nested
properties or array-item paths. Each assembled input must satisfy its full
schema; conflicting connections fail, and Cast converts only primitive values.
Each operation selects one request media type. File uploads, dynamic object
properties, nullable unions, schema composition, cookie parameters and other
unsupported constraints or serializations fail explicitly; remote references
are never fetched.

### Browser tests

With Docker running, build and test the application using:

```sh
npm ci
npm run build
npm run test:browser
```

These Cucumber scenarios use Playwright Chromium to check operation discovery,
form validation, request previews, themes, mobile navigation, and workflow
editing, saving and import/export. The existing branch workflows run the same
command against the bundle they build with the project's Node.js version.

The launcher uses the official Playwright Docker image, with its version taken
from the pinned `@playwright/test` dependency. Its bundled Node.js runs only the
tests and a local static server; the application is built beforehand. The first
run downloads the image, which includes Chromium and its system dependencies;
later local runs reuse it. Test packages come from `npm ci`. No separate browser
installation, exposed port, deployment or Cloudflare credentials are needed.

Each scenario starts with fresh browser storage. Browser tests intercept live
httpbin requests with controlled responses, so they do not depend on the public
service. Mock runs are checked for zero network requests. Browser errors and
unexpected network requests fail the test. Failed scenarios save a screenshot,
Playwright trace, and diagnostics under `tmp/test/browser/`; GitHub Actions retains these
for seven days. Open a downloaded `trace.zip` in the
[Playwright Trace Viewer](https://trace.playwright.dev/) to inspect its actions,
DOM snapshots, console and network activity. To run one scenario locally, use
`npm run test:browser -- --name 'The selected theme survives a reload'`.

After running source, acceptance, automation, and browser suites,
`npm run report:tests` creates the combined `tmp/test-report.html`, including
browser failure screenshots. Run the complete browser suite before generating
scenario badges. These tests verify behavior and responsive layout; visual
comparison baselines can be added once the design is agreed.

## Development status

> [!NOTE]
> This project is under active development and is currently in a pre-release state.

[![Main CI/CD](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-main.yml?label=Main%20CI%2FCD)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-main.yml)

Creates releases from `develop` and validates and previews release and hotfix
pull requests before merging into `main`. Continues in the same release run to
tag and deploy, publish test and coverage reports, and synchronize released
changes back to `develop`.

---

[![Develop CI](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-develop.yml?label=Develop%20CI)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-develop.yml)

Validates incoming changes before merging them into `develop`, checking branch
policy, types, tests, and build output. Keeps feature work, bug fixes, and
released changes integrated for the next release, then updates the
development preview.

## Quality Assurance

[![Test Scenarios](.github/badges/test-scenarios.svg)](https://status.operations.superduper.solutions/test-report.html)

Test coverage of the application behavior, build output, and release automation,
showing which expected outcomes are verified and which scenarios fail, with
details to help investigate regressions.

---

[![Test Coverage](.github/badges/test-coverage.svg)](https://status.operations.superduper.solutions/test-coverage.html)

Code coverage of the measured application source, showing which statements,
branches, functions, and lines are exercised by tests and where additional
tests are needed.

## Dependency packages

<a href="https://www.npmjs.com/package/bits-ui"><img src=".github/badges/version-dependency-bits-ui.svg" alt="bits-ui declared version"></a>

Supports the webpage’s user interface, providing the accessible dialog primitives
required by its `shadcn-svelte` sheet components.

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

<a href="https://www.npmjs.com/package/@lucide/svelte"><img src=".github/badges/version-dependency-lucide--svelte.svg" alt="@lucide/svelte declared version"></a>

Retained for optional SVG icons in Svelte components. The main interface uses
locally bundled, filled Material Symbols Rounded, documented with their license
in [`src/assets/fonts`](src/assets/fonts/README.md).

---

<a href="https://www.npmjs.com/package/multiple-cucumber-html-reporter"><img src=".github/badges/version-dependency-multiple-cucumber-html-reporter.svg" alt="multiple-cucumber-html-reporter declared version"></a>

Supports release quality review by generating the combined test report from
source, acceptance, browser, and automation results, with scenario outcomes and failure
details.

---

<a href="https://www.npmjs.com/package/@playwright/test"><img src=".github/badges/version-dependency-playwright--test.svg" alt="@playwright/test declared version"></a>

Checks the webpage in Chromium through Cucumber scenarios, using Playwright's
browser controls and assertions to verify user interactions and responsive
layout. Captures screenshots and traces to explain browser test failures.

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
and CSS, meeting the single-file requirement verified by the acceptance tests.

---

<a href="https://www.npmjs.com/package/@xyflow/svelte"><img src=".github/badges/version-dependency-xyflow--svelte.svg" alt="@xyflow/svelte declared version"></a>

Provides the webpage’s workflow canvas, with draggable nodes, connection handles
and edges, and controls for navigating the diagram.
