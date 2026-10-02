# Contributing

Thank you for contributing to `operations.superduper.solutions`.

## Principles

Keep it simple.

Follow **KISS** and **YAGNI**:

- prefer the smallest clear solution;
- avoid unnecessary abstractions and dependencies;
- do not build features before they are needed;
- favor readable, maintainable code over cleverness.

## Contribution license

By submitting a contribution, you agree that it is licensed under **GNU AGPLv3 only** (`AGPL-3.0-only`) together with `LICENSE-ADDITIONAL-TERMS`.

You retain the copyright in your contribution unless you separately assign it in writing.

By contributing, you represent that you have the right to submit the contribution under these terms.

## Source-file license notices

Preserve existing copyright, license, attribution, and Section 7 notices.

For new first-party source files, where comments are supported, use:

```text
Copyright (C) <year> <author name>
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
```

Do not replace another author's copyright notice with your own.

The project uses `AGPL-3.0-only`, not `AGPL-3.0-or-later`.

## Modified versions

Follow `LICENSE-ADDITIONAL-TERMS` when modifying or redistributing the software.

## Security

Do not commit secrets or credentials. Use environment variables or an appropriate secrets-management mechanism for runtime secrets.


## Theme colors

The interface uses five semantic color tokens. Components must reference these
tokens instead of introducing literal colors of their own:

```css
--color-background: #023047;
--color-surface: #219ebc;
--color-foreground: #8ecae6;
--color-accent: #ffb703;
--color-emphasis: #fb8500;
```

Their roles are:

- `background`: application canvas and darkest base;
- `surface`: panels, controls, and secondary UI areas;
- `foreground`: primary text and light structural elements;
- `accent`: interactive elements, selections, and primary actions;
- `emphasis`: stronger highlights and attention states.

A different theme should remap these same five semantic tokens rather than
renaming them. Derived shades should use these variables, for example with
`color-mix()`, instead of adding unrelated palette constants.
