# Changelog

## Staging

<!-- changelog-commit:e2551bfd987b9ce39bc7853e90b2b05994494a71 -->
### Commit [`e2551bf`](https://github.com/superhero/operations.superduper.solutions/commit/e2551bfd987b9ce39bc7853e90b2b05994494a71)

```text
feat(ci): preserve commit messages in staged release changelogs

Capture complete commit messages in CHANGELOG.md before feature, bugfix
and documentation branches are squashed into develop. Keep unreleased
entries under Staging and exclude generated changelog commits on retries.

Fold Staging into the chosen version before release validation. Further
develop integrations update the existing release version while preserving
release-only fixes. Verify pinned revisions and use expected-head pushes
to avoid publishing over concurrent changes.

Keep an explicit Staging boundary so concurrent branch merges cannot
silently classify unreleased entries under a published version.

```

<!-- changelog-commit:55ae4267aca4cc018b01d0deae3287144901aa56 -->
### Commit [`55ae426`](https://github.com/superhero/operations.superduper.solutions/commit/55ae4267aca4cc018b01d0deae3287144901aa56)

```text
feat(workflows): add manual connection editing and controls

Let users adjust orthogonal connection segments with pointer or keyboard
controls while respecting node clearance. Preserve authored routes through
save, import, undo and redo, with automatic routing when a route is blocked.

Expose dash length, speed and node symbols in Workflow settings, separate
node clearance from curved lines, and promote the chosen browser defaults.
Retain existing saved preferences and workflow options.

Keep connection editing consistent with single-input occupancy, declared
type compatibility, logical tab order and visible focus controls. Include
the related Cucumber coverage, documentation and scenario badges.

```

<!-- changelog-commit:054c75b89152dd1d47bd4872e1acdf5c20935c3c -->
### Commit [`054c75b`](https://github.com/superhero/operations.superduper.solutions/commit/054c75b89152dd1d47bd4872e1acdf5c20935c3c)

```text
fix(workflows): restore reverse connections on free native inputs

Allow unoccupied native handles to start or receive connections in either direction while keeping occupied inputs locked. Extend browser coverage to verify deletion unlocks the input and reverse dragging preserves source and target identity.

```

<!-- changelog-commit:50a697994fdbf76d75acb1dc8ca8d0af289db4d2 -->
### Commit [`50a6979`](https://github.com/superhero/operations.superduper.solutions/commit/50a697994fdbf76d75acb1dc8ca8d0af289db4d2)

```text
chore: integrate staged changelog automation from develop

Combine the validated changelog automation with manual connection editing and its reverse-connection fix. Regenerate the scenario badge from the combined test evidence.

```

<!-- changelog-staging-end -->
