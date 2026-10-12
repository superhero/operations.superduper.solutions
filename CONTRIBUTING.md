# Contributing

Thank you for contributing to `operations.superduper.solutions`.

## Architectural decision records

- [Simplify](docs/adr/simplify.md)
- [UI](docs/adr/ui.md)
- [Security](docs/adr/security.md)
- [Gitflow](docs/adr/gitflow.md)
- [Development diagnostics](docs/adr/development-diagnostics.md)
- [Logging](docs/adr/logging.md)
- [Background loading and persistence](docs/adr/background-loading.md)
- [Testing and test reports](docs/adr/testing-and-reports.md)
- [Source coverage](docs/adr/source-coverage.md)

## Automation validation

See [Repository automation](.github/workflows/README.md) for local checks, test
reports, badges, CI workflows, releases, and deployment.

For Markdown-only changes, use a `docs/<topic>` branch from the intended target,
`develop` or `main`. See the [documentation workflow](.github/workflows/README.md#documentation-only-changes)
for the fast validation and merge path.

## Licensing

### Contribution license

By submitting a contribution, you agree that it is licensed under **GNU AGPLv3 only** (`AGPL-3.0-only`) together with `LICENSE-ADDITIONAL-TERMS`.

You retain the copyright in your contribution unless you separately assign it in writing.

By contributing, you represent that you have the right to submit the contribution under these terms.

### Source-file license notices

Preserve existing copyright, license, attribution, and Section 7 notices.

For new first-party source files, where comments are supported, use:

```text
Copyright (C) <year> <author name>
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
```

Do not replace another author's copyright notice with your own.

The project uses `AGPL-3.0-only`, not `AGPL-3.0-or-later`.
