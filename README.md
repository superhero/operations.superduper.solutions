## Webpage: [operations.superduper.solutions](https://operations.superduper.solutions)

A browser-based platform for composing OpenAPI operations into reusable workflows.

## Development status

> [!NOTE]
> This project is under active development and is currently in a pre-release state.

[![Main CI/CD](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-main.yml?label=Main%20CI%2FCD)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-main.yml)

Creates releases from `develop` and validates release and hotfix pull requests
before merging into `main`. Tags and deploys validated releases, publishes test
and coverage reports, and synchronizes released changes back to `develop`.

---

[![Develop CI](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-develop.yml?label=Develop%20CI)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-develop.yml)

Validates incoming changes before merging them into `develop`, checking branch
policy, types, tests, and build output. Keeps feature work, bug fixes, and
released changes integrated for the next release.

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

Supports application and CI validation by running source, acceptance, and
automation scenarios defined in `Gherkin`, producing the results used by the
combined test report.

---

<a href="https://www.npmjs.com/package/@lucide/svelte"><img src=".github/badges/version-dependency-lucide--svelte.svg" alt="@lucide/svelte declared version"></a>

Provides icons for the webpage’s navigation controls, including the menu button
and the close action in its `shadcn-svelte` sheet.

---

<a href="https://www.npmjs.com/package/multiple-cucumber-html-reporter"><img src=".github/badges/version-dependency-multiple-cucumber-html-reporter.svg" alt="multiple-cucumber-html-reporter declared version"></a>

Supports release quality review by generating the combined test report from
source, acceptance, and automation results, with scenario outcomes and failure
details.

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
