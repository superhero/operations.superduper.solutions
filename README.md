## Webpage: [operations.superduper.solutions](https://operations.superduper.solutions)

A browser-based platform for composing OpenAPI operations into reusable workflows.

> [!NOTE]
> This project is under active development and is currently in a pre-release state.

[![Main CI/CD](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-main.yml?label=Main%20CI%2FCD)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-main.yml)
[![Develop CI](https://img.shields.io/github/actions/workflow/status/superhero/operations.superduper.solutions/ci-develop.yml?label=Develop%20CI)](https://github.com/superhero/operations.superduper.solutions/actions/workflows/ci-develop.yml)
[![Test Scenarios](.github/badges/test-scenarios.svg)](https://status.operations.superduper.solutions/test-report.html)
[![Test Coverage](.github/badges/test-coverage.svg)](https://status.operations.superduper.solutions/test-coverage.html)

## Local development

Use the Node.js and npm versions declared in [`package.json`](package.json).
Run commands from the repository root. Install the locked dependencies and start
the development server:

```sh
npm ci
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check Svelte components and TypeScript source. |
| `npm run build` | Build `dist/index.html`. |

## Tests

| Command | Purpose | Requirements |
| --- | --- | --- |
| `npm run test:source` | Run source scenarios. | Installed dependencies. |
| `npm run test:acceptance` | Check the built output. | A current build. |
| `npm run test:automation` | Check repository automation without deploying. | Bash and jq. |
| `npm run test:browser` | Run browser scenarios in Chromium. | A current build and running Docker. |

`npm test` is an alias for `npm run test:acceptance`, not the full test suite.
The browser launcher downloads its pinned Playwright image when needed; no
separate browser installation is required.

### Run all suites and generate a report

After `npm ci`, with the requirements above available:

```sh
npm run typecheck
npm run build
npm run test:source
npm run test:acceptance
npm run test:automation
npm run test:browser
npm run report:tests
```

Open `tmp/test-report.html` for the combined results. Report generation requires
results from all four suites. Browser failure diagnostics are saved under
`tmp/test/browser/`.

### Run a single scenario

Pass a scenario name after `--`, replacing the example name below:

```sh
npm run test:browser -- --name 'Exact scenario name'
```

Rerun the complete suite before generating the combined report or scenario badge.

## Coverage

Collect source coverage, then generate reports and check the configured 100%
statement, branch, function and line thresholds:

```sh
npm run test:source:coverage
npm run coverage
```

Open `tmp/test/coverage/index.html` for the report. The summary used by the
coverage badge is `tmp/test/coverage/coverage-summary.json`.

`npm run test:acceptance:coverage` collects coverage while running the acceptance
suite instead. Follow it with `npm run coverage` to report that run; use a fresh
source-coverage run for the project's coverage badge.

## Badges

Regenerate badges after the relevant changes and commit the updated files under
`.github/badges/`:

| Command | Required input |
| --- | --- |
| `npm run badges:dependencies` | Updated dependency versions in `package.json`. |
| `npm run badges:coverage` | A fresh `npm run test:source:coverage` followed by `npm run coverage`. |
| `npm run badges:scenarios` | Fresh, complete results from all four test suites. |

Append `-- --check` to any badge command to validate without writing changes:

```sh
npm run badges:dependencies -- --check
```

## Dependency packages

<details>
<summary>Declared versions</summary>

<a href="https://www.npmjs.com/package/bits-ui"><img src=".github/badges/version-dependency-bits-ui.svg" alt="bits-ui declared version"></a>
<a href="https://www.npmjs.com/package/c8"><img src=".github/badges/version-dependency-c8.svg" alt="c8 declared version"></a>
<a href="https://www.npmjs.com/package/cn"><img src=".github/badges/version-dependency-cn.svg" alt="cn declared version"></a>
<a href="https://www.npmjs.com/package/@cucumber/cucumber"><img src=".github/badges/version-dependency-cucumber--cucumber.svg" alt="@cucumber/cucumber declared version"></a>
<a href="https://www.npmjs.com/package/@lucide/svelte"><img src=".github/badges/version-dependency-lucide--svelte.svg" alt="@lucide/svelte declared version"></a>
<a href="https://www.npmjs.com/package/multiple-cucumber-html-reporter"><img src=".github/badges/version-dependency-multiple-cucumber-html-reporter.svg" alt="multiple-cucumber-html-reporter declared version"></a>
<a href="https://www.npmjs.com/package/@playwright/test"><img src=".github/badges/version-dependency-playwright--test.svg" alt="@playwright/test declared version"></a>
<a href="https://www.npmjs.com/package/svelte"><img src=".github/badges/version-dependency-svelte.svg" alt="svelte declared version"></a>
<a href="https://www.npmjs.com/package/svelte-check"><img src=".github/badges/version-dependency-svelte-check.svg" alt="svelte-check declared version"></a>
<a href="https://www.npmjs.com/package/@sveltejs/vite-plugin-svelte"><img src=".github/badges/version-dependency-sveltejs--vite-plugin-svelte.svg" alt="@sveltejs/vite-plugin-svelte declared version"></a>
<a href="https://www.npmjs.com/package/tailwind-variants"><img src=".github/badges/version-dependency-tailwind-variants.svg" alt="tailwind-variants declared version"></a>
<a href="https://www.npmjs.com/package/tailwindcss"><img src=".github/badges/version-dependency-tailwindcss.svg" alt="tailwindcss declared version"></a>
<a href="https://www.npmjs.com/package/@tailwindcss/vite"><img src=".github/badges/version-dependency-tailwindcss--vite.svg" alt="@tailwindcss/vite declared version"></a>
<a href="https://www.npmjs.com/package/tw-animate-css"><img src=".github/badges/version-dependency-tw-animate-css.svg" alt="tw-animate-css declared version"></a>
<a href="https://www.npmjs.com/package/typescript"><img src=".github/badges/version-dependency-typescript.svg" alt="typescript declared version"></a>
<a href="https://www.npmjs.com/package/vite"><img src=".github/badges/version-dependency-vite.svg" alt="vite declared version"></a>
<a href="https://www.npmjs.com/package/vite-plugin-singlefile"><img src=".github/badges/version-dependency-vite-plugin-singlefile.svg" alt="vite-plugin-singlefile declared version"></a>
<a href="https://www.npmjs.com/package/@xyflow/svelte"><img src=".github/badges/version-dependency-xyflow--svelte.svg" alt="@xyflow/svelte declared version"></a>

TypeScript upgrade tracking:
[![Status of upstream TypeScript 7 issue #3063](https://img.shields.io/github/issues/detail/state/sveltejs/language-tools/3063?label=upstream%20issue%20%233063)](https://github.com/sveltejs/language-tools/issues/3063)

</details>

## Contributing

See [Contributing](CONTRIBUTING.md) for architectural decisions, contribution
conventions and release automation.
