# Contributing

Thank you for contributing to `operations.superduper.solutions`.

## Architectural decision records

- [Simplify](doc/adr/simplify.md)
- [UI](doc/adr/ui.md)
- [Security](doc/adr/security.md)
- [Gitflow](doc/adr/gitflow.md)

## Workflow validation

For changes to release automation, run these checks from the repository root:

```sh
python3 -B -m unittest discover -s .github/tests -v
shellcheck .github/scripts/*.sh
actionlint
```

The regression tests use mocked GitHub responses and require Bash, Python 3,
and jq. They do not create releases or deploy. Development and release CI run
these checks before auto-merge.

Release-trigger retries reuse the release associated with the source PR and
commit. Deployment waits up to ten minutes for that release's CI and requires
the bundle, coverage report, and coverage status artifacts. Ordinary deployment
retries reject releases superseded by `main`; intentional rollback requires a
separate operation.

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
