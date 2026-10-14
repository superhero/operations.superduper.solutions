# Changelog

## Latest

<!-- changelog-commit:17b4d758ca8df902ce1c60233fa8d73abce6f92b -->
### Commit [`17b4d75`](https://github.com/superhero/operations.superduper.solutions/commit/17b4d758ca8df902ce1c60233fa8d73abce6f92b)

```text
fix(settings): default histogram to used JavaScript heap

```

<!-- changelog-latest-end -->

## 0.0.45

<!-- changelog-commit:58bebe05eea9512142065372084bd7d819cc4c06 -->
### Commit [`58bebe0`](https://github.com/superhero/operations.superduper.solutions/commit/58bebe05eea9512142065372084bd7d819cc4c06)

```text
fix(ci): reuse validation proofs with bounded network retries

Rely on the original successful run and complete manifest instead of
listing its jobs again. Preserve input, provenance and artifact checks
while allowing transient reads and downloads two retries with 30-second
attempts inside the existing 120-second lookup budget.

Clear partial downloads before retrying and report safe failure categories.
Cover subprocess timeouts, retry exhaustion, cleanup and the workflow
gates that ensure only complete fresh validation can publish proof.

```

<!-- changelog-commit:364d8bd6d1630f25833ea2471df77506aa62703c -->
### Commit [`364d8bd`](https://github.com/superhero/operations.superduper.solutions/commit/364d8bd6d1630f25833ea2471df77506aa62703c)

```text
chore: merge develop after release changelog synchronization

```

## 0.0.44

<!-- changelog-commit:6ef72c23fa2daf336ed692ee0748c8dccbdb2f78 -->
### Commit [`6ef72c2`](https://github.com/superhero/operations.superduper.solutions/commit/6ef72c23fa2daf336ed692ee0748c8dccbdb2f78)

```text
ci(release): version changelogs by PR and reuse complete validation

Collect unreleased commit messages under Latest and preserve the source
snapshot when creating a release. Open a separate Markdown-only PR into
the release branch to assign its version before publication. Resume the
release only for that exact canonical changelog transition, including an
empty Latest section, and retain compatibility with existing Staging data.

Produce complete test, coverage and build evidence during integration.
Reuse it across later merges only when every tracked input except the root
changelog matches and the successful original run and artifact hashes
verify. Bound lookup time, fall back to fresh validation when evidence is
unavailable, and retain the original report provenance.

Keep release gates, retry protection, regression scenarios, documentation
and the scenario badge aligned with the new lifecycle.

```

## 0.0.43

<!-- changelog-commit:37fb88f5c9d5af2613c1d7c82e75d6bd7953121c -->
### Commit [`37fb88f`](https://github.com/superhero/operations.superduper.solutions/commit/37fb88f5c9d5af2613c1d7c82e75d6bd7953121c)

```text
docs: recover original commit history in the changelog

Backfill 673 complete commit messages across 41 confirmed release tags,
including original PR commits retained outside the squashed main history.
Replace squash summaries, deduplicate original identities, and preserve
existing release entries using full ancestry for release attribution.

Document the recovery scope and the missing 0.0.21 tag, whose changes
first appear in the confirmed 0.0.22 tag.

```

<!-- changelog-commit:e951e34e860c477fcd33a05809c8e1745adfabd4 -->
### Commit [`e951e34`](https://github.com/superhero/operations.superduper.solutions/commit/e951e34e860c477fcd33a05809c8e1745adfabd4)

```text
fix(ui): improve light-theme background contrast

Double wave opacity and workspace dot opacity in light mode so both remain visible across palettes. Keep dark-mode opacity unchanged and update wave strength when the theme changes.

```

<!-- changelog-commit:402bda81fe6465e5d615334032c64a8128770218 -->
### Commit [`402bda8`](https://github.com/superhero/operations.superduper.solutions/commit/402bda81fe6465e5d615334032c64a8128770218)

```text
feat(ui): add an embedded workflow favicon

Add original connected-node artwork using the default palette and the project license notice. Inline the SVG through Vite so releases retain the single application page and hosting metadata layout, and document the asset location.

```

<!-- changelog-commit:437e2904f73d5283daffe30ba6734b2fd2d7975e -->
### Commit [`437e290`](https://github.com/superhero/operations.superduper.solutions/commit/437e2904f73d5283daffe30ba6734b2fd2d7975e)

```text
feat(ui): publish favicon formats with attribution metadata

Generate browser and compatibility icons from the schema artwork with a\nshared title, creator and license notice in supported metadata fields.\nKeep BMP and DIB-based ICO compatible without nonstandard metadata.\n\nValidate generated freshness and the complete deployment file set, with\nCucumber coverage for packaging, image decoding and attribution.

```

<!-- changelog-commit:607fdec818bd682b2463bab3abc10c8e12cc8c06 -->
### Commit [`607fdec`](https://github.com/superhero/operations.superduper.solutions/commit/607fdec818bd682b2463bab3abc10c8e12cc8c06)

```text
fix(ui): use Spring colors for the favicon

```

<!-- changelog-commit:d068f6bf3a3a8a6cdb5342cb124bd2552e5ef6fb -->
### Commit [`d068f6b`](https://github.com/superhero/operations.superduper.solutions/commit/d068f6bf3a3a8a6cdb5342cb124bd2552e5ef6fb)

```text
feat(ci): support explicit documentation merge targets

Allow Markdown-only PRs into active releases as well as main and develop,
with independent full-diff validation and the existing main freshness guard.
Serialize release documentation against production merges and keep
Markdown-only release advances from resuming publication.

Provide explicit recovery of a merged documentation PR's original source
head so squash merges and branch deletion do not broaden later targets.
Document reuse, rollout and retry behavior with Cucumber regression coverage.

```

<!-- changelog-commit:6108eb9a9c03c5a625c0b99e516b4cd4b4cbe904 -->
### Commit [`6108eb9`](https://github.com/superhero/operations.superduper.solutions/commit/6108eb9a9c03c5a625c0b99e516b4cd4b4cbe904)

```text
feat(errors): retain bounded browser error history

Capture application, runtime, rejection and worker diagnostics without changing their existing console and UI reporting. Keep 1,000 unique errors in IndexedDB with occurrence counts and atomic FIFO eviction across tabs.

Record through a dedicated worker with bounded pending work, guarded failures and explicit retry. Expose paginated history, stacks and causes in Browser settings. Cover capture, persistence, concurrency and recovery with Cucumber scenarios.

```

<!-- changelog-commit:df6803cb23e9799f255859c8b7a595775ee444d4 -->
### Commit [`df6803c`](https://github.com/superhero/operations.superduper.solutions/commit/df6803cb23e9799f255859c8b7a595775ee444d4)

```text
test: migrate standalone source tests to Cucumber

Report all 78 existing Node test cases as individual source scenarios while
preserving their assertions and restoring shared state after each case.
Remove the separate test:unit path so source execution, coverage, reports
and scenario badges use the same Cucumber results.

Verify explicit source registration and real runner failure propagation,
including cleanup-hook failures, through generated HTML and badge outputs.
Update contributor guidance while retaining the separate browser smoke
migration gap.

```

<!-- changelog-commit:efd5d7114ecd15749e9eb58a996614570fc179da -->
### Commit [`efd5d71`](https://github.com/superhero/operations.superduper.solutions/commit/efd5d7114ecd15749e9eb58a996614570fc179da)

```text
Merge develop into feature/cucumber-test-reporting

Reconcile the error-monitoring worker fixture with Cucumber cleanup and retain the new error namespace. Regenerate scenario totals for the combined reporting and documentation-target changes.

```

<!-- changelog-commit:62eb4215e0b77559172107f5dd69c8becd1ab0c7 -->
### Commit [`62eb421`](https://github.com/superhero/operations.superduper.solutions/commit/62eb4215e0b77559172107f5dd69c8becd1ab0c7)

```text
fix(ui): remove selected theme checkmark shadow

Remove the checkmark text shadow and its shadow transition while preserving the selected theme icon, colors and scale animation.

```

<!-- changelog-commit:6c9d41a02e9045f91afcf661a4f8cf62da6475ff -->
### Commit [`6c9d41a`](https://github.com/superhero/operations.superduper.solutions/commit/6c9d41a02e9045f91afcf661a4f8cf62da6475ff)

```text
Merge develop into bugfix/theme-checkmark-shadow

Preserve the integrated error history, Cucumber suites, and staged changelog while retaining the theme checkmark shadow removal.

```

## 0.0.42

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

<!-- changelog-commit:9d25613ba0c069b2e49c4ae79cc4e0452190f063 -->
### Commit [`9d25613`](https://github.com/superhero/operations.superduper.solutions/commit/9d25613ba0c069b2e49c4ae79cc4e0452190f063)

```text
docs: clarify dependency descriptions

```

<!-- changelog-commit:fd275a2f07f18d88413d3cff96279b11cbf143e1 -->
### Commit [`fd275a2`](https://github.com/superhero/operations.superduper.solutions/commit/fd275a2f07f18d88413d3cff96279b11cbf143e1)

```text
docs: document commands and development decisions

Document missing npm commands and clarify their test prerequisites and scope.
Move development diagnostics and logging guidance into focused ADRs, and
record startup progress and preview usage alongside background loading.

```

<!-- changelog-commit:90be6ca926cae5ab8d168b4bc80a649998ea4afb -->
### Commit [`90be6ca`](https://github.com/superhero/operations.superduper.solutions/commit/90be6ca926cae5ab8d168b4bc80a649998ea4afb)

```text
docs: record testing and coverage decisions

Define Cucumber reporting as the shared test format and document the
remaining standalone-test gap. Explain the measured coverage scope and
report commands, with links replacing detailed README coverage prose.

```

<!-- changelog-commit:55f000cb038a627d84823de447a1948e04ad2546 -->
### Commit [`55f000c`](https://github.com/superhero/operations.superduper.solutions/commit/55f000cb038a627d84823de447a1948e04ad2546)

```text
docs: frame branching and releases as an architectural decision

Move contributor automation guidance into the branching and releases ADR.
Explain the Gitflow and automation decision, preserve existing policy,
and update links to the renamed document.

```

<!-- changelog-commit:3dfd28465cbf03579e2bd033d734a223ff0ec6d0 -->
### Commit [`3dfd284`](https://github.com/superhero/operations.superduper.solutions/commit/3dfd28465cbf03579e2bd033d734a223ff0ec6d0)

```text
docs: record the project licensing decision

Move contribution licensing and source-notice guidance into a dedicated
ADR, preserving the existing terms and linking the governing license files.

```

<!-- changelog-commit:eb00005952af8ef03178759fd717af1acb489ce0 -->
### Commit [`eb00005`](https://github.com/superhero/operations.superduper.solutions/commit/eb00005952af8ef03178759fd717af1acb489ce0)

```text
docs: hyphenate AGPLv3-only consistently

```

<!-- changelog-commit:21d809df8aa181a8e30da3ffa14a7fbcd98fa6a9 -->
### Commit [`21d809d`](https://github.com/superhero/operations.superduper.solutions/commit/21d809df8aa181a8e30da3ffa14a7fbcd98fa6a9)

```text
docs: consolidate architectural decisions and clarify their scope

Merge diagnostics, validation and resource monitoring records around their shared decisions. Broaden content versioning and OpenAPI node guidance, index all thirteen ADRs, and update references and stale UI details.

```

<!-- changelog-commit:124986704bdd513c41906054c50068e6b857d518 -->
### Commit [`1249867`](https://github.com/superhero/operations.superduper.solutions/commit/124986704bdd513c41906054c50068e6b857d518)

```text
docs: align ADR filenames with their decisions

```

<!-- changelog-commit:3c506694dd6288c9591ca86e5f2064a74f540db2 -->
### Commit [`3c50669`](https://github.com/superhero/operations.superduper.solutions/commit/3c506694dd6288c9591ca86e5f2064a74f540db2)

```text
docs: welcome prospective contributors and introduce ADRs

```

<!-- changelog-commit:cb93074de750abbe332746acc05c7ab5989d330c -->
### Commit [`cb93074`](https://github.com/superhero/operations.superduper.solutions/commit/cb93074de750abbe332746acc05c7ab5989d330c)

```text
docs: refine ADR filenames and update references

```

<!-- changelog-commit:5f303e2aca7e29a9fd1eda21a447f795a7a3e901 -->
### Commit [`5f303e2`](https://github.com/superhero/operations.superduper.solutions/commit/5f303e2aca7e29a9fd1eda21a447f795a7a3e901)

```text
docs: unify OpenAPI adaptation decisions

Combine schema-library management and workflow node modeling in one ADR,
connecting operation discovery to the OpenAPI input and response contract.
Preserve recovery and saved-mapping guidance and update the index and links.

```

<!-- changelog-commit:0ba23c1afac25b564d82834aaf029750927df6f6 -->
### Commit [`0ba23c1`](https://github.com/superhero/operations.superduper.solutions/commit/0ba23c1afac25b564d82834aaf029750927df6f6)

```text
docs: alphabetize the ADR index

```

<!-- changelog-commit:99105bdf1f9fa7d52b4bb28d5ed25b3361e48ced -->
### Commit [`99105bd`](https://github.com/superhero/operations.superduper.solutions/commit/99105bdf1f9fa7d52b4bb28d5ed25b3361e48ced)

```text
docs: rename the local resource management ADR

```

<!-- changelog-commit:ba5d2499676d9b16fcc1644e0290452bd76485ea -->
### Commit [`ba5d249`](https://github.com/superhero/operations.superduper.solutions/commit/ba5d2499676d9b16fcc1644e0290452bd76485ea)

```text
docs: shorten the CI/CD ADR filename

```

<!-- changelog-commit:21895daa9c039d3f3781eacb96bbeb47e332f9dd -->
### Commit [`21895da`](https://github.com/superhero/operations.superduper.solutions/commit/21895daa9c039d3f3781eacb96bbeb47e332f9dd)

```text
docs: identify the AVH git-flow model

```

<!-- changelog-commit:0a7a93d0eadc7c05f038b07fa8f682299b83e5e1 -->
### Commit [`0a7a93d`](https://github.com/superhero/operations.superduper.solutions/commit/0a7a93d0eadc7c05f038b07fa8f682299b83e5e1)

```text
docs: remove support-branch guidance from the CI/CD ADR

```

<!-- changelog-commit:2e79a3b8566996cd994a40f57321c4a605089fbe -->
### Commit [`2e79a3b`](https://github.com/superhero/operations.superduper.solutions/commit/2e79a3b8566996cd994a40f57321c4a605089fbe)

```text
docs: separate CI/CD decisions from automation procedures

Keep the ADR focused on branching rationale and release safeguards.
Consolidate detailed branch, preview and publication rules in the existing
repository automation guide without duplicating its procedures.

```

<!-- changelog-commit:65a65bf20a90310485027f37b3e28fe094a57435 -->
### Commit [`65a65bf`](https://github.com/superhero/operations.superduper.solutions/commit/65a65bf20a90310485027f37b3e28fe094a57435)

```text
docs: illustrate branch origins and merge paths

```

<!-- changelog-commit:4f9bda79a7fc3ea83f23860864a15771dfe15ce4 -->
### Commit [`4f9bda7`](https://github.com/superhero/operations.superduper.solutions/commit/4f9bda79a7fc3ea83f23860864a15771dfe15ce4)

```text
docs: illustrate Gitflow with a native Mermaid Git graph

Show branch histories, release tags and hotfix synchronization. Clarify
that integration points follow the documented fast-forward, squash and
merge policies rather than implying every integration creates a merge commit.

```

<!-- changelog-commit:c60350e7bc1712d004de609bfbc987e6a45825df -->
### Commit [`c60350e`](https://github.com/superhero/operations.superduper.solutions/commit/c60350e7bc1712d004de609bfbc987e6a45825df)

```text
docs: orient the Git graph from bottom to top

```

<!-- changelog-commit:81078b07718e65012d3073f9959ac1e2c1526e4b -->
### Commit [`81078b0`](https://github.com/superhero/operations.superduper.solutions/commit/81078b07718e65012d3073f9959ac1e2c1526e4b)

```text
docs: color Git graph branches by their purpose

```

<!-- changelog-commit:c62e15d33aaf0923c6a09a87300b6827e849d9c3 -->
### Commit [`c62e15d`](https://github.com/superhero/operations.superduper.solutions/commit/c62e15d33aaf0923c6a09a87300b6827e849d9c3)

```text
docs: separate Gitflow diagrams into readable scenarios

Show everyday changes, release publication and production hotfixes in
separate four-lane graphs. Label integrations and shorten branch labels
while retaining the documented merge routes and branch colors.

```

<!-- changelog-commit:74db8834c31ab52893b2cf0fd803e38bcaaf3467 -->
### Commit [`74db883`](https://github.com/superhero/operations.superduper.solutions/commit/74db8834c31ab52893b2cf0fd803e38bcaaf3467)

```text
docs: order Gitflow lanes and separate documentation changes

```

<!-- changelog-commit:97d479c51ce97185cb4edc1f0d7314fdcd659a55 -->
### Commit [`97d479c`](https://github.com/superhero/operations.superduper.solutions/commit/97d479c51ce97185cb4edc1f0d7314fdcd659a55)

```text
revert: restore the previous Gitflow graph layout

Revert 74db8834c31ab52893b2cf0fd803e38bcaaf3467 at user request,
restoring separate everyday, release and hotfix examples.

```

<!-- changelog-commit:c2cb78fe80fdde078ec9d5216727424ef6f89a9e -->
### Commit [`c2cb78f`](https://github.com/superhero/operations.superduper.solutions/commit/c2cb78fe80fdde078ec9d5216727424ef6f89a9e)

```text
docs: show main and develop as established parallel branches

```

<!-- changelog-commit:db78efc8dd15aa70c5aa227d579d0bdc952ebca4 -->
### Commit [`db78efc`](https://github.com/superhero/operations.superduper.solutions/commit/db78efc8dd15aa70c5aa227d579d0bdc952ebca4)

```text
docs: improve Git graph note contrast

```

<!-- changelog-commit:7b1a39dddf416e66831ae1673ef364fe3c7cbf39 -->
### Commit [`7b1a39d`](https://github.com/superhero/operations.superduper.solutions/commit/7b1a39dddf416e66831ae1673ef364fe3c7cbf39)

```text
docs: style graph notes with padded blue labels

```

<!-- changelog-commit:5b01b94055f944385678fd0b5d3696682e5ac962 -->
### Commit [`5b01b94`](https://github.com/superhero/operations.superduper.solutions/commit/5b01b94055f944385678fd0b5d3696682e5ac962)

```text
docs: point graph notes toward their commits

```

<!-- changelog-commit:415e939fc3589c75cf97b965f4e388825eb547cb -->
### Commit [`415e939`](https://github.com/superhero/operations.superduper.solutions/commit/415e939fc3589c75cf97b965f4e388825eb547cb)

```text
docs: add main and release to the development graph

```

<!-- changelog-commit:92f46587bf30dfccc2bf23de0247c7fbb71450eb -->
### Commit [`92f4658`](https://github.com/superhero/operations.superduper.solutions/commit/92f46587bf30dfccc2bf23de0247c7fbb71450eb)

```text
docs: branch the release after feature integration

```

<!-- changelog-commit:212a28b54e3d42012dc05f81bd5e0a56ca10e7d8 -->
### Commit [`212a28b`](https://github.com/superhero/operations.superduper.solutions/commit/212a28b54e3d42012dc05f81bd5e0a56ca10e7d8)

```text
docs: show release updates and final publication

Illustrate release updates after fix and documentation integration, then
publication to main. Note that CI does not yet accept the illustrated
develop-to-release PRs.

```

<!-- changelog-commit:7d1bd5c42d3021407f091ddeff9a0c9c825c2747 -->
### Commit [`7d1bd5c`](https://github.com/superhero/operations.superduper.solutions/commit/7d1bd5c42d3021407f091ddeff9a0c9c825c2747)

```text
docs: complete the release graph with main synchronization

```

<!-- changelog-commit:579d046e090a8c99dd329d7156d64398965c8992 -->
### Commit [`579d046`](https://github.com/superhero/operations.superduper.solutions/commit/579d046e090a8c99dd329d7156d64398965c8992)

```text
docs: simplify initial and release creation labels

```

<!-- changelog-commit:4b302b932d00d38f54d859fd37d4e53fe46681bc -->
### Commit [`4b302b9`](https://github.com/superhero/operations.superduper.solutions/commit/4b302b932d00d38f54d859fd37d4e53fe46681bc)

```text
docs: clarify release branch creation labels

```

<!-- changelog-commit:357ccc8bea75f245461cad4e56e50e285dda1ee5 -->
### Commit [`357ccc8`](https://github.com/superhero/operations.superduper.solutions/commit/357ccc8bea75f245461cad4e56e50e285dda1ee5)

```text
docs: label released versions as deployed

```

<!-- changelog-commit:b86196dcf47f109bc6f54d5db4db2c19181554ac -->
### Commit [`b86196d`](https://github.com/superhero/operations.superduper.solutions/commit/b86196dcf47f109bc6f54d5db4db2c19181554ac)

```text
docs: remove the initial development note from the graph

```

<!-- changelog-commit:786e8a01708461873f3687a25a35e148679e667b -->
### Commit [`786e8a0`](https://github.com/superhero/operations.superduper.solutions/commit/786e8a01708461873f3687a25a35e148679e667b)

```text
docs: tighten and brighten Git graph branch labels

```

<!-- changelog-commit:bb11506047fb4a4984c0c218ca21c2a402344f8d -->
### Commit [`bb11506`](https://github.com/superhero/operations.superduper.solutions/commit/bb11506047fb4a4984c0c218ca21c2a402344f8d)

```text
docs: restore dark Git graph branch labels

```

<!-- changelog-commit:863aca46edd1bf4d2c28dc024b44838d64cdf6ea -->
### Commit [`863aca4`](https://github.com/superhero/operations.superduper.solutions/commit/863aca46edd1bf4d2c28dc024b44838d64cdf6ea)

```text
docs: keep release fork connections visible

```

<!-- changelog-commit:7ad90aae4f05d21c2e3c8370914983af44dc4d85 -->
### Commit [`7ad90aa`](https://github.com/superhero/operations.superduper.solutions/commit/7ad90aae4f05d21c2e3c8370914983af44dc4d85)

```text
docs: make Git graph lane guides visible

```

<!-- changelog-commit:e0c0f841c76ceb96951629d22086962fc5af4f81 -->
### Commit [`e0c0f84`](https://github.com/superhero/operations.superduper.solutions/commit/e0c0f841c76ceb96951629d22086962fc5af4f81)

```text
docs: use red-orange for bugfix branches

```

<!-- changelog-commit:1e24c52a6ee1d99287291aa3954acba16e63eac8 -->
### Commit [`1e24c52`](https://github.com/superhero/operations.superduper.solutions/commit/1e24c52a6ee1d99287291aa3954acba16e63eac8)

```text
docs: remove the redundant release graph

```

<!-- changelog-commit:e9c2933969e7f7e74f0a16a3798b85e0eb5eae28 -->
### Commit [`e9c2933`](https://github.com/superhero/operations.superduper.solutions/commit/e9c2933969e7f7e74f0a16a3798b85e0eb5eae28)

```text
docs: tilt commit labels downward from graph nodes

```

<!-- changelog-commit:d8844d61ce4c5a48c403280c38108888aee26ad5 -->
### Commit [`d8844d6`](https://github.com/superhero/operations.superduper.solutions/commit/d8844d61ce4c5a48c403280c38108888aee26ad5)

```text
docs: make version tag labels bold

```

<!-- changelog-commit:dbaa87529d783e4f8c5eea71197ff70ad796d32b -->
### Commit [`dbaa875`](https://github.com/superhero/operations.superduper.solutions/commit/dbaa87529d783e4f8c5eea71197ff70ad796d32b)

```text
docs: lighten the Git graph branch palette

```

<!-- changelog-commit:17cf827f51e8ce527cb6769a8c72c4b515197163 -->
### Commit [`17cf827`](https://github.com/superhero/operations.superduper.solutions/commit/17cf827f51e8ce527cb6769a8c72c4b515197163)

```text
docs: use a consistent shape and tilt for commit labels

```

<!-- changelog-commit:ee1675d9b9531fe36610b9e89a5c605d4b7304fc -->
### Commit [`ee1675d`](https://github.com/superhero/operations.superduper.solutions/commit/ee1675d9b9531fe36610b9e89a5c605d4b7304fc)

```text
docs: give version tags a pale green background

```

<!-- changelog-commit:1519dfde21f8a901336fab6be552630f2e334df8 -->
### Commit [`1519dfd`](https://github.com/superhero/operations.superduper.solutions/commit/1519dfde21f8a901336fab6be552630f2e334df8)

```text
docs: set graph label backgrounds to 90 percent opacity

```

<!-- changelog-commit:56f7efea49febdae3ae9f62b4f6c6c6ebceeeea6 -->
### Commit [`56f7efe`](https://github.com/superhero/operations.superduper.solutions/commit/56f7efea49febdae3ae9f62b4f6c6c6ebceeeea6)

```text
docs: give documentation branches a dedicated Git graph

```

<!-- changelog-commit:0fe71d130dce479c5b6c1fb7a795d41960e0cc5b -->
### Commit [`0fe71d1`](https://github.com/superhero/operations.superduper.solutions/commit/0fe71d130dce479c5b6c1fb7a795d41960e0cc5b)

```text
docs: match branch label backgrounds to branch colors

```

<!-- changelog-commit:9c01ac99210def8da2ae1cbf29c7a17a8e487414 -->
### Commit [`9c01ac9`](https://github.com/superhero/operations.superduper.solutions/commit/9c01ac99210def8da2ae1cbf29c7a17a8e487414)

```text
docs: give hotfix branches a warm red-orange color

```

<!-- changelog-commit:dcdfaa00df5fcdaaf1471092b8b9dbb2222e77aa -->
### Commit [`dcdfaa0`](https://github.com/superhero/operations.superduper.solutions/commit/dcdfaa00df5fcdaaf1471092b8b9dbb2222e77aa)

```text
docs: show one documentation branch with explicit merge targets

```

<!-- changelog-commit:38882dd6ba88b84a2fe4183148e3f2da66e6a2d2 -->
### Commit [`38882dd`](https://github.com/superhero/operations.superduper.solutions/commit/38882dd6ba88b84a2fe4183148e3f2da66e6a2d2)

```text
docs: derive develop from main in the hotfix graph

```

<!-- changelog-commit:5fe6b7ee542b3df45ae86e6434bdcd35947a104a -->
### Commit [`5fe6b7e`](https://github.com/superhero/operations.superduper.solutions/commit/5fe6b7ee542b3df45ae86e6434bdcd35947a104a)

```text
docs: omit tag synchronization from the hotfix overview

```

<!-- changelog-commit:85487b7a6f73ade1d9382f0eeee9686bd018fe4e -->
### Commit [`85487b7`](https://github.com/superhero/operations.superduper.solutions/commit/85487b7a6f73ade1d9382f0eeee9686bd018fe4e)

```text
docs: show branch ancestry in the documentation graph

```

<!-- changelog-commit:3c1a138b623f9a55574d29fde90f946245725a1a -->
### Commit [`3c1a138`](https://github.com/superhero/operations.superduper.solutions/commit/3c1a138b623f9a55574d29fde90f946245725a1a)

```text
docs: show target-based documentation edits before release

```

<!-- changelog-commit:d3db6f706436e6190a17ce5c53682b800e722973 -->
### Commit [`d3db6f7`](https://github.com/superhero/operations.superduper.solutions/commit/d3db6f706436e6190a17ce5c53682b800e722973)

```text
docs: reuse one documentation branch across merge targets

```

<!-- changelog-commit:128a659e295fc3dfe0bb9b600a7c6ec36e38ece4 -->
### Commit [`128a659`](https://github.com/superhero/operations.superduper.solutions/commit/128a659e295fc3dfe0bb9b600a7c6ec36e38ece4)

```text
docs: show main synchronization between documentation merges

```

<!-- changelog-commit:34ab8899767f7cc367d750b13475d39e12f5ae37 -->
### Commit [`34ab889`](https://github.com/superhero/operations.superduper.solutions/commit/34ab8899767f7cc367d750b13475d39e12f5ae37)

```text
docs: publish release before synchronizing develop

```

<!-- changelog-commit:6b7e28a87773ed34dbe24aabc5772e415bca87df -->
### Commit [`6b7e28a`](https://github.com/superhero/operations.superduper.solutions/commit/6b7e28a87773ed34dbe24aabc5772e415bca87df)

```text
docs: remove the middle documentation edit from the graph

```

<!-- changelog-commit:2652623144d97e664c1529443eb55e5cfc3151c1 -->
### Commit [`2652623`](https://github.com/superhero/operations.superduper.solutions/commit/2652623144d97e664c1529443eb55e5cfc3151c1)

```text
docs: show hotfix merging only into main in the graph

```

<!-- changelog-commit:e41ec915a5d3cf9ee58ea06209364e046fcf934b -->
### Commit [`e41ec91`](https://github.com/superhero/operations.superduper.solutions/commit/e41ec915a5d3cf9ee58ea06209364e046fcf934b)

```text
docs: add hotfix publication through an active release

```

<!-- changelog-commit:0c93847b905320c1f9876ae127f82e7acf2bc404 -->
### Commit [`0c93847`](https://github.com/superhero/operations.superduper.solutions/commit/0c93847b905320c1f9876ae127f82e7acf2bc404)

```text
docs: remove the release lane from the direct hotfix graph

```

<!-- changelog-commit:42b3e2f1c26cbe0bceb118b4261183128ad0c89b -->
### Commit [`42b3e2f`](https://github.com/superhero/operations.superduper.solutions/commit/42b3e2f1c26cbe0bceb118b4261183128ad0c89b)

```text
docs: group branching graphs into three sections

```

<!-- changelog-commit:40027f637706114c412c4d1e5c88a0074b602900 -->
### Commit [`40027f6`](https://github.com/superhero/operations.superduper.solutions/commit/40027f637706114c412c4d1e5c88a0074b602900)

```text
docs: clarify documentation merges skip release and sync PRs

```

<!-- changelog-commit:f010d7f3fc1711cdb7a5cee4940d2be784797077 -->
### Commit [`f010d7f`](https://github.com/superhero/operations.superduper.solutions/commit/f010d7f3fc1711cdb7a5cee4940d2be784797077)

```text
docs: frame branching diagrams with explanations and separators

```

<!-- changelog-commit:8563d1a0ae88851f4a1b67684b3e3850553fd415 -->
### Commit [`8563d1a`](https://github.com/superhero/operations.superduper.solutions/commit/8563d1a0ae88851f4a1b67684b3e3850553fd415)

```text
docs: integrate CI policies into the diagram sections

```

<!-- changelog-commit:c554b5048990dd52b4609ba83c1f94f935c7d300 -->
### Commit [`c554b50`](https://github.com/superhero/operations.superduper.solutions/commit/c554b5048990dd52b4609ba83c1f94f935c7d300)

```text
docs: present the CI decision as an Important alert

```

<!-- changelog-commit:95f8786d6a1bfb7d878822c26657dc2897f20ee3 -->
### Commit [`95f8786`](https://github.com/superhero/operations.superduper.solutions/commit/95f8786d6a1bfb7d878822c26657dc2897f20ee3)

```text
docs: refine the CICD decision statement

```

<!-- changelog-commit:ff301a1036ee2c8144a6ba4a2e401cd8a60ec256 -->
### Commit [`ff301a1`](https://github.com/superhero/operations.superduper.solutions/commit/ff301a1036ee2c8144a6ba4a2e401cd8a60ec256)

```text
docs: align contributing with the CICD decision wording

```

<!-- changelog-commit:571d203a861ede6fd0be0fd0365614ab816968ef -->
### Commit [`571d203`](https://github.com/superhero/operations.superduper.solutions/commit/571d203a861ede6fd0be0fd0365614ab816968ef)

```text
docs: punctuate the CICD decision statement

```

<!-- changelog-commit:776e86a0350e1a91c9fe9369181145607fca77ac -->
### Commit [`776e86a`](https://github.com/superhero/operations.superduper.solutions/commit/776e86a0350e1a91c9fe9369181145607fca77ac)

```text
docs: tighten CICD explanations and remove repeated policies

```

<!-- changelog-commit:28ebba2bbe84ae126f978a25f4fadae1422b010e -->
### Commit [`28ebba2`](https://github.com/superhero/operations.superduper.solutions/commit/28ebba2bbe84ae126f978a25f4fadae1422b010e)

```text
docs: remove the remaining CICD separator

```

<!-- changelog-commit:ce3cffc232fe24f78f8a33ede580a80965fa324a -->
### Commit [`ce3cffc`](https://github.com/superhero/operations.superduper.solutions/commit/ce3cffc232fe24f78f8a33ede580a80965fa324a)

```text
docs: remove Mermaid rendering detail from CICD

```

<!-- changelog-commit:ddbe9459fffeed91a1191753f67f4d759356b434 -->
### Commit [`ddbe945`](https://github.com/superhero/operations.superduper.solutions/commit/ddbe9459fffeed91a1191753f67f4d759356b434)

```text
docs: make the CICD decision record self-contained

```

<!-- changelog-commit:bfecf0c6f08375fc980b748e07492541aa49a33b -->
### Commit [`bfecf0c`](https://github.com/superhero/operations.superduper.solutions/commit/bfecf0c6f08375fc980b748e07492541aa49a33b)

```text
docs: restore external CICD references

```

<!-- changelog-commit:72647725cd13292ab433053cf0ddb7c73a4665b4 -->
### Commit [`7264772`](https://github.com/superhero/operations.superduper.solutions/commit/72647725cd13292ab433053cf0ddb7c73a4665b4)

```text
docs: organize development and release explanations

```

<!-- changelog-commit:a6cc70ef14385917cc034468f5ffa77b1bd54f09 -->
### Commit [`a6cc70e`](https://github.com/superhero/operations.superduper.solutions/commit/a6cc70ef14385917cc034468f5ffa77b1bd54f09)

```text
docs: separate documentation branch reuse and automation

```

<!-- changelog-commit:dec8e4e26e139e56fd4921a83de60c1f90f3eaa0 -->
### Commit [`dec8e4e`](https://github.com/superhero/operations.superduper.solutions/commit/dec8e4e26e139e56fd4921a83de60c1f90f3eaa0)

```text
docs: illustrate fixes made from an active release

```

<!-- changelog-commit:624b2a2a91c97a39d7e1d4bd97b56bd86bedfc1e -->
### Commit [`624b2a2`](https://github.com/superhero/operations.superduper.solutions/commit/624b2a2a91c97a39d7e1d4bd97b56bd86bedfc1e)

```text
docs: show full branch ancestry for release stabilization

```

<!-- changelog-commit:5d7ddea0448b153ed677f5a0a492c7b7b4305d0c -->
### Commit [`5d7ddea`](https://github.com/superhero/operations.superduper.solutions/commit/5d7ddea0448b153ed677f5a0a492c7b7b4305d0c)

```text
docs: place release fixes before the develop lane

```

<!-- changelog-commit:54e1cd5082a79b609cdf4027250e36c70f6c4f01 -->
### Commit [`54e1cd5`](https://github.com/superhero/operations.superduper.solutions/commit/54e1cd5082a79b609cdf4027250e36c70f6c4f01)

```text
docs: remove next-release marker from the hotfix diagram

Hide the develop anchor and its note so the direct hotfix path has no intermediate release marker. Mermaid still needs the anchor to render the final main-to-develop merge.

```

<!-- changelog-commit:f24d22c152d7fa1e3c399d7d89985fed38af2454 -->
### Commit [`f24d22c`](https://github.com/superhero/operations.superduper.solutions/commit/f24d22c152d7fa1e3c399d7d89985fed38af2454)

```text
docs: remove the initial marker from the documentation graph

Keep an invisible root for Mermaid branch connections while omitting its commit marker and initial version tag.

```

<!-- changelog-commit:a4b8d43a46cc8044b4725798bbc3676d64a43eff -->
### Commit [`a4b8d43`](https://github.com/superhero/operations.superduper.solutions/commit/a4b8d43a46cc8044b4725798bbc3676d64a43eff)

```text
docs: remove the initial develop commit from the docs graph

```

<!-- changelog-commit:dacd0ed21a0cd8f6845cdb07b982aee22b26cba2 -->
### Commit [`dacd0ed`](https://github.com/superhero/operations.superduper.solutions/commit/dacd0ed21a0cd8f6845cdb07b982aee22b26cba2)

```text
docs: omit develop ancestry from the stabilization graph

```

<!-- changelog-commit:cc0df47d1ec516d2697a985c87b01ea2c370ada4 -->
### Commit [`cc0df47`](https://github.com/superhero/operations.superduper.solutions/commit/cc0df47d1ec516d2697a985c87b01ea2c370ada4)

```text
docs: split documentation graphs by merge target

Show separate docs branches returning to develop, release, and main. Mark release support as planned and preserve the Markdown-only validation and publication restrictions.

```

<!-- changelog-commit:e48dd4a94de63d7b518e715c0ee72ed3656625d6 -->
### Commit [`e48dd4a`](https://github.com/superhero/operations.superduper.solutions/commit/e48dd4a94de63d7b518e715c0ee72ed3656625d6)

```text
docs: correct develop ancestry in release and hotfix graphs

```

<!-- changelog-commit:924a38d61452447275e75a6bef0354b478463314 -->
### Commit [`924a38d`](https://github.com/superhero/operations.superduper.solutions/commit/924a38d61452447275e75a6bef0354b478463314)

```text
docs: restore the release cycle in the develop docs graph

Show documentation merging into develop before release publication and synchronization. Omit the later direct docs-to-main change, keeping the separate release and main documentation diagrams.

```

<!-- changelog-commit:d3c969e3c2f34386bcbee3df44f86c562fa3a244 -->
### Commit [`d3c969e`](https://github.com/superhero/operations.superduper.solutions/commit/d3c969e3c2f34386bcbee3df44f86c562fa3a244)

```text
docs: simplify the hotfix synchronization connection

Hide the develop anchor stem so the diagram shows only the incoming main-to-develop merge. Keep the structural anchor required by Mermaid.

```

<!-- changelog-commit:5f900eaa92aa3382e50f5016b6d5a1635570eec2 -->
### Commit [`5f900ea`](https://github.com/superhero/operations.superduper.solutions/commit/5f900eaa92aa3382e50f5016b6d5a1635570eec2)

```text
docs: show documentation branching from the develop lane

Add an invisible develop anchor so Mermaid draws the documentation fork from develop instead of their shared main commit. Keep the initial develop marker hidden.

```

<!-- changelog-commit:1096e0e9868700ea9512e22fda1e227d5c3da416 -->
### Commit [`1096e0e`](https://github.com/superhero/operations.superduper.solutions/commit/1096e0e9868700ea9512e22fda1e227d5c3da416)

```text
docs: omit develop ancestry from the release hotfix graph

```

<!-- changelog-commit:4edb2761ccf3ddff07784d4c658314d6977c24c0 -->
### Commit [`4edb276`](https://github.com/superhero/operations.superduper.solutions/commit/4edb2761ccf3ddff07784d4c658314d6977c24c0)

```text
docs: show the develop fork node without main ancestry

```

<!-- changelog-commit:e81173875d803396680f234eb324e635f863fdf5 -->
### Commit [`e811738`](https://github.com/superhero/operations.superduper.solutions/commit/e81173875d803396680f234eb324e635f863fdf5)

```text
docs: omit develop ancestry from the overview graph

```

<!-- changelog-commit:a62c4b2527541e9edc38f2c381c1a4103a9ff510 -->
### Commit [`a62c4b2`](https://github.com/superhero/operations.superduper.solutions/commit/a62c4b2527541e9edc38f2c381c1a4103a9ff510)

```text
docs: remove the initial main marker from the overview

Hide the initial main commit and omit its version tag while preserving the structural anchor Mermaid needs for release publication.

```

<!-- changelog-commit:a9878911efe243317cb9ba706e9a7785b6ccef38 -->
### Commit [`a987891`](https://github.com/superhero/operations.superduper.solutions/commit/a9878911efe243317cb9ba706e9a7785b6ccef38)

```text
docs: align plain main and develop starts in the overview

Hide the initial develop marker and trim one commit interval from the main stem. Preserve the remaining diagram positions and merge connections.

```

<!-- changelog-commit:659b82e4577cb2eee10d55bece21e2302074ecc6 -->
### Commit [`659b82e`](https://github.com/superhero/operations.superduper.solutions/commit/659b82e4577cb2eee10d55bece21e2302074ecc6)

```text
docs: extend develop to the original main baseline

Restore the full main stem and extend only the first develop segment by one commit interval. Keep both initial markers hidden and preserve all later positions.

```

<!-- changelog-commit:7e56e8f015fba639e305fdb210b3d532a0c16bc1 -->
### Commit [`7e56e8f`](https://github.com/superhero/operations.superduper.solutions/commit/7e56e8f015fba639e305fdb210b3d532a0c16bc1)

```text
docs: restore the feature fork node in the overview

```

<!-- changelog-commit:d5b035a70d3474376149076613ecda94344d6cdd -->
### Commit [`d5b035a`](https://github.com/superhero/operations.superduper.solutions/commit/d5b035a70d3474376149076613ecda94344d6cdd)

```text
docs: align plain branch starts in the stabilization graph

Match the overview with separate main and develop stems at the same baseline, preserving the visible release fork and later merge sequence.

```

<!-- changelog-commit:e0b6ea1950d7a5c34410f8b198c51f2474ff153b -->
### Commit [`e0b6ea1`](https://github.com/superhero/operations.superduper.solutions/commit/e0b6ea1950d7a5c34410f8b198c51f2474ff153b)

```text
docs: extend develop before the release hotfix fork

```

<!-- changelog-commit:403c7089dee423a1deedefb17bdbc2ca4bcc0a91 -->
### Commit [`403c708`](https://github.com/superhero/operations.superduper.solutions/commit/403c7089dee423a1deedefb17bdbc2ca4bcc0a91)

```text
docs: show develop continuation in the direct hotfix graph

```

<!-- changelog-commit:d1e0b8ce7bd4f71fff1f93ed292af8584acaa4a3 -->
### Commit [`d1e0b8c`](https://github.com/superhero/operations.superduper.solutions/commit/d1e0b8ce7bd4f71fff1f93ed292af8584acaa4a3)

```text
docs: align plain main and develop starts in the docs graph

```

<!-- changelog-commit:91cbd99f8c50539b169541d8028e6a812e4a1b1b -->
### Commit [`91cbd99`](https://github.com/superhero/operations.superduper.solutions/commit/91cbd99f8c50539b169541d8028e6a812e4a1b1b)

```text
docs: show the full release cycle for release documentation

Mirror the development documentation graph with docs branching from and returning to the release branch before publication and synchronization. Keep release-target documentation support marked as planned.

```

<!-- changelog-commit:a2da2cdc307a4d44f4b5c5192cc1846967a2af28 -->
### Commit [`a2da2cd`](https://github.com/superhero/operations.superduper.solutions/commit/a2da2cdc307a4d44f4b5c5192cc1846967a2af28)

```text
docs: show permanent branches continuing beyond final merges

Extend main and develop upward with aligned plain ends, preserving all existing forks and merges. Continue main in the documentation-only diagram as well, keeping layout anchors and their labels hidden.

```

<!-- changelog-commit:bb67b46167c69c8af764b687b70d4475bdf534df -->
### Commit [`bb67b46`](https://github.com/superhero/operations.superduper.solutions/commit/bb67b46167c69c8af764b687b70d4475bdf534df)

```text
docs(cicd): shorten upward branch continuations

```

<!-- changelog-commit:47213668abaa9d4243d599a91ed25f0b45c7aa5c -->
### Commit [`4721366`](https://github.com/superhero/operations.superduper.solutions/commit/47213668abaa9d4243d599a91ed25f0b45c7aa5c)

```text
docs(cicd): continue hotfix and main docs lanes below their forks

```

<!-- changelog-commit:8f7bf4e500f5cc8485ce01c64c4e4e96f87889c8 -->
### Commit [`8f7bf4e`](https://github.com/superhero/operations.superduper.solutions/commit/8f7bf4e500f5cc8485ce01c64c4e4e96f87889c8)

```text
docs(cicd): clarify diagram conventions and merge rules

```

<!-- changelog-commit:cba7d3f988da676f5d72293247e72985e963477b -->
### Commit [`cba7d3f`](https://github.com/superhero/operations.superduper.solutions/commit/cba7d3f988da676f5d72293247e72985e963477b)

```text
docs(cicd): tighten initial hotfix commit spacing

```

<!-- changelog-commit:92dd3222d16ee8461109adbb4ab9d1310bd71070 -->
### Commit [`92dd322`](https://github.com/superhero/operations.superduper.solutions/commit/92dd3222d16ee8461109adbb4ab9d1310bd71070)

```text
docs(adr): separate integration and deployment decisions

```

<!-- changelog-commit:1b1ab1257dc8bb2508399262aa248575b7debdfd -->
### Commit [`1b1ab12`](https://github.com/superhero/operations.superduper.solutions/commit/1b1ab1257dc8bb2508399262aa248575b7debdfd)

```text
docs(adr): expand integration and deployment filenames

```

<!-- changelog-commit:1c57d272c6c9c16c782ede24b8a6e8dbc1e576ee -->
### Commit [`1c57d27`](https://github.com/superhero/operations.superduper.solutions/commit/1c57d272c6c9c16c782ede24b8a6e8dbc1e576ee)

```text
docs(deployment): explain Cloudflare hosting and report storage

```

<!-- changelog-commit:e8b12ff3b232900feb3c0cd5efbabd064de68206 -->
### Commit [`e8b12ff`](https://github.com/superhero/operations.superduper.solutions/commit/e8b12ff3b232900feb3c0cd5efbabd064de68206)

```text
docs(deployment): condense the deployment decision

```

<!-- changelog-commit:0df16f28d48268727eb2d670d596a4b3693b01de -->
### Commit [`0df16f2`](https://github.com/superhero/operations.superduper.solutions/commit/0df16f28d48268727eb2d670d596a4b3693b01de)

```text
docs(ci): name GitHub Actions as the automation platform

```

<!-- changelog-commit:6039354b2abe6217075eada939de6927bf4fa8f6 -->
### Commit [`6039354`](https://github.com/superhero/operations.superduper.solutions/commit/6039354b2abe6217075eada939de6927bf4fa8f6)

```text
docs(workers): condense the ADR into focused sections

```

<!-- changelog-commit:98c24c556c60342df790db7d6cb98ec6e1f67485 -->
### Commit [`98c24c5`](https://github.com/superhero/operations.superduper.solutions/commit/98c24c556c60342df790db7d6cb98ec6e1f67485)

```text
docs(deployment): add concise subsection headings

```

<!-- changelog-commit:178848fecea060a3c214feff3634fd4e1d5c369e -->
### Commit [`178848f`](https://github.com/superhero/operations.superduper.solutions/commit/178848fecea060a3c214feff3634fd4e1d5c369e)

```text
docs(errors): condense the ADR into readable sections

```

<!-- changelog-commit:2314786eee14aabf5fc2285e02237f03cf6e62fd -->
### Commit [`2314786`](https://github.com/superhero/operations.superduper.solutions/commit/2314786eee14aabf5fc2285e02237f03cf6e62fd)

```text
docs(licensing): simplify the introduction and heading

```

<!-- changelog-commit:2e99c6a7507ba515a9c25920ab256f0e19046ee9 -->
### Commit [`2e99c6a`](https://github.com/superhero/operations.superduper.solutions/commit/2e99c6a7507ba515a9c25920ab256f0e19046ee9)

```text
docs(errors): emphasize transparent error reporting

```

<!-- changelog-commit:ce8de18dc7dad1f6672878e71dfc9b1b17d73bfe -->
### Commit [`ce8de18`](https://github.com/superhero/operations.superduper.solutions/commit/ce8de18dc7dad1f6672878e71dfc9b1b17d73bfe)

```text
docs(storage): clarify local versioning and recovery decisions

```

<!-- changelog-commit:3f012ffa9a990b4db062293ad62cc4efcd9cbecc -->
### Commit [`3f012ff`](https://github.com/superhero/operations.superduper.solutions/commit/3f012ffa9a990b4db062293ad62cc4efcd9cbecc)

```text
docs(openapi): clarify schema management and workflow adaptation

```

<!-- changelog-commit:24bacb1d6732eb05d20675ad50e4da0dabd455f9 -->
### Commit [`24bacb1`](https://github.com/superhero/operations.superduper.solutions/commit/24bacb1d6732eb05d20675ad50e4da0dabd455f9)

```text
docs(metrics): clarify resource monitoring and retention

```

<!-- changelog-commit:bb38c3c7e53d0f4186c9f3916ac7fcec88607e35 -->
### Commit [`bb38c3c`](https://github.com/superhero/operations.superduper.solutions/commit/bb38c3c7e53d0f4186c9f3916ac7fcec88607e35)

```text
docs(architecture): structure responsibility segregation

```

<!-- changelog-commit:1a9f1dc82e2a3167b2c7e0b9c4649d50ac665aa8 -->
### Commit [`1a9f1dc`](https://github.com/superhero/operations.superduper.solutions/commit/1a9f1dc82e2a3167b2c7e0b9c4649d50ac665aa8)

```text
docs: clarify runtime secrets decision structure

```

<!-- changelog-commit:6cb391b38ccdf2ddd853d783d4a6777f0cff6e88 -->
### Commit [`6cb391b`](https://github.com/superhero/operations.superduper.solutions/commit/6cb391b38ccdf2ddd853d783d4a6777f0cff6e88)

```text
docs: format simplicity decision and principle notes

```

<!-- changelog-commit:5772d47197eaac865c23be3960e2bcec7c4aba67 -->
### Commit [`5772d47`](https://github.com/superhero/operations.superduper.solutions/commit/5772d47197eaac865c23be3960e2bcec7c4aba67)

```text
docs: condense Svelte interface architecture decision

```

<!-- changelog-commit:00a1c569bbf5af87ab028975ac46d7813e41efa5 -->
### Commit [`00a1c56`](https://github.com/superhero/operations.superduper.solutions/commit/00a1c569bbf5af87ab028975ac46d7813e41efa5)

```text
docs: clarify Cucumber reporting and coverage standards

Require each test case to appear in shared Cucumber results, including unit
and smoke tests. Separate complete validation from partial diagnostics and
retain the scoped coverage requirement and pending standalone-test migration.

```

<!-- changelog-commit:75f1ad8dfad20bdf594168876f1a69ec65c2671b -->
### Commit [`75f1ad8`](https://github.com/superhero/operations.superduper.solutions/commit/75f1ad8dfad20bdf594168876f1a69ec65c2671b)

```text
docs: focus test reporting ADR on core requirements

```

<!-- changelog-commit:0ef19cfa6165beacdce298d52a669791a743e732 -->
### Commit [`0ef19cf`](https://github.com/superhero/operations.superduper.solutions/commit/0ef19cfa6165beacdce298d52a669791a743e732)

```text
docs: make repository automation guide easier to navigate

Separate procedures, safeguards and recovery into concise subsections and
comparison tables. Preserve existing heading anchors and operational rules,
link the relevant ADRs, and add report commands and browser prerequisites.

```

<!-- changelog-commit:163dbcc5d7d11a66274fad79f4eef438780e2856 -->
### Commit [`163dbcc`](https://github.com/superhero/operations.superduper.solutions/commit/163dbcc5d7d11a66274fad79f4eef438780e2856)

```text
docs: record why architectural decisions are maintained

Preserve project reasoning and continuity in a concise ADR covering purpose,
record scope, format and maintenance. Add it to the alphabetical contribution
index so contributors can find the decision alongside the other ADRs.

```

<!-- changelog-commit:01f0ab23708b30d04742b3876678ce5195190280 -->
### Commit [`01f0ab2`](https://github.com/superhero/operations.superduper.solutions/commit/01f0ab23708b30d04742b3876678ce5195190280)

```text
docs: document directory responsibilities and contributor boundaries

Add directory guides for source, components, domain services, tests, automation
and architecture records, with a root project map and relevant ADR links.
Explain placement rules, runtime boundaries and the Cucumber reporting standard.

Keep src/public guidance in its parent README because Vite copies that directory
verbatim and the release contract permits only index.html and _headers.
Preserve existing automation procedures and font provenance.

```

<!-- changelog-commit:bcca07158effd810764071cac8667415c0983f15 -->
### Commit [`bcca071`](https://github.com/superhero/operations.superduper.solutions/commit/bcca07158effd810764071cac8667415c0983f15)

```text
docs: highlight ADR guidance in a contribution note

```

<!-- changelog-commit:237a2f6760e17330c1ab1cca7060081b05d8a520 -->
### Commit [`237a2f6`](https://github.com/superhero/operations.superduper.solutions/commit/237a2f6760e17330c1ab1cca7060081b05d8a520)

```text
docs: align develop with the restored project README

```

<!-- changelog-commit:effd5b9f628c481059df59c4176cf02900b4cf61 -->
### Commit [`effd5b9`](https://github.com/superhero/operations.superduper.solutions/commit/effd5b9f628c481059df59c4176cf02900b4cf61)

```text
docs: remove project structure from root README

```

<!-- changelog-commit:15adfa34c10f9cc1e216ef1332782e1c85a002e5 -->
### Commit [`15adfa3`](https://github.com/superhero/operations.superduper.solutions/commit/15adfa34c10f9cc1e216ef1332782e1c85a002e5)

```text
docs: restore root README as the repository landing page

Rename the automation directory guide so GitHub no longer displays it in place of the root README. Preserve the project badges, command dropdowns and development note, and update the guide link.

```

<!-- changelog-commit:b68904b41b69e48e2f797f919c47958b898cd77a -->
### Commit [`b68904b`](https://github.com/superhero/operations.superduper.solutions/commit/b68904b41b69e48e2f797f919c47958b898cd77a)

```text
chore: refresh dependency badges
```

<!-- changelog-commit:fb4c127fc87e17717692dd030444c5dd7f1a14f8 -->
### Commit [`fb4c127`](https://github.com/superhero/operations.superduper.solutions/commit/fb4c127fc87e17717692dd030444c5dd7f1a14f8)

```text
feat(workflows): route edges around nodes with synchronized dashes

Port the orthogonal routing module into a bounded dedicated worker while
preserving measured handle attachment, connection snapping and curved paths.
Share dash phases in world coordinates and let Workflow settings control
node clearance without persisting generated routes.

Retain body-avoiding fallbacks in crowded layouts, reject obsolete worker
replies, and preserve previews when connections are released. Include the
reference regressions and browser checks with the scoped coverage contract.

```

<!-- changelog-commit:82e42906cbf188277675f4dd1d6603af6b797c62 -->
### Commit [`82e4290`](https://github.com/superhero/operations.superduper.solutions/commit/82e42906cbf188277675f4dd1d6603af6b797c62)

```text
test(browser): isolate JSON review from metric cache updates

Compare operation drafts and all non-metric local storage while allowing the background recorder to refresh its cache. Add a deterministic Cucumber regression and refresh scenario badges.

```

<!-- changelog-commit:79476a0b2b8da5d42742c0488bcc22e5507970c5 -->
### Commit [`79476a0`](https://github.com/superhero/operations.superduper.solutions/commit/79476a0b2b8da5d42742c0488bcc22e5507970c5)

```text
chore: refresh dependency badges
```

<!-- changelog-commit:1639f8ac6570c5faac5937e727365c8a0a6a0736 -->
### Commit [`1639f8a`](https://github.com/superhero/operations.superduper.solutions/commit/1639f8ac6570c5faac5937e727365c8a0a6a0736)

```text
chore(release): prepare 0.0.42

Fold Staging into 0.0.42.

```

## 0.0.41

<!-- changelog-commit:b9aee00069a6c5740bc2ac1a272fe9826a2a519d -->
### Commit [`b9aee00`](https://github.com/superhero/operations.superduper.solutions/commit/b9aee00069a6c5740bc2ac1a272fe9826a2a519d)

```text
feat(ci): add markdown-only documentation integration

Give docs/* pull requests a trusted Markdown-only path to develop or main,
without tests, builds, releases, deployments, or branch synchronization.
Inspect complete Git diffs, including both rename paths and file modes,
before granting merge credentials.

Preserve guarded merge behavior, protect active production releases, and
exclude documentation branches from dependency checks and badge commits.
Include the scoped Actions event policy and normal-CI rollout guidance.

```

## 0.0.40

<!-- changelog-commit:6a3afd5a07925eda2acbfab5dfe19a43757f185b -->
### Commit [`6a3afd5`](https://github.com/superhero/operations.superduper.solutions/commit/6a3afd5a07925eda2acbfab5dfe19a43757f185b)

```text
fix: document and badge all direct dependencies

Document the six runtime packages missing from the README and generate version badges from both dependency groups. Validate complete README coverage, runtime-only manifests, and conflicting package declarations.

```

<!-- changelog-commit:a03f56d83f3c014bd01aed42dc7f527eec9f398f -->
### Commit [`a03f56d`](https://github.com/superhero/operations.superduper.solutions/commit/a03f56d83f3c014bd01aed42dc7f527eec9f398f)

```text
docs: relocate automation documentation

Move validation and CI guidance from CONTRIBUTING into the workflows README, with topic headings and navigation. Keep the existing guidance and link to it from the contributing guide.

```

## 0.0.39

<!-- changelog-commit:5081f7618147615f1f80d8d517a7dee19d09f146 -->
### Commit [`5081f76`](https://github.com/superhero/operations.superduper.solutions/commit/5081f7618147615f1f80d8d517a7dee19d09f146)

```text
feat(ui): refine operation execution and theme selection

Connect the Operation action to the shared HTTP executor and show real
responses, errors and retry controls. Both catalogs send requests to their
declared service, while fixtures remain explicitly isolated in tests.

Align catalog navigation, phase states and reports around the selected
operation. Propose the top five matches plus every result above 50%, expose
schema server URLs in metadata, and improve JSON layout and scope feedback.

Group themes in a collapsible Settings section with revised palettes and an
animated selection award. Keep header content aligned while its background
spans the page, and refine shared spacing, colors and pane transitions.

Preserve operation IDs, saved workflows and palette preference keys. These
interactions share UI state, semantic roles and browser assertions, so their
source, documentation and tests are recorded together.

```

<!-- changelog-commit:4890c87759d2f59c53e074d6b0e4667c18429093 -->
### Commit [`4890c87`](https://github.com/superhero/operations.superduper.solutions/commit/4890c87759d2f59c53e074d6b0e4667c18429093)

```text
feat(workflow): add browser-local history and refine the editor

Persist each workflow in its own Git repository on a shared IndexedDB
filesystem. Autosave completed edits, preserve abandoned redo history,
and expose useful change messages and non-destructive restoration.

Move theme and workflow settings to IndexedDB and add storage metrics.
Refine node ports, additive selection, center snapping, toolbar actions,
and workflow dialogs. Stabilize prompt overflow and synchronize pane
height with animated reports to prevent clipped controls.

Cover repository recovery, migration, isolation, editor behavior, and
settings in browser tests; keep pure application logic at full coverage.

```

<!-- changelog-commit:015c06a7764561bb7cc0a817a74863546060a986 -->
### Commit [`015c06a`](https://github.com/superhero/operations.superduper.solutions/commit/015c06a7764561bb7cc0a817a74863546060a986)

```text
test(ui): stabilize animation and box-selection checks

Observe short animations inside the page before triggering input, so
browser transport delays cannot miss the transition. Retain halfway
content and interpolation assertions before exercising cancellation.

Keep selection rectangles inside the visible gap between operation and
schema nodes after Fit View, preserving exact selected-node assertions.

```

<!-- changelog-commit:6fb7036f6ebfaa02df1957457e651dba661f853d -->
### Commit [`6fb7036`](https://github.com/superhero/operations.superduper.solutions/commit/6fb7036f6ebfaa02df1957457e651dba661f853d)

```text
fix(workflow): recover interrupted saves before newer drafts

Catalogue finalization can fail after Git has committed an edit. Retain
that exact submitted snapshot and expected revision, recover it first,
and only then save the newer editor draft against the recovered revision.
Keep unresolved attempts dirty and clear them when changing documents.

Preserve the existing stale-tab conflict checks instead of adopting the
latest repository revision blindly. Cover interrupted finalization,
continued editing, one-click retry, and both historical snapshots in the
browser regression.

```

<!-- changelog-commit:bca49a923f80ebf464fc042f24af98c07224a091 -->
### Commit [`bca49a9`](https://github.com/superhero/operations.superduper.solutions/commit/bca49a923f80ebf464fc042f24af98c07224a091)

```text
feat: expand browser-local workflow editing and settings

Add independent Git-backed schema management, worker-backed persistence,
resource history, locale settings, and themed development diagnostics.

Model HTTP response envelopes and editable additional properties, arrange
new workflow trees using measured node sizes, and refine editor controls,
dialogs, loading transitions, and saved-workflow management.

Update browser and source regressions, centralize Node coverage scope, and
include isolation headers and logging dependencies in release publication.

```

<!-- changelog-commit:05e3c501c3b73e5555c95a5d08391502b4514f00 -->
### Commit [`05e3c50`](https://github.com/superhero/operations.superduper.solutions/commit/05e3c501c3b73e5555c95a5d08391502b4514f00)

```text
test: isolate coverage report fixture configuration

```

<!-- changelog-commit:6b2f2878f04d19cc1ac33c8a4818d3c3b579e647 -->
### Commit [`6b2f287`](https://github.com/superhero/operations.superduper.solutions/commit/6b2f2878f04d19cc1ac33c8a4818d3c3b579e647)

```text
test: await mobile navigation after workspace changes

Workspace selection already closes the mobile menu. Wait for that transition before the helper attempts a manual close, preserving manual dismissal for an already selected workspace.

```

<!-- changelog-commit:a5835d9298a5af69abae22c1d65641aeb25ca525 -->
### Commit [`a5835d9`](https://github.com/superhero/operations.superduper.solutions/commit/a5835d9298a5af69abae22c1d65641aeb25ca525)

```text
fix(ci): allow guarded release stabilization pull requests

```

<!-- changelog-commit:0c71a0ee8276a235a2d50c5e2af66dedbf10cd77 -->
### Commit [`0c71a0e`](https://github.com/superhero/operations.superduper.solutions/commit/0c71a0ee8276a235a2d50c5e2af66dedbf10cd77)

```text
test: sample disclosure transitions deterministically

```

<!-- changelog-commit:5e800983620c206fa3c02c623ef2e1c2c58e7b92 -->
### Commit [`5e80098`](https://github.com/superhero/operations.superduper.solutions/commit/5e800983620c206fa3c02c623ef2e1c2c58e7b92)

```text
fix: interpolate workflow dashes and stabilize motion checks

```

## 0.0.38

<!-- changelog-commit:c4ec62078a6eb725d5387c8e73f0dd955f5a7379 -->
### Commit [`c4ec620`](https://github.com/superhero/operations.superduper.solutions/commit/c4ec62078a6eb725d5387c8e73f0dd955f5a7379)

```text
test: wait for prompt examples to reappear after resizing

The visible narrow-screen prefix already fits a widened panel before the
ResizeObserver restores hidden examples. Wait for the full example row
before checking geometry, order and focus so CI does not assert stale state.

```

## 0.0.37

<!-- changelog-commit:c3cb00fe85328a17c1f69bcbeb26e28d7924a98c -->
### Commit [`c3cb00f`](https://github.com/superhero/operations.superduper.solutions/commit/c3cb00fe85328a17c1f69bcbeb26e28d7924a98c)

```text
fix: label the test report CI link with its run ID

Supply an HTML anchor through the reporter's existing customData.ciPipeline
field before report generation. Keep the CI Pipeline heading and full run
URL, displaying only the run ID as the link text. Validate the HTTPS run
URL and escape its attribute value; local reports omit absent CI metadata.

Extend the existing report-generation regression test to check the link.
No report post-processing, dependency, workflow, README or coverage changes.

Validation: both modified files pass Node syntax checks and 11 focused
metadata assertions pass. Full reporter generation and Cucumber tests were
not run locally because the dependencies are unavailable.
```

<!-- changelog-commit:6054c7aa926915852ae1acf46cb277fe81149d02 -->
### Commit [`6054c7a`](https://github.com/superhero/operations.superduper.solutions/commit/6054c7aa926915852ae1acf46cb277fe81149d02)

```text
fix: simplify test report metadata and capture browser identity

Display seven-character commit hashes and suppress the Username field.
Clear the footer through the reporter's pageFooter and customStyle options.
Keep the existing run-ID CI link and standalone report wrapper unchanged.

Capture Playwright's actual browser name and version in Cucumber hooks on
every browser scenario, including successful runs and parallel workers.
Pass this through native feature metadata before report generation without
rewriting generated HTML or changing original Cucumber results. Consume
metadata-only attachments without displaying them; preserve screenshots
and diagnostics. Label known non-browser suites Not applicable, and reject
invalid or conflicting browser metadata rather than inventing an identity.

Extend the existing report regression scenario for these changes. No new
scenarios, dependencies, workflows, README or coverage-report changes.

Validation: all three modified files pass Node syntax and whitespace
checks. Thirteen focused local tests pass for metadata extraction, hook
capture, scoping, original-input preservation, invalid/conflicting data,
and reporter configuration. These tests use a stubbed reporter and browser;
full reporter rendering, Cucumber and real-browser validation remain
pending because dependencies are unavailable in this environment.
```

<!-- changelog-commit:604ce3296ccdeac0b639bed41f4eb9500820b227 -->
### Commit [`604ce32`](https://github.com/superhero/operations.superduper.solutions/commit/604ce3296ccdeac0b639bed41f4eb9500820b227)

```text
docs: clarify README workflow usage and development guidance
```

<!-- changelog-commit:7f332e7165a8ca74eded969f48513a4d267b28be -->
### Commit [`7f332e7`](https://github.com/superhero/operations.superduper.solutions/commit/7f332e7165a8ca74eded969f48513a4d267b28be)

```text
docs: simplify README and document npm commands by use case
```

<!-- changelog-commit:6a06ca7d42faea3128b477d80af7fa94b1ebb968 -->
### Commit [`6a06ca7`](https://github.com/superhero/operations.superduper.solutions/commit/6a06ca7d42faea3128b477d80af7fa94b1ebb968)

```text
docs: restore README sections and limit simplification scope

Undo the unrelated README removals from 7f332e7. Restore Development status,
Quality Assurance, dependency descriptions, and TypeScript upgrade tracking
from 604ce32 without rewriting their content.

Keep the pre-release note below the introduction and npm command guidance
above Development status, replacing only the former introductory block.
```

<!-- changelog-commit:17acc8bcbe77e268fbed5075337a93d1b6806272 -->
### Commit [`17acc8b`](https://github.com/superhero/operations.superduper.solutions/commit/17acc8bcbe77e268fbed5075337a93d1b6806272)

```text
docs: generalize README contributing reference
```

<!-- changelog-commit:79a86afceecf804a9c10b66737de1678328744b5 -->
### Commit [`79a86af`](https://github.com/superhero/operations.superduper.solutions/commit/79a86afceecf804a9c10b66737de1678328744b5)

```text
docs: consolidate README npm guidance into one command table
```

<!-- changelog-commit:fc78ebd3bd7c2da727e895e8196cae5a0a397c6d -->
### Commit [`fc78ebd`](https://github.com/superhero/operations.superduper.solutions/commit/fc78ebd3bd7c2da727e895e8196cae5a0a397c6d)

```text
docs: make npm command reference collapsible
```

<!-- changelog-commit:b69e6ff0c88e74da926364bf12f64a90978c38c0 -->
### Commit [`b69e6ff`](https://github.com/superhero/operations.superduper.solutions/commit/b69e6ff0c88e74da926364bf12f64a90978c38c0)

```text
docs: preserve dependency badge label
```

<!-- changelog-commit:b7d432bc679af056a86c69160dda2dd30546c352 -->
### Commit [`b7d432b`](https://github.com/superhero/operations.superduper.solutions/commit/b7d432bc679af056a86c69160dda2dd30546c352)

```text
docs: fix important callouts inside collapsible npm commands
```

<!-- changelog-commit:6f301ce810f2e7b9d495381e4ec6d06d8d7d20b6 -->
### Commit [`6f301ce`](https://github.com/superhero/operations.superduper.solutions/commit/6f301ce810f2e7b9d495381e4ec6d06d8d7d20b6)

```text
docs: list npm command purposes and requirements
```

<!-- changelog-commit:5a0d2974db2f7fdaaed539a3a574a36999767f86 -->
### Commit [`5a0d297`](https://github.com/superhero/operations.superduper.solutions/commit/5a0d2974db2f7fdaaed539a3a574a36999767f86)

```text
chore: alphabetize npm commands and rename coverage script

Rename coverage to test:coverage without changing its implementation.
Sort package scripts and README command headings alphabetically.
Update the README, contribution instructions and release CI references.
```

<!-- changelog-commit:1ce8b32dad2555f6b4834c26e9c32c30453b4a49 -->
### Commit [`1ce8b32`](https://github.com/superhero/operations.superduper.solutions/commit/1ce8b32dad2555f6b4834c26e9c32c30453b4a49)

```text
fix: validate live target refs before automatic merges

Read and validate the canonical target ref instead of trusting potentially
stale PR base metadata. Recheck the live ref immediately before either
mutation and fail closed on missing, malformed or unavailable ref data.
Preserve verified dependency-badge advances, existing merge policies,
head identity checks, merge confirmation and deployment tree verification.

Extend existing merge regression checks with independent live-ref data and
22 stale/changing/malformed-ref assertions. Update release-wrapper fixtures
for the two additional canonical reads; scenario counts are unchanged.

Validation: reproduced the unsafe stale-base behavior with the original
script and verified rejection before any write with the patch. Executed
66 existing merge test cases plus 22 live-ref assertions using real shell
helpers and mocked GitHub responses, with a local step-registration shim.
These are focused checks, not a full local Cucumber run. Bash/Node syntax
and whitespace checks pass. Full automation and browser suites await CI.

This is the code-side correction, not an atomic check-and-merge operation.
Native squash/merge still needs server-side protection enforced for the
merging App. Keep the PR draft until that enforcement and CI are reviewed.
No coverage-report, README, workflow or repository-settings changes.
```

<!-- changelog-commit:0abf25d850d9aa8526813d11c90c9be440637791 -->
### Commit [`0abf25d`](https://github.com/superhero/operations.superduper.solutions/commit/0abf25d850d9aa8526813d11c90c9be440637791)

```text
fix: preserve navigation in standalone coverage reports

Replace coverage-single-html and its minification step with a local,
dependency-free packager that keeps each Istanbul page and its assets in
an isolated document. Route folders, files and named source-line anchors
through the outer document, including reload and browser history.

Add report:coverage for local generation and HTTP/file browser regression
fixtures. Leave README work and the Cucumber report generator unchanged.

Validation: Node syntax, deterministic bundle integrity, UTF-8/filename
preservation, invalid inputs, stale-output cleanup and secret redaction.
Browser navigation was blocked by the local browser policy. Browser and
full-suite validation, including scenario badge regeneration, remain
pending before a PR is opened.
```

<!-- changelog-commit:8e81fb42e4c4dc15dfc9f1c4c07490394f6549d6 -->
### Commit [`8e81fb4`](https://github.com/superhero/operations.superduper.solutions/commit/8e81fb42e4c4dc15dfc9f1c4c07490394f6549d6)

```text
fix: load standalone coverage pages safely over HTTP and local files

Integrate develop without rewriting branch history, preserving the npm
script rename, alphabetical ordering, report metadata and merge-base fix.

Replace blob page/resource URLs with srcdoc pages and embedded data URLs.
Bind handlers only to the expected loaded document and defer scrolling
until that document is ready. Retain the outer file/line hash navigation.

Keep the existing HTTP/file navigation assertions and exercise real output
from the installed c8 reporter in both scenarios, including sorting,
filtering, source lines, Unicode, reload and browser history. Reject blob
and unexpected resource requests. No extra dependencies or scenarios.

Local verification: JavaScript syntax and in-memory Chromium loading pass.
HTTP and file navigation are blocked by local browser policy; the draft
PR CI must verify both transports and the real c8 reporter before review.
```

<!-- changelog-commit:b3fb114c161a266520a9335758f1810ca49b4452 -->
### Commit [`b3fb114`](https://github.com/superhero/operations.superduper.solutions/commit/b3fb114c161a266520a9335758f1810ca49b4452)

```text
fix: embed inline coverage stylesheet resources
```

<!-- changelog-commit:f2194a8f3f76ccc68d3cfee9bf408266a92cd573 -->
### Commit [`f2194a8`](https://github.com/superhero/operations.superduper.solutions/commit/f2194a8f3f76ccc68d3cfee9bf408266a92cd573)

```text
fix: keep coverage navigation history in the outer report

Replace the iframe for each embedded page instead of navigating its
existing child history. Keep data-URL assets, expected-document guards,
and all HTTP/file Back/Forward regression assertions unchanged.
```

<!-- changelog-commit:73e6b4848864a84705e80c3806790ee4cdc3aa58 -->
### Commit [`73e6b48`](https://github.com/superhero/operations.superduper.solutions/commit/73e6b4848864a84705e80c3806790ee4cdc3aa58)

```text
revert: remove unnecessary coverage iframe history experiment

The downloaded CI artifact confirms both the fixture and real c8
navigation steps, including Back/Forward, passed in the srcdoc loader.
The failure was the sort-arrow stylesheet resource already fixed in
b3fb114. Keep that smaller implementation and all navigation assertions.
```

<!-- changelog-commit:b254a6f0dfcdd105216ed13c24fd024e2f32d1bb -->
### Commit [`b254a6f`](https://github.com/superhero/operations.superduper.solutions/commit/b254a6f0dfcdd105216ed13c24fd024e2f32d1bb)

```text
test: update scenario badges after coverage report validation

Record 656 passing scenarios from CI run 37998939955: 140 source,
4 acceptance, 331 automation and 181 browser. The browser suite includes
both HTTP and local-file coverage scenarios, each testing the edge-case
fixture and actual installed c8 output with no unexpected resource loads.

Counts were verified from the same run's job logs and downloaded
Cucumber automation/browser artifacts. Update only the two badge messages,
preserving the generator's format. No fabricated source/acceptance report
inputs were used; those suite totals were verified from their job logs.

The prior revert restored the exact repository tree tested at b3fb114.
This commit changes no executable code, tests, workflow or README.
```

<!-- changelog-commit:a51ec56624aa3ee67c8ddcaa5f7f2fafe07a3c14 -->
### Commit [`a51ec56`](https://github.com/superhero/operations.superduper.solutions/commit/a51ec56624aa3ee67c8ddcaa5f7f2fafe07a3c14)

```text
chore: refresh dependency badges
```

<!-- changelog-commit:011ec677f4225d43f8c4f93945a9cb14964b4191 -->
### Commit [`011ec67`](https://github.com/superhero/operations.superduper.solutions/commit/011ec677f4225d43f8c4f93945a9cb14964b4191)

```text
chore: refresh dependency badges
```

## 0.0.36

<!-- changelog-commit:62ef6dc90b554dde5fadf2bd1c647cd3545a9a9c -->
### Commit [`62ef6dc`](https://github.com/superhero/operations.superduper.solutions/commit/62ef6dc90b554dde5fadf2bd1c647cd3545a9a9c)

```text
docs: rename documentation directory to docs

```

<!-- changelog-commit:5bd4bd1dbefee84e24382074bae3e92fa49d173b -->
### Commit [`5bd4bd1`](https://github.com/superhero/operations.superduper.solutions/commit/5bd4bd1dbefee84e24382074bae3e92fa49d173b)

```text
chore: refresh dependency badges
```

<!-- changelog-commit:e9be1f2d93659357c79791e02a42b5272adb9b34 -->
### Commit [`e9be1f2`](https://github.com/superhero/operations.superduper.solutions/commit/e9be1f2d93659357c79791e02a42b5272adb9b34)

```text
chore: refresh dependency badges
```

<!-- changelog-commit:11683df503cca2732168a7645575c7bf241f5f41 -->
### Commit [`11683df`](https://github.com/superhero/operations.superduper.solutions/commit/11683df503cca2732168a7645575c7bf241f5f41)

```text
feat: add OpenAPI operation workspaces and executable workflows

Replace the initial canvas prototype with prompt-based operation discovery,
schema-driven inputs and reports, and a workflow editor with typed field
connections, reusable saved plans, utility nodes, and explicit execution.

Keep example.com requests local and mocked while offering a separate
httpbin catalog for live request testing. Preserve legacy operation IDs
in saved workflows and validate imported documents before using them.

Apply shared six-color palettes across light and dark modes, bundle the
licensed fonts, and make navigation, forms, tooltips, JSON disclosures,
and canvas controls usable across desktop and mobile layouts.

Gate the built standalone application with browser scenarios alongside
the source, acceptance, and automation suites. Include browser results
in release reports and scenario badges so the deployed bundle receives
the same behavioral checks as the local application.

```

<!-- changelog-commit:22803d0aa0bb8710ff8eb0fddbfdb21e04ea6f6f -->
### Commit [`22803d0`](https://github.com/superhero/operations.superduper.solutions/commit/22803d0aa0bb8710ff8eb0fddbfdb21e04ea6f6f)

```text
chore: refresh dependency badges
```

<!-- changelog-commit:a0a907a1f6c3dbf9c242a1b24ccee0ed80d93bfc -->
### Commit [`a0a907a`](https://github.com/superhero/operations.superduper.solutions/commit/a0a907a1f6c3dbf9c242a1b24ccee0ed80d93bfc)

```text
chore: refresh dependency badges
```

## 0.0.35

<!-- changelog-commit:ca806cc67d55798f14a4268c131f740001a42620 -->
### Commit [`ca806cc`](https://github.com/superhero/operations.superduper.solutions/commit/ca806cc67d55798f14a4268c131f740001a42620)

```text
fix: use GitHub-recognized code of conduct filename

```

<!-- changelog-commit:3c9e308e3f37ccf9b8ac8110259eef50753377b0 -->
### Commit [`3c9e308`](https://github.com/superhero/operations.superduper.solutions/commit/3c9e308e3f37ccf9b8ac8110259eef50753377b0)

```text
docs: remove development preview link from README

```

<!-- changelog-commit:9b9310643ddccf048b36e0636f0470d7698b9790 -->
### Commit [`9b93106`](https://github.com/superhero/operations.superduper.solutions/commit/9b9310643ddccf048b36e0636f0470d7698b9790)

```text
chore: refresh dependency badges
```

<!-- changelog-commit:63c2098e77b921b042c785ee7b2dd03a15fff5b6 -->
### Commit [`63c2098`](https://github.com/superhero/operations.superduper.solutions/commit/63c2098e77b921b042c785ee7b2dd03a15fff5b6)

```text
chore: refresh dependency badges
```

## 0.0.34

<!-- changelog-commit:d56ae64d82662bcfd528106fcb7fec8457cf5362 -->
### Commit [`d56ae64`](https://github.com/superhero/operations.superduper.solutions/commit/d56ae64d82662bcfd528106fcb7fec8457cf5362)

```text
docs: add empty conduct file

```

<!-- changelog-commit:69578866a499312eb9675e611c9abad6d8762650 -->
### Commit [`6957886`](https://github.com/superhero/operations.superduper.solutions/commit/69578866a499312eb9675e611c9abad6d8762650)

```text
Add Code of Conduct document

This document outlines the project's Code of Conduct, detailing expected behaviors, restricted behaviors, reporting procedures, and enforcement measures.

Signed-off-by: Erik Landvall <superhero@superduper.solutions>
```

<!-- changelog-commit:9ec3aa8a4a04fce3d1c7ce0f071cc73ae7617c45 -->
### Commit [`9ec3aa8`](https://github.com/superhero/operations.superduper.solutions/commit/9ec3aa8a4a04fce3d1c7ce0f071cc73ae7617c45)

```text
Revise and condense Code of Conduct

Condensed the Code of Conduct to focus on key commitments, expected conduct, and prohibited behaviors while maintaining essential reporting and enforcement guidelines.

Signed-off-by: Erik Landvall <superhero@superduper.solutions>
```

<!-- changelog-commit:dcd9cb2eaa0312f34936f6efccf54de3470dad86 -->
### Commit [`dcd9cb2`](https://github.com/superhero/operations.superduper.solutions/commit/dcd9cb2eaa0312f34936f6efccf54de3470dad86)

```text
ci: preview branch builds and reuse unchanged Pages deployments

Publish tested bundles for develop and release/hotfix branches within
existing CI runs. Reuse the active Pages deployment when the final HTML
is unchanged, while preserving exact merge and branch freshness checks.

Use the same release artifact for preview and production. Verify Pages
completion before the GitHub App records success, and record failures
with deployment context. Cover reuse, supersession, retries, and API
failures in the shared Cucumber suite.

```

<!-- changelog-commit:b49bd08dc57b96b389327429c60dd59f0298c8d7 -->
### Commit [`b49bd08`](https://github.com/superhero/operations.superduper.solutions/commit/b49bd08dc57b96b389327429c60dd59f0298c8d7)

```text
fix(ci): use supported Pages deployment pagination

Limit Pages deployment queries to 25 entries after the live API rejected 100. Keep the response checks aligned and exercise full and empty pages in the existing Cucumber scenarios.

```

## 0.0.33

<!-- changelog-commit:b68dba1e1c72ab04b9f4a7da32cef243c998ae62 -->
### Commit [`b68dba1`](https://github.com/superhero/operations.superduper.solutions/commit/b68dba1e1c72ab04b9f4a7da32cef243c998ae62)

```text
ci: keep release validation and deployment in one run

Continue each release PR through confirmed merge, content verification,
tagging, deployment, and synchronization. Use artifacts from successful
jobs in the same run and the actual released SHA for all production writes.

Preserve draft validation and retries of already merged releases, including
queued merges and delayed GitHub metadata. Keep the release-creation PR
separate, prevent PR updates from cancelling deployment, and remove the
obsolete cross-run release and artifact discovery helpers.

```

<!-- changelog-commit:6a4a925020f37842cc6b16bcad401022abb18d9d -->
### Commit [`6a4a925`](https://github.com/superhero/operations.superduper.solutions/commit/6a4a925020f37842cc6b16bcad401022abb18d9d)

```text
fix(ci): confirm merges and accept safe retries

Request merges directly and require GitHub to confirm the exact PR and merge metadata before reporting success. Recheck both mutation paths and recognize already completed merges without another write, including lost-response races.

Preserve native failure reasons with branch, revision, timeout, and write-state context. Pass the expected source through each branch workflow and share the release confirmation deadline. Cover completion, identity changes, retries, and failures in the existing Cucumber suite.

```

<!-- changelog-commit:be8ad2f26ec4df4482aa9aa323ef0139f88fdb15 -->
### Commit [`be8ad2f`](https://github.com/superhero/operations.superduper.solutions/commit/be8ad2f26ec4df4482aa9aa323ef0139f88fdb15)

```text
refactor(ci): remove duplicate release merge polling

Let the shared merge helper own completion polling. Recheck the exact PR
once before publication, retaining the actual merge SHA and current-main
guards. Cover an unconfirmed final read in the existing Cucumber suite.

```

## 0.0.32

<!-- changelog-commit:89126de357b78da51a5c1b45c16dda3e6fc251bf -->
### Commit [`89126de`](https://github.com/superhero/operations.superduper.solutions/commit/89126de357b78da51a5c1b45c16dda3e6fc251bf)

```text
docs: clarify test badges and simplify the README

Rename the scenario badge to Test Scenarios and group test badges under
Quality Assurance. Remove redundant report and dependency explanations.

```

<!-- changelog-commit:322759615c85cee1f4a4aa6f57f3eb6cd8b63a97 -->
### Commit [`3227596`](https://github.com/superhero/operations.superduper.solutions/commit/322759615c85cee1f4a4aa6f57f3eb6cd8b63a97)

```text
docs: explain quality reports and refine README headings

```

<!-- changelog-commit:e5889bc4aec8a685ba092d28dd696fbc0521bcb7 -->
### Commit [`e5889bc`](https://github.com/superhero/operations.superduper.solutions/commit/e5889bc4aec8a685ba092d28dd696fbc0521bcb7)

```text
docs: describe CI integration and quality reports

```

<!-- changelog-commit:5b7826954c3c460a773fa4acc0ff9a1209115c8e -->
### Commit [`5b78269`](https://github.com/superhero/operations.superduper.solutions/commit/5b7826954c3c460a773fa4acc0ff9a1209115c8e)

```text
docs: place development note above CI badges

```

<!-- changelog-commit:725dee427d9fd1b146672bb9684616d59d1b0356 -->
### Commit [`725dee4`](https://github.com/superhero/operations.superduper.solutions/commit/725dee427d9fd1b146672bb9684616d59d1b0356)

```text
docs: show main CI before develop CI

```

<!-- changelog-commit:a83cfd87bcc8e2d9babb5646c3dc7ae8cc663544 -->
### Commit [`a83cfd8`](https://github.com/superhero/operations.superduper.solutions/commit/a83cfd87bcc8e2d9babb5646c3dc7ae8cc663544)

```text
docs: explain project usage of each dependency

Describe how the UI, build, and validation workflows use each package.
Correct the optional peer relationship of tailwind-merge with the
installed tailwind-variants version.

```

<!-- changelog-commit:e3f7b3ff9dd9390371dcfa891169f9d903c48f7c -->
### Commit [`e3f7b3f`](https://github.com/superhero/operations.superduper.solutions/commit/e3f7b3ff9dd9390371dcfa891169f9d903c48f7c)

```text
build: remove unused tailwind-merge dependency

The installed tailwind-variants and cn packages provide the class-merging implementations used by the webpage. Remove the unused external package together with its README entry and version badge.

```

<!-- changelog-commit:a5690fcfcf1c92a4c90a57021e41de3a67ee715b -->
### Commit [`a5690fc`](https://github.com/superhero/operations.superduper.solutions/commit/a5690fcfcf1c92a4c90a57021e41de3a67ee715b)

```text
ci: preserve Gitflow across badge and hotfix synchronization

Refresh branch-local dependency SVG colours from the scheduled npm check.
Publish only changed badges through the existing App, bind writes to the
checked commit, and skip badge-only main pushes during deployment. Shared
revision guards allow verified badge updates without accepting untested
code or superseded releases.

Synchronize released hotfixes into active releases through the existing
main workflow, restoring their branch at the tagged merge when necessary.
Keep source-content, version-reservation, and support patch-line checks
while allowing released hotfixes to reach their intended targets. Document
the separate protected-branch rules and unchanged version policy.

Keep the coupled workflow, guard, Cucumber, and generated badge changes
together so branch automation and its checked reports remain consistent.

```

<!-- changelog-commit:e4f9155ad6c199e4359c75f7830a3b9c1da69ffa -->
### Commit [`e4f9155`](https://github.com/superhero/operations.superduper.solutions/commit/e4f9155ad6c199e4359c75f7830a3b9c1da69ffa)

```text
docs: explain the TypeScript upgrade compatibility constraint

```

<!-- changelog-commit:e31159ab7464fef2e81836354e824d9a1ca1148a -->
### Commit [`e31159a`](https://github.com/superhero/operations.superduper.solutions/commit/e31159ab7464fef2e81836354e824d9a1ca1148a)

```text
docs: track upstream TypeScript 7 compatibility status

```

<!-- changelog-commit:0a030a8228552bde240686e85e24c5aebdd58c61 -->
### Commit [`0a030a8`](https://github.com/superhero/operations.superduper.solutions/commit/0a030a8228552bde240686e85e24c5aebdd58c61)

```text
docs: simplify the TypeScript compatibility note

```

<!-- changelog-commit:03e3b73aec4c3004b1ecf3e9787106906f3ab5c7 -->
### Commit [`03e3b73`](https://github.com/superhero/operations.superduper.solutions/commit/03e3b73aec4c3004b1ecf3e9787106906f3ab5c7)

```text
chore(deps): update cucumber and lucide

Upgrade Cucumber to 13.3.0 and Lucide Svelte to 1.52.0 with their lockfile entries and dependency badges.

```

<!-- changelog-commit:f38267352eac6c468c74c5efdb12ac8e2caafbf1 -->
### Commit [`f382673`](https://github.com/superhero/operations.superduper.solutions/commit/f38267352eac6c468c74c5efdb12ac8e2caafbf1)

```text
fix(ci): prefer fast-forward integration and preserve release history

Fast-forward validated single-commit feature and production hotfix PRs; squash their other changes. Preserve ancestry for releases and synchronization, using merge commits when fast-forwarding is unavailable.

Confirm indirect PR merges before resolving release artifacts, retain release preparation and hotfix history across squash merges, and cover retries, stale heads, badge advances, and merge recognition with Cucumber.

```

## 0.0.31

<!-- changelog-commit:54c7d52de08d3e7a0eefe3c73a35dc7fa892cac3 -->
### Commit [`54c7d52`](https://github.com/superhero/operations.superduper.solutions/commit/54c7d52de08d3e7a0eefe3c73a35dc7fa892cac3)

```text
ci: report dependency checks for all branches in Actions

Discover repository branches dynamically and check their pinned revisions with
the automation from the workflow revision. Report outdated package versions in
job summaries and logs, retaining independent checks and useful error context.

Remove dependency status uploads to R2 and the remote README summary badges.
Keep package-version badges in the repository and preserve release coverage
publishing. Update Cucumber coverage and contributor documentation.

```

<!-- changelog-commit:9cfa325e487b88055bd9bd3428fcb1a4cba57144 -->
### Commit [`9cfa325`](https://github.com/superhero/operations.superduper.solutions/commit/9cfa325e487b88055bd9bd3428fcb1a4cba57144)

```text
ci: publish bundled test reports with branch badges

Combine source, acceptance, and automation results from the validated release head into one standalone Cucumber HTML report. Require and promote that report alongside coverage through the existing release workflow.

Keep coverage and scenario badges in the repository so their values follow the viewed branch, check them against test results before release, and link them to the published HTML reports. Stop uploading coverage badge JSON to R2.

```

## 0.0.30

<!-- changelog-commit:ce0164d2223271e8acb21482be7324b90a100e8a -->
### Commit [`ce0164d`](https://github.com/superhero/operations.superduper.solutions/commit/ce0164d2223271e8acb21482be7324b90a100e8a)

```text
ci: remove Actionlint from branch workflows

Keep ShellCheck and Cucumber automation checks in the existing branch workflows. Remove the Docker-based YAML lint step and its input metadata exceptions.

```

<!-- changelog-commit:fd8a3f5730eb50c09d76dd0d8258dcebf8262da0 -->
### Commit [`fd8a3f5`](https://github.com/superhero/operations.superduper.solutions/commit/fd8a3f5730eb50c09d76dd0d8258dcebf8262da0)

```text
ci: isolate dependency refreshes in a scheduled workflow

Run npm outdated for main and develop daily at 06:00 UTC or by manual
 dispatch through cron-outdated. Keep dependency refreshes off PR and push
 events so branch CI remains focused on validation and releases.

Share badge generation and publishing through a Bash helper with fresh
 temporary files, bounded redacted diagnostics, and Cucumber coverage.

```

<!-- changelog-commit:f3de151fce5973be41a24334ebed066f84c8d83c -->
### Commit [`f3de151`](https://github.com/superhero/operations.superduper.solutions/commit/f3de151fce5973be41a24334ebed066f84c8d83c)

```text
fix: keep dependency badges with their source revision

Store generated version badges with the code so branch and release READMEs
show their own declared dependencies. Validate the SVGs against the
manifest during CI and cover the README links with Cucumber.

Publish only the explicitly labelled main and develop freshness summaries
from the dependency cron. Name scheduled/manual runs and allow manual
launches from either branch without introducing bot commits.

```

<!-- changelog-commit:aadb34f13d22c8b3e491d6190d2e242fc95f0a4c -->
### Commit [`aadb34f`](https://github.com/superhero/operations.superduper.solutions/commit/aadb34f13d22c8b3e491d6190d2e242fc95f0a4c)

```text
fix: make badge argument validation explicit

Use an explicit conditional so the hosted runner ShellCheck accepts the
argument validation without suppressing SC2015.

```

## 0.0.29

<!-- changelog-commit:0c226df0c7f1213a5a2e5c176aa5f3e4e760ca77 -->
### Commit [`0c226df`](https://github.com/superhero/operations.superduper.solutions/commit/0c226df0c7f1213a5a2e5c176aa5f3e4e760ca77)

```text
ci: combine main validation and release deployment

Handle pull request checks and main-push deployment in ci-main.
Keep their jobs and cancellation groups independent, while preserving
validated artifact selection and serialized production writes.

Remove the separate deployment workflow and update guidance and badges.

```

<!-- changelog-commit:b208278950ae9b1bda043ac610a639875208a3a8 -->
### Commit [`b208278`](https://github.com/superhero/operations.superduper.solutions/commit/b208278950ae9b1bda043ac610a639875208a3a8)

```text
test: migrate automation checks to Cucumber

Use the existing Cucumber runner for release, Gitflow and status checks.
Consolidate repetitive cases into behavior scenarios and replace Python
fixtures with shared JavaScript command doubles that reject unexpected
requests while exercising the real shell scripts.

Emit compatible JSON reports and retain them in CI on success and failure
so automation results can join the application reports later.

```

<!-- changelog-commit:3674853193b93278fd09f4d48eeb664667a55495 -->
### Commit [`3674853`](https://github.com/superhero/operations.superduper.solutions/commit/3674853193b93278fd09f4d48eeb664667a55495)

```text
ci: give each target branch its own workflow

Separate develop, release and support CI while keeping the combined main
validation and deployment workflow. Each branch file owns its orchestration
and uses the shared Bash scripts for Gitflow and release operations.

Inline workflow checks, retain merge guards and reports, and update the
documentation, badge and narrowly scoped Actionlint workaround.

```

## 0.0.28

<!-- changelog-commit:bdedc486793b1fc2b297fd6d97446c28bc52fb2a -->
### Commit [`bdedc48`](https://github.com/superhero/operations.superduper.solutions/commit/bdedc486793b1fc2b297fd6d97446c28bc52fb2a)

```text
ci: trigger release deployment only when main changes

Resolve the merged release or hotfix PR from the exact pushed commit
before tagging and promoting its validated head artifacts. Reject missing
or ambiguous release identity with useful input context.

Closing a develop release-trigger PR no longer creates an empty CD run.
Keep app-owned writes, production freshness guards and normal Gitflow.

```

## 0.0.27

<!-- changelog-commit:dc92524dfbf47a2ced31af8a2a2fbcf02197c8b4 -->
### Commit [`dc92524`](https://github.com/superhero/operations.superduper.solutions/commit/dc92524dfbf47a2ced31af8a2a2fbcf02197c8b4)

```text
ci: simplify release automation and improve failure diagnostics

Consolidate branch validation and application checks, share Gitflow policy,
and promote the exact release artifacts through one production job. Use
the existing GitHub App for authored GitHub writes and share R2 publishing
without routine cleanup requests or duplicate summaries.

Bind automatic merges to the tested head and base, reserve versions across
merge-to-tag retries, and reject superseded production releases. Preserve
native failure reasons with relevant nonsecret context and retain failed
test reports. Document the app permissions and deployment retry behavior.

```

## 0.0.26

<!-- changelog-commit:54467e102afab0ae541761d9769ca107793daa9d -->
### Commit [`54467e1`](https://github.com/superhero/operations.superduper.solutions/commit/54467e102afab0ae541761d9769ca107793daa9d)

```text
chore: ignore local agent metadata

```

<!-- changelog-commit:71b7373efdf462d1cf9473ea46f8e5242c10ac90 -->
### Commit [`71b7373`](https://github.com/superhero/operations.superduper.solutions/commit/71b7373efdf462d1cf9473ea46f8e5242c10ac90)

```text
ci: make release workflows retry-safe

Reuse existing releases on retries and wait for completed release CI
before promoting its bundle and coverage artifacts.

Require coverage publishing inputs before merge, preserve producer cache
keys across partial retries, and serialize production promotion with
stale-release guards. Add offline regression tests and workflow linting.

```

## 0.0.25

<!-- changelog-commit:6e7afca8d90e408c970bf2c8f8914a6f095c7528 -->
### Commit [`6e7afca`](https://github.com/superhero/operations.superduper.solutions/commit/6e7afca8d90e408c970bf2c8f8914a6f095c7528)

```text
Leave release trigger PRs open
```

<!-- changelog-commit:62351c6c14f5dafe7d5f2dbd89856cccf07f8d5c -->
### Commit [`62351c6`](https://github.com/superhero/operations.superduper.solutions/commit/62351c6c14f5dafe7d5f2dbd89856cccf07f8d5c)

```text
Update multiple-cucumber-html-reporter to 4.4.2
```

<!-- changelog-commit:86c50f4b762d71000ab54a590e5bad8a1996f5de -->
### Commit [`86c50f4`](https://github.com/superhero/operations.superduper.solutions/commit/86c50f4b762d71000ab54a590e5bad8a1996f5de)

```text
Update package lock for multiple-cucumber-html-reporter 4.4.2
```

<!-- changelog-commit:f355aa4292b3abd48004d2e54e47228aaac86685 -->
### Commit [`f355aa4`](https://github.com/superhero/operations.superduper.solutions/commit/f355aa4292b3abd48004d2e54e47228aaac86685)

```text
Fix R2 publish error reporting
```

<!-- changelog-commit:02a9cf1d71ed16d2384d7726f01b1b536edbe1b1 -->
### Commit [`02a9cf1`](https://github.com/superhero/operations.superduper.solutions/commit/02a9cf1d71ed16d2384d7726f01b1b536edbe1b1)

```text
Ignore missing legacy R2 objects
```

## 0.0.24

<!-- changelog-commit:6c6c42586bce5d812967a85aa916a6aef4fff631 -->
### Commit [`6c6c425`](https://github.com/superhero/operations.superduper.solutions/commit/6c6c42586bce5d812967a85aa916a6aef4fff631)

```text
Explain generated releases on trigger PRs
```

<!-- changelog-commit:eed5b81f7c19486ad38cdd0f61f50780773b256d -->
### Commit [`eed5b81`](https://github.com/superhero/operations.superduper.solutions/commit/eed5b81f7c19486ad38cdd0f61f50780773b256d)

```text
Fix release trigger summary
```

## 0.0.23

<!-- changelog-commit:1e2ca669605074f52375b07877a02ebd3a994efd -->
### Commit [`1e2ca66`](https://github.com/superhero/operations.superduper.solutions/commit/1e2ca669605074f52375b07877a02ebd3a994efd)

```text
Publish test coverage report to R2
```

## 0.0.22

<!-- changelog-commit:48f96be22eb3594de41b737d8f2006e2a3e7825a -->
### Commit [`48f96be`](https://github.com/superhero/operations.superduper.solutions/commit/48f96be22eb3594de41b737d8f2006e2a3e7825a)

```text
Evaluate auto-merge after skipped validators
```

<!-- changelog-commit:73b87b120662492f2dd91614307c19195962f13b -->
### Commit [`73b87b1`](https://github.com/superhero/operations.superduper.solutions/commit/73b87b120662492f2dd91614307c19195962f13b)

```text
Evaluate auto-merge after skipped validators
```

<!-- changelog-commit:e1c6e1abbb782c53bcbc5a079105938ab52a9dfa -->
### Commit [`e1c6e1a`](https://github.com/superhero/operations.superduper.solutions/commit/e1c6e1abbb782c53bcbc5a079105938ab52a9dfa)

```text
Evaluate auto-merge after skipped validators
```

<!-- changelog-commit:98aa9fb605d3c7c6641bb1fd5e5d18fafad176f9 -->
### Commit [`98aa9fb`](https://github.com/superhero/operations.superduper.solutions/commit/98aa9fb605d3c7c6641bb1fd5e5d18fafad176f9)

```text
Evaluate auto-merge after skipped validators
```

<!-- changelog-commit:45170192b76bd93a6e2dad6de868641db97044db -->
### Commit [`4517019`](https://github.com/superhero/operations.superduper.solutions/commit/45170192b76bd93a6e2dad6de868641db97044db)

```text
Rename dependency status objects
```

<!-- changelog-commit:146b963b48902f0b1baddbffdebd67c4cffdb7cf -->
### Commit [`146b963`](https://github.com/superhero/operations.superduper.solutions/commit/146b963b48902f0b1baddbffdebd67c4cffdb7cf)

```text
Use explicit dependency status filenames
```

<!-- changelog-commit:140b40f5e238d7917fa3a076b10c3b26bb4618f2 -->
### Commit [`140b40f`](https://github.com/superhero/operations.superduper.solutions/commit/140b40f5e238d7917fa3a076b10c3b26bb4618f2)

```text
Clarify test coverage status job name
```

<!-- changelog-commit:2896b6ebdb246d8c1db441bb15394227cc059670 -->
### Commit [`2896b6e`](https://github.com/superhero/operations.superduper.solutions/commit/2896b6ebdb246d8c1db441bb15394227cc059670)

```text
Publish bundled test coverage report
```

<!-- changelog-commit:cd719643a691dabb52dedf0b22480955ef2552f6 -->
### Commit [`cd71964`](https://github.com/superhero/operations.superduper.solutions/commit/cd719643a691dabb52dedf0b22480955ef2552f6)

```text
Trigger dependency status republish
```

<!-- changelog-commit:5c3bf84444f02721304945e925dc2d8c11e31bcc -->
### Commit [`5c3bf84`](https://github.com/superhero/operations.superduper.solutions/commit/5c3bf84444f02721304945e925dc2d8c11e31bcc)

```text
Use GitHub App token for auto-merge
```

<!-- changelog-commit:3847c58732b1ae9c17df7c6034356e24e0cc0d95 -->
### Commit [`3847c58`](https://github.com/superhero/operations.superduper.solutions/commit/3847c58732b1ae9c17df7c6034356e24e0cc0d95)

```text
Use GitHub App token for auto-merge
```

<!-- changelog-commit:cae801b943f139eec89b5746ccf7fbcc095dba0e -->
### Commit [`cae801b`](https://github.com/superhero/operations.superduper.solutions/commit/cae801b943f139eec89b5746ccf7fbcc095dba0e)

```text
Use GitHub App token for auto-merge
```

<!-- changelog-commit:7fce48e3dcd6ab77d938fbadc5f13d853b3269c7 -->
### Commit [`7fce48e`](https://github.com/superhero/operations.superduper.solutions/commit/7fce48e3dcd6ab77d938fbadc5f13d853b3269c7)

```text
Use GitHub App token for auto-merge
```

<!-- changelog-commit:a991e1d9834e66fd08ee178843c5355099d47235 -->
### Commit [`a991e1d`](https://github.com/superhero/operations.superduper.solutions/commit/a991e1d9834e66fd08ee178843c5355099d47235)

```text
Use granted GitHub App permissions
```

<!-- changelog-commit:f95746e596b05871f53a312386505aa8df6c0db2 -->
### Commit [`f95746e`](https://github.com/superhero/operations.superduper.solutions/commit/f95746e596b05871f53a312386505aa8df6c0db2)

```text
Use granted GitHub App permissions
```

<!-- changelog-commit:eacf8a85fe1e26e991467da025bc3d10a6c033ba -->
### Commit [`eacf8a8`](https://github.com/superhero/operations.superduper.solutions/commit/eacf8a85fe1e26e991467da025bc3d10a6c033ba)

```text
Use granted GitHub App permissions
```

<!-- changelog-commit:1a13c7302344926abd186e2be724f8fac2f2762b -->
### Commit [`1a13c73`](https://github.com/superhero/operations.superduper.solutions/commit/1a13c7302344926abd186e2be724f8fac2f2762b)

```text
Use granted GitHub App permissions
```

<!-- changelog-commit:a98cdb266dc111e410751575d26aeae5119be9f5 -->
### Commit [`a98cdb2`](https://github.com/superhero/operations.superduper.solutions/commit/a98cdb266dc111e410751575d26aeae5119be9f5)

```text
Grant auto-merge token contents write
```

<!-- changelog-commit:8ac3edf688bd0075790f3a85198079e5eed83dcc -->
### Commit [`8ac3edf`](https://github.com/superhero/operations.superduper.solutions/commit/8ac3edf688bd0075790f3a85198079e5eed83dcc)

```text
Create releases from develop PRs
```

<!-- changelog-commit:b73cfd32a5781b6e1b424a79f85f2ced5333b775 -->
### Commit [`b73cfd3`](https://github.com/superhero/operations.superduper.solutions/commit/b73cfd32a5781b6e1b424a79f85f2ced5333b775)

```text
Remove deprecated GitHub App ID inputs
```

<!-- changelog-commit:fa9ede7cd04d8716c8791c24c362338a90979c60 -->
### Commit [`fa9ede7`](https://github.com/superhero/operations.superduper.solutions/commit/fa9ede7cd04d8716c8791c24c362338a90979c60)

```text
Use branch list for release existence check
```

## 0.0.20

<!-- changelog-commit:72136b11ca25bed4c2ca78064a4821cc53c0c964 -->
### Commit [`72136b1`](https://github.com/superhero/operations.superduper.solutions/commit/72136b11ca25bed4c2ca78064a4821cc53c0c964)

```text
chore: move frontend packages to devDependencies
```

<!-- changelog-commit:7ff3cd9605528d53afc95397427d0871366aaa89 -->
### Commit [`7ff3cd9`](https://github.com/superhero/operations.superduper.solutions/commit/7ff3cd9605528d53afc95397427d0871366aaa89)

```text
chore: update dependency classifications
```

<!-- changelog-commit:b3e39cae12d141914c8bcec0cde24a3eff7f4492 -->
### Commit [`b3e39ca`](https://github.com/superhero/operations.superduper.solutions/commit/b3e39cae12d141914c8bcec0cde24a3eff7f4492)

```text
docs: add version badges for dev dependencies
```

<!-- changelog-commit:6567b14b5794f89ad87a5ac91f34938b1ed8187f -->
### Commit [`6567b14`](https://github.com/superhero/operations.superduper.solutions/commit/6567b14b5794f89ad87a5ac91f34938b1ed8187f)

```text
docs: organize version badges in table
```

<!-- changelog-commit:454b1c5ecda148c4d8678d1dcae331042b21601d -->
### Commit [`454b1c5`](https://github.com/superhero/operations.superduper.solutions/commit/454b1c5ecda148c4d8678d1dcae331042b21601d)

```text
docs: simplify versions table
```

<!-- changelog-commit:c4f9e9882b1ed43f30e52c9cb2fca190d0574d1b -->
### Commit [`c4f9e98`](https://github.com/superhero/operations.superduper.solutions/commit/c4f9e9882b1ed43f30e52c9cb2fca190d0574d1b)

```text
docs: use compatible JSONPath for version badges
```

<!-- changelog-commit:5562002391098eb40703dc9d988c330cf6dcfffc -->
### Commit [`5562002`](https://github.com/superhero/operations.superduper.solutions/commit/5562002391098eb40703dc9d988c330cf6dcfffc)

```text
docs: simplify scoped package labels
```

<!-- changelog-commit:634e8939ceecfeb7752638d148a1599e76ff9cc2 -->
### Commit [`634e893`](https://github.com/superhero/operations.superduper.solutions/commit/634e8939ceecfeb7752638d148a1599e76ff9cc2)

```text
docs: sort version table alphabetically
```

<!-- changelog-commit:2cc664ee3f6429c0f9ff7a888656e83b4f940a2b -->
### Commit [`2cc664e`](https://github.com/superhero/operations.superduper.solutions/commit/2cc664ee3f6429c0f9ff7a888656e83b4f940a2b)

```text
docs: sort versions by visible package name
```

<!-- changelog-commit:4cded0a889dad4843000c5011e2c8c5918076dd8 -->
### Commit [`4cded0a`](https://github.com/superhero/operations.superduper.solutions/commit/4cded0a889dad4843000c5011e2c8c5918076dd8)

```text
docs: remove Node.js from package versions table
```

<!-- changelog-commit:06fc5b1a10f66abce2d33d2db720cc97ca186e68 -->
### Commit [`06fc5b1`](https://github.com/superhero/operations.superduper.solutions/commit/06fc5b1a10f66abce2d33d2db720cc97ca186e68)

```text
docs: rename package column to dependency
```

<!-- changelog-commit:b3724423cfd7aa8613ce788dfc78487132b9ed89 -->
### Commit [`b372442`](https://github.com/superhero/operations.superduper.solutions/commit/b3724423cfd7aa8613ce788dfc78487132b9ed89)

```text
docs: rename versions section to dependencies
```

<!-- changelog-commit:a37b337eb900ecba6fae21d9254c46da130fd554 -->
### Commit [`a37b337`](https://github.com/superhero/operations.superduper.solutions/commit/a37b337eb900ecba6fae21d9254c46da130fd554)

```text
docs: describe dependency usage
```

<!-- changelog-commit:6b291a0e66e740fa7ca944946b0bad6def53a902 -->
### Commit [`6b291a0`](https://github.com/superhero/operations.superduper.solutions/commit/6b291a0e66e740fa7ca944946b0bad6def53a902)

```text
docs: describe planned Cucumber HTML reporting
```

<!-- changelog-commit:cb914b2f6299452698e840a9cb638aee213fe50c -->
### Commit [`cb914b2`](https://github.com/superhero/operations.superduper.solutions/commit/cb914b2f6299452698e840a9cb638aee213fe50c)

```text
docs: refine Cucumber reporter description
```

<!-- changelog-commit:cc9e098747ceac0ff5be0c2b8669a9ac0d938170 -->
### Commit [`cc9e098`](https://github.com/superhero/operations.superduper.solutions/commit/cc9e098747ceac0ff5be0c2b8669a9ac0d938170)

```text
docs: clarify cn dependency purpose
```

<!-- changelog-commit:b593abae2e35b0b72aecf59a059fd42c75493128 -->
### Commit [`b593aba`](https://github.com/superhero/operations.superduper.solutions/commit/b593abae2e35b0b72aecf59a059fd42c75493128)

```text
docs: expand cn dependency description
```

<!-- changelog-commit:ff411f47e97defd97e7a4c62e1bcfac2c3e49173 -->
### Commit [`ff411f4`](https://github.com/superhero/operations.superduper.solutions/commit/ff411f47e97defd97e7a4c62e1bcfac2c3e49173)

```text
chore: remove unused direct dependencies
```

<!-- changelog-commit:c5f2e6f8508d81cd7f282424b30308311c3e3107 -->
### Commit [`c5f2e6f`](https://github.com/superhero/operations.superduper.solutions/commit/c5f2e6f8508d81cd7f282424b30308311c3e3107)

```text
chore: update lockfile for removed dependencies
```

<!-- changelog-commit:231654dd13bb5b0beb5192f8a8e4555bb7f1ad5b -->
### Commit [`231654d`](https://github.com/superhero/operations.superduper.solutions/commit/231654dd13bb5b0beb5192f8a8e4555bb7f1ad5b)

```text
docs: remove unused dependencies
```

<!-- changelog-commit:bc0918adaa951b18dc83b32e80f666d2e6547cd7 -->
### Commit [`bc0918a`](https://github.com/superhero/operations.superduper.solutions/commit/bc0918adaa951b18dc83b32e80f666d2e6547cd7)

```text
fix: restore tailwind-merge dependency
```

<!-- changelog-commit:e31c42283913fdfd0d0efeeaf38378e9bf6ccb91 -->
### Commit [`e31c422`](https://github.com/superhero/operations.superduper.solutions/commit/e31c42283913fdfd0d0efeeaf38378e9bf6ccb91)

```text
fix: restore tailwind-merge lock entry
```

<!-- changelog-commit:f0a8cee8b19ffe471ae7e72197d65074f16140c4 -->
### Commit [`f0a8cee`](https://github.com/superhero/operations.superduper.solutions/commit/f0a8cee8b19ffe471ae7e72197d65074f16140c4)

```text
docs: explain tailwind-merge dependency
```

<!-- changelog-commit:61bc002b4aa6315c91dfc419189d7750e1c8c1b2 -->
### Commit [`61bc002`](https://github.com/superhero/operations.superduper.solutions/commit/61bc002b4aa6315c91dfc419189d7750e1c8c1b2)

```text
docs: clarify shadcn-generated dependency usage
```

<!-- changelog-commit:fca75567cbdf332b42cbc0897c77faa66fba5bd7 -->
### Commit [`fca7556`](https://github.com/superhero/operations.superduper.solutions/commit/fca75567cbdf332b42cbc0897c77faa66fba5bd7)

```text
docs: shorten dependency version badge labels
```

<!-- changelog-commit:40801385ef3a498602aa2f696bd517e6bac793af -->
### Commit [`4080138`](https://github.com/superhero/operations.superduper.solutions/commit/40801385ef3a498602aa2f696bd517e6bac793af)

```text
docs: remove dependency badge labels
```

<!-- changelog-commit:89234a4a1727642e5c173c870c640485393fb5f6 -->
### Commit [`89234a4`](https://github.com/superhero/operations.superduper.solutions/commit/89234a4a1727642e5c173c870c640485393fb5f6)

```text
docs: use empty labels for dependency badges
```

<!-- changelog-commit:dae63d75366c6a87abdc8ecfbd855d99df6ad4f9 -->
### Commit [`dae63d7`](https://github.com/superhero/operations.superduper.solutions/commit/dae63d75366c6a87abdc8ecfbd855d99df6ad4f9)

```text
docs: combine dependency names with version badges
```

<!-- changelog-commit:0dd89a6e6c4dadbfe49968950633ff24910b5920 -->
### Commit [`0dd89a6`](https://github.com/superhero/operations.superduper.solutions/commit/0dd89a6e6c4dadbfe49968950633ff24910b5920)

```text
docs: show latest dependency versions
```

<!-- changelog-commit:36439dd436534f84212f7cf0329f309a510c91c5 -->
### Commit [`36439dd`](https://github.com/superhero/operations.superduper.solutions/commit/36439dd436534f84212f7cf0329f309a510c91c5)

```text
ci: publish current and latest dependency badges
```

<!-- changelog-commit:e4d85a415b3f5a2f03730680ac6c5511f1c735b1 -->
### Commit [`e4d85a4`](https://github.com/superhero/operations.superduper.solutions/commit/e4d85a415b3f5a2f03730680ac6c5511f1c735b1)

```text
docs: combine dependency versions in one badge
```

<!-- changelog-commit:dffbd41eeac3909f8a637b4671fb6612de73c427 -->
### Commit [`dffbd41`](https://github.com/superhero/operations.superduper.solutions/commit/dffbd41eeac3909f8a637b4671fb6612de73c427)

```text
ci: publish dependency badges for PR preview
```

<!-- changelog-commit:20cbc65666d3d561d52b6099304784f260307903 -->
### Commit [`20cbc65`](https://github.com/superhero/operations.superduper.solutions/commit/20cbc65666d3d561d52b6099304784f260307903)

```text
ci: restore dependency badge trigger
```

<!-- changelog-commit:77e85b1ef5d3a8dc22f0840f26b00fd7a5ba3e51 -->
### Commit [`77e85b1`](https://github.com/superhero/operations.superduper.solutions/commit/77e85b1ef5d3a8dc22f0840f26b00fd7a5ba3e51)

```text
docs: use collapsible dependency details
```

<!-- changelog-commit:9401ae31ce3473ec24be50b210a4418257a36dd1 -->
### Commit [`9401ae3`](https://github.com/superhero/operations.superduper.solutions/commit/9401ae31ce3473ec24be50b210a4418257a36dd1)

```text
docs: test text dependency summaries
```

<!-- changelog-commit:33a3c2ea650519fbc3c903beb35379f749b9637e -->
### Commit [`33a3c2e`](https://github.com/superhero/operations.superduper.solutions/commit/33a3c2ea650519fbc3c903beb35379f749b9637e)

```text
docs: pair dependency names with live version badges
```

<!-- changelog-commit:60a442218b82f9fd6affa14f2ff231b935981df5 -->
### Commit [`60a4422`](https://github.com/superhero/operations.superduper.solutions/commit/60a442218b82f9fd6affa14f2ff231b935981df5)

```text
docs: try standard npm version badges
```

<!-- changelog-commit:fa924d854e5114206c4b647bb5af8fefd70bf0cf -->
### Commit [`fa924d8`](https://github.com/superhero/operations.superduper.solutions/commit/fa924d854e5114206c4b647bb5af8fefd70bf0cf)

```text
test: remove jsdom from startup test
```

<!-- changelog-commit:9ad374fa39756be740aa92fc78f4c44cc1703641 -->
### Commit [`9ad374f`](https://github.com/superhero/operations.superduper.solutions/commit/9ad374fa39756be740aa92fc78f4c44cc1703641)

```text
chore: remove jsdom
```

<!-- changelog-commit:5c6c46697adb6be11350d8ed100d2c4a2fc4703c -->
### Commit [`5c6c466`](https://github.com/superhero/operations.superduper.solutions/commit/5c6c46697adb6be11350d8ed100d2c4a2fc4703c)

```text
chore: prune jsdom from lockfile
```

<!-- changelog-commit:2b3cba809e99ec86787acb5ffc04cefeb6b34731 -->
### Commit [`2b3cba8`](https://github.com/superhero/operations.superduper.solutions/commit/2b3cba809e99ec86787acb5ffc04cefeb6b34731)

```text
docs: remove jsdom dependency
```

<!-- changelog-commit:9bab272dbc2ed3ff7b660b022aaaf0cbb572a0fe -->
### Commit [`9bab272`](https://github.com/superhero/operations.superduper.solutions/commit/9bab272dbc2ed3ff7b660b022aaaf0cbb572a0fe)

```text
docs: align dependency badges with sub elements
```

<!-- changelog-commit:04abc137c006ccd9ff0138b47cd67ce42cdc2645 -->
### Commit [`04abc13`](https://github.com/superhero/operations.superduper.solutions/commit/04abc137c006ccd9ff0138b47cd67ce42cdc2645)

```text
docs: restore custom dependency badges in sub elements
```

<!-- changelog-commit:73d71d47fb4b953e10802a03ae160341c27d0e94 -->
### Commit [`73d71d4`](https://github.com/superhero/operations.superduper.solutions/commit/73d71d47fb4b953e10802a03ae160341c27d0e94)

```text
docs: simplify dependency version badges
```

<!-- changelog-commit:1afe0c72441d03216c5c0b72e72f5a2cdacc3d0d -->
### Commit [`1afe0c7`](https://github.com/superhero/operations.superduper.solutions/commit/1afe0c72441d03216c5c0b72e72f5a2cdacc3d0d)

```text
ci: restore dependency badge trigger
```

<!-- changelog-commit:37d868e8148177af0ee3563e3e17cebd45b898c5 -->
### Commit [`37d868e`](https://github.com/superhero/operations.superduper.solutions/commit/37d868e8148177af0ee3563e3e17cebd45b898c5)

```text
docs: refresh dependency badge cache
```

<!-- changelog-commit:6825f9d49aac5c77c8a93e7124aa03ac457a57b2 -->
### Commit [`6825f9d`](https://github.com/superhero/operations.superduper.solutions/commit/6825f9d49aac5c77c8a93e7124aa03ac457a57b2)

```text
docs: preserve scoped package names in badges
```

<!-- changelog-commit:c25607fa46880a2e0a98e7b79c4589a8224ea8b6 -->
### Commit [`c25607f`](https://github.com/superhero/operations.superduper.solutions/commit/c25607fa46880a2e0a98e7b79c4589a8224ea8b6)

```text
ci: restore dependency badge trigger
```

<!-- changelog-commit:71b940529b5a94dd3cb8b50727ae9d4679f5768a -->
### Commit [`71b9405`](https://github.com/superhero/operations.superduper.solutions/commit/71b940529b5a94dd3cb8b50727ae9d4679f5768a)

```text
docs: refresh scoped dependency badge labels
```

<!-- changelog-commit:893e0439bbb7c11766c183104a606225c4ebe8e3 -->
### Commit [`893e043`](https://github.com/superhero/operations.superduper.solutions/commit/893e0439bbb7c11766c183104a606225c4ebe8e3)

```text
docs: render dependencies as nested lists
```

<!-- changelog-commit:91f2c817ba12e105d0e95dcbb0a02ca1f413f33e -->
### Commit [`91f2c81`](https://github.com/superhero/operations.superduper.solutions/commit/91f2c817ba12e105d0e95dcbb0a02ca1f413f33e)

```text
docs: lower dependency badges in list
```

<!-- changelog-commit:2eddfc5f596d71f4b76f1a4ea7286d35b4bf8f4f -->
### Commit [`2eddfc5`](https://github.com/superhero/operations.superduper.solutions/commit/2eddfc5f596d71f4b76f1a4ea7286d35b4bf8f4f)

```text
docs: flatten dependency badges
```

<!-- changelog-commit:6e2bf6d8921dc2ca0371744a90d92b388dd368fe -->
### Commit [`6e2bf6d`](https://github.com/superhero/operations.superduper.solutions/commit/6e2bf6d8921dc2ca0371744a90d92b388dd368fe)

```text
docs: separate dependency entries
```

<!-- changelog-commit:d34c68d8e04ed2b0a4c520e248575f600f926fc1 -->
### Commit [`d34c68d`](https://github.com/superhero/operations.superduper.solutions/commit/d34c68d8e04ed2b0a4c520e248575f600f926fc1)

```text
docs: reorder status badges
```

<!-- changelog-commit:0ab1e85efc893c0d5db5962a33140ea95a3a4148 -->
### Commit [`0ab1e85`](https://github.com/superhero/operations.superduper.solutions/commit/0ab1e85efc893c0d5db5962a33140ea95a3a4148)

```text
docs: put develop gate first
```

<!-- changelog-commit:dd382a1188ef21066b2949e40c2f19e351183964 -->
### Commit [`dd382a1`](https://github.com/superhero/operations.superduper.solutions/commit/dd382a1188ef21066b2949e40c2f19e351183964)

```text
docs: move dependency status into section
```

<!-- changelog-commit:5c2978c52ea7b4e097ba67e4cfed9e80cfc8c739 -->
### Commit [`5c2978c`](https://github.com/superhero/operations.superduper.solutions/commit/5c2978c52ea7b4e097ba67e4cfed9e80cfc8c739)

```text
docs: place dependency status in heading
```

<!-- changelog-commit:5c907cee524b103f3938b1da143e04c5bf324a86 -->
### Commit [`5c907ce`](https://github.com/superhero/operations.superduper.solutions/commit/5c907cee524b103f3938b1da143e04c5bf324a86)

```text
docs: use dependency badge as section heading
```

<!-- changelog-commit:e92aa267dce44ba66d42306bc516aecb79a28540 -->
### Commit [`e92aa26`](https://github.com/superhero/operations.superduper.solutions/commit/e92aa267dce44ba66d42306bc516aecb79a28540)

```text
docs: remove overall dependency status badge
```

<!-- changelog-commit:5e80fc7f76cacfb1d6d4e987e431d29ff2d88b80 -->
### Commit [`5e80fc7`](https://github.com/superhero/operations.superduper.solutions/commit/5e80fc7f76cacfb1d6d4e987e431d29ff2d88b80)

```text
docs: remove redundant license section
```

<!-- changelog-commit:4b0881b917a6885e7ca1bf65da0e0ec7f78b5480 -->
### Commit [`4b0881b`](https://github.com/superhero/operations.superduper.solutions/commit/4b0881b917a6885e7ca1bf65da0e0ec7f78b5480)

```text
docs: move development status above dependencies
```

<!-- changelog-commit:7aab8ad7c0849204dabcecf75576ee602662e9e9 -->
### Commit [`7aab8ad`](https://github.com/superhero/operations.superduper.solutions/commit/7aab8ad7c0849204dabcecf75576ee602662e9e9)

```text
docs: make development status h3
```

<!-- changelog-commit:e8e6b0c43e6e043e49eb2cd53a5ac4f7d7f84b6e -->
### Commit [`e8e6b0c`](https://github.com/superhero/operations.superduper.solutions/commit/e8e6b0c43e6e043e49eb2cd53a5ac4f7d7f84b6e)

```text
docs: restore development status h2
```

<!-- changelog-commit:8c8f47c88d0f5b4478747e5f0ce30a4ecbe93e4d -->
### Commit [`8c8f47c`](https://github.com/superhero/operations.superduper.solutions/commit/8c8f47c88d0f5b4478747e5f0ce30a4ecbe93e4d)

```text
docs: adjust README heading hierarchy
```

<!-- changelog-commit:79ebd8e29d8483e171b9e47376629a052991cf89 -->
### Commit [`79ebd8e`](https://github.com/superhero/operations.superduper.solutions/commit/79ebd8e29d8483e171b9e47376629a052991cf89)

```text
docs: label website heading
```

<!-- changelog-commit:d86de303209df3a084ea0c95e4d8c9c450a17a13 -->
### Commit [`d86de30`](https://github.com/superhero/operations.superduper.solutions/commit/d86de303209df3a084ea0c95e4d8c9c450a17a13)

```text
docs: rename website heading to platform
```

<!-- changelog-commit:6edb6bacf7f00a01bd1ef23ea1ced13690a28d45 -->
### Commit [`6edb6ba`](https://github.com/superhero/operations.superduper.solutions/commit/6edb6bacf7f00a01bd1ef23ea1ced13690a28d45)

```text
docs: move status badges under development status
```

<!-- changelog-commit:49a7dd22f22d43c4ccf39beac5015d607df216ed -->
### Commit [`49a7dd2`](https://github.com/superhero/operations.superduper.solutions/commit/49a7dd22f22d43c4ccf39beac5015d607df216ed)

```text
docs: promote development status to h2
```

<!-- changelog-commit:367ff950a20284fd78bd619c4b7ddd83b9b92d34 -->
### Commit [`367ff95`](https://github.com/superhero/operations.superduper.solutions/commit/367ff950a20284fd78bd619c4b7ddd83b9b92d34)

```text
docs: simplify lucide description
```

<!-- changelog-commit:25ea600ca03ac769bddc22283141a8d801e1c228 -->
### Commit [`25ea600`](https://github.com/superhero/operations.superduper.solutions/commit/25ea600ca03ac769bddc22283141a8d801e1c228)

```text
docs: clarify lucide UI usage
```

<!-- changelog-commit:ad899eb2524d280047f052da32b34c0c05221d88 -->
### Commit [`ad899eb`](https://github.com/superhero/operations.superduper.solutions/commit/ad899eb2524d280047f052da32b34c0c05221d88)

```text
docs: refine lucide description
```

<!-- changelog-commit:f480022292bf196d8ddb29aeab2dd4dfd228ea73 -->
### Commit [`f480022`](https://github.com/superhero/operations.superduper.solutions/commit/f480022292bf196d8ddb29aeab2dd4dfd228ea73)

```text
docs: rename platform heading to application
```

<!-- changelog-commit:b853c6235149d413c08e60b35aec8be5e0b8de01 -->
### Commit [`b853c62`](https://github.com/superhero/operations.superduper.solutions/commit/b853c6235149d413c08e60b35aec8be5e0b8de01)

```text
docs: shorten application heading
```

<!-- changelog-commit:ad866b6848f88253fcb02697c8f2a3f44d42725f -->
### Commit [`ad866b6`](https://github.com/superhero/operations.superduper.solutions/commit/ad866b6848f88253fcb02697c8f2a3f44d42725f)

```text
ci: generate dependency update preview
```

<!-- changelog-commit:a496e2e29413fca9b3fbd019741595a759d4c183 -->
### Commit [`a496e2e`](https://github.com/superhero/operations.superduper.solutions/commit/a496e2e29413fca9b3fbd019741595a759d4c183)

```text
ci: trigger dependency update preview
```

<!-- changelog-commit:70fd1454f66bfebf78e2b32049dcfbb20f24647b -->
### Commit [`70fd145`](https://github.com/superhero/operations.superduper.solutions/commit/70fd1454f66bfebf78e2b32049dcfbb20f24647b)

```text
ci: apply dependency update preview
```

<!-- changelog-commit:2526e357aed59f1308f50ebc3d2574894aa65ae2 -->
### Commit [`2526e35`](https://github.com/superhero/operations.superduper.solutions/commit/2526e357aed59f1308f50ebc3d2574894aa65ae2)

```text
chore: update frontend dependencies

```

<!-- changelog-commit:94c3645606211e6d9616778e01ff740ee90b5ae9 -->
### Commit [`94c3645`](https://github.com/superhero/operations.superduper.solutions/commit/94c3645606211e6d9616778e01ff740ee90b5ae9)

```text
ci: remove dependency update preview
```

<!-- changelog-commit:95ef87c378829057f5ebfed9c3c8a93263986597 -->
### Commit [`95ef87c`](https://github.com/superhero/operations.superduper.solutions/commit/95ef87c378829057f5ebfed9c3c8a93263986597)

```text
ci: refresh dependency badges for preview
```

<!-- changelog-commit:a005e793649033f9511f1b8ac3489ccc30c87010 -->
### Commit [`a005e79`](https://github.com/superhero/operations.superduper.solutions/commit/a005e793649033f9511f1b8ac3489ccc30c87010)

```text
ci: restore dependency badge trigger
```

<!-- changelog-commit:346441e37be807561753f290a2a512cdd04328dd -->
### Commit [`346441e`](https://github.com/superhero/operations.superduper.solutions/commit/346441e37be807561753f290a2a512cdd04328dd)

```text
docs: quote development status
```

<!-- changelog-commit:0ffdf174438d08bb3e8534d3450ec54aa0d49f18 -->
### Commit [`0ffdf17`](https://github.com/superhero/operations.superduper.solutions/commit/0ffdf174438d08bb3e8534d3450ec54aa0d49f18)

```text
docs: use note alert for development status
```

<!-- changelog-commit:813a35eecf4f8cf90585283375d67309b02fab24 -->
### Commit [`813a35e`](https://github.com/superhero/operations.superduper.solutions/commit/813a35eecf4f8cf90585283375d67309b02fab24)

```text
docs: normalize dependency technology names
```

<!-- changelog-commit:c1124c3125542a697c85b4362de452fe678bf416 -->
### Commit [`c1124c3`](https://github.com/superhero/operations.superduper.solutions/commit/c1124c3125542a697c85b4362de452fe678bf416)

```text
fix: track production dependency status
```

<!-- changelog-commit:52e70ede381d5046ed6a543f936d610286451904 -->
### Commit [`52e70ed`](https://github.com/superhero/operations.superduper.solutions/commit/52e70ede381d5046ed6a543f936d610286451904)

```text
fix: publish production dependency badges from main
```

<!-- changelog-commit:c1fd0b9ebc0c1a915bcf7983fadd2616b9ede82d -->
### Commit [`c1fd0b9`](https://github.com/superhero/operations.superduper.solutions/commit/c1fd0b9ebc0c1a915bcf7983fadd2616b9ede82d)

```text
ci: publish develop dependency preview
```

<!-- changelog-commit:17e56a399040b6f26d1075037cff7ac89008d74a -->
### Commit [`17e56a3`](https://github.com/superhero/operations.superduper.solutions/commit/17e56a399040b6f26d1075037cff7ac89008d74a)

```text
ci: hand off coverage badge status
```

<!-- changelog-commit:82c9e7864ba770f95f6c84f9fd853bd94c742d2a -->
### Commit [`82c9e78`](https://github.com/superhero/operations.superduper.solutions/commit/82c9e7864ba770f95f6c84f9fd853bd94c742d2a)

```text
ci: publish validated coverage status
```

<!-- changelog-commit:583e80df4c18524b96030ed581f67ff2df76da96 -->
### Commit [`583e80d`](https://github.com/superhero/operations.superduper.solutions/commit/583e80df4c18524b96030ed581f67ff2df76da96)

```text
ci: preserve coverage badge on dependency deploy
```

<!-- changelog-commit:7a29319287e0acceec0837c75ea4fa916e79a7dc -->
### Commit [`7a29319`](https://github.com/superhero/operations.superduper.solutions/commit/7a29319287e0acceec0837c75ea4fa916e79a7dc)

```text
docs: serve coverage badge from Pages
```

<!-- changelog-commit:11f7f4ecceed39bee70fa0841ceb6e0222413aa5 -->
### Commit [`11f7f4e`](https://github.com/superhero/operations.superduper.solutions/commit/11f7f4ecceed39bee70fa0841ceb6e0222413aa5)

```text
chore: remove repository coverage badge data
```

<!-- changelog-commit:d8f8433e922afe6b9119126a84a06f96adff8dac -->
### Commit [`d8f8433`](https://github.com/superhero/operations.superduper.solutions/commit/d8f8433e922afe6b9119126a84a06f96adff8dac)

```text
Use R2 for coverage status
```

<!-- changelog-commit:9ce2c5aa85b3940d7755fbe507982bed9a94a754 -->
### Commit [`9ce2c5a`](https://github.com/superhero/operations.superduper.solutions/commit/9ce2c5aa85b3940d7755fbe507982bed9a94a754)

```text
Publish dependency status to R2
```

<!-- changelog-commit:e715fdd6e5b3410c746c443d18f58c84167798e9 -->
### Commit [`e715fdd`](https://github.com/superhero/operations.superduper.solutions/commit/e715fdd6e5b3410c746c443d18f58c84167798e9)

```text
Point badges at R2 domain
```

<!-- changelog-commit:91b8b628e75260fb083257f010f1d79d6d4409d7 -->
### Commit [`91b8b62`](https://github.com/superhero/operations.superduper.solutions/commit/91b8b628e75260fb083257f010f1d79d6d4409d7)

```text
Use status hostname for published metrics
```

<!-- changelog-commit:47181d298001397b641bc5427ce6fb59cabdc1ca -->
### Commit [`47181d2`](https://github.com/superhero/operations.superduper.solutions/commit/47181d298001397b641bc5427ce6fb59cabdc1ca)

```text
Use operations status R2 bucket
```

<!-- changelog-commit:1f07de3899cea576aa969438170b359b2d572e13 -->
### Commit [`1f07de3`](https://github.com/superhero/operations.superduper.solutions/commit/1f07de3899cea576aa969438170b359b2d572e13)

```text
Use operations status R2 bucket
```

<!-- changelog-commit:fbf77dee3cdd0c3e8ef1bc56c4c5d45941cbc931 -->
### Commit [`fbf77de`](https://github.com/superhero/operations.superduper.solutions/commit/fbf77dee3cdd0c3e8ef1bc56c4c5d45941cbc931)

```text
Publish HTML coverage report to R2
```

<!-- changelog-commit:96efb3f684e5c6f1e50c0391dbc006a0aae7036f -->
### Commit [`96efb3f`](https://github.com/superhero/operations.superduper.solutions/commit/96efb3f684e5c6f1e50c0391dbc006a0aae7036f)

```text
Link coverage badge to HTML report
```

<!-- changelog-commit:6e58a3611365dba979e10bd67461640efb570602 -->
### Commit [`6e58a36`](https://github.com/superhero/operations.superduper.solutions/commit/6e58a3611365dba979e10bd67461640efb570602)

```text
Keep status R2 bucket JSON-only
```

<!-- changelog-commit:c4b847de0970392afecf59eadc817bfea6c766c2 -->
### Commit [`c4b847d`](https://github.com/superhero/operations.superduper.solutions/commit/c4b847de0970392afecf59eadc817bfea6c766c2)

```text
Keep coverage status endpoint JSON-only
```

<!-- changelog-commit:2a67be1d9b99388b89b2a03424ecefeacfebaf34 -->
### Commit [`2a67be1`](https://github.com/superhero/operations.superduper.solutions/commit/2a67be1d9b99388b89b2a03424ecefeacfebaf34)

```text
Use status naming for JSON publishing
```

<!-- changelog-commit:cb9d3c202e2938a00baf793a782fc20e9b3e227c -->
### Commit [`cb9d3c2`](https://github.com/superhero/operations.superduper.solutions/commit/cb9d3c202e2938a00baf793a782fc20e9b3e227c)

```text
Use status naming for JSON publishing
```

<!-- changelog-commit:3f43f7f5a02e8024a9328ab625ab170af88cae18 -->
### Commit [`3f43f7f`](https://github.com/superhero/operations.superduper.solutions/commit/3f43f7f5a02e8024a9328ab625ab170af88cae18)

```text
Use status naming for JSON publishing
```

<!-- changelog-commit:d9d8665e895be5f339b4cde3a54e9d68bddc3882 -->
### Commit [`d9d8665`](https://github.com/superhero/operations.superduper.solutions/commit/d9d8665e895be5f339b4cde3a54e9d68bddc3882)

```text
Add shared PR auto-merge helper
```

<!-- changelog-commit:9805f3bc41732720c6586b97036030dcdb780e40 -->
### Commit [`9805f3b`](https://github.com/superhero/operations.superduper.solutions/commit/9805f3bc41732720c6586b97036030dcdb780e40)

```text
Auto-merge PRs after CI passes
```

<!-- changelog-commit:01bc329c9a297e5390d4a1de235137d77c76af64 -->
### Commit [`01bc329`](https://github.com/superhero/operations.superduper.solutions/commit/01bc329c9a297e5390d4a1de235137d77c76af64)

```text
Auto-merge PRs after CI passes
```

<!-- changelog-commit:6be5bfbcbdc68b35744d2a710f4118b7b507f0aa -->
### Commit [`6be5bfb`](https://github.com/superhero/operations.superduper.solutions/commit/6be5bfbcbdc68b35744d2a710f4118b7b507f0aa)

```text
Auto-merge PRs after CI passes
```

<!-- changelog-commit:8e2704b4787b39dcc3edd9e3546f437d03765b64 -->
### Commit [`8e2704b`](https://github.com/superhero/operations.superduper.solutions/commit/8e2704b4787b39dcc3edd9e3546f437d03765b64)

```text
Auto-merge PRs after CI passes
```

## 0.0.19

<!-- changelog-commit:d7c497205acca0ccc6db63036535f8c307f8ab49 -->
### Commit [`d7c4972`](https://github.com/superhero/operations.superduper.solutions/commit/d7c497205acca0ccc6db63036535f8c307f8ab49)

```text
docs: add Node.js, TypeScript, and Svelte badges
```

<!-- changelog-commit:8d5c78d3ca4ae310d861d8c095fc64ed9f933d8b -->
### Commit [`8d5c78d`](https://github.com/superhero/operations.superduper.solutions/commit/8d5c78d3ca4ae310d861d8c095fc64ed9f933d8b)

```text
ci: publish dependency badge through Cloudflare Pages
```

<!-- changelog-commit:75e59f2cd3ffa20abe4d006c62538fe7ffea8009 -->
### Commit [`75e59f2`](https://github.com/superhero/operations.superduper.solutions/commit/75e59f2cd3ffa20abe4d006c62538fe7ffea8009)

```text
docs: read dependency badge data from Cloudflare Pages
```

## 0.0.18

<!-- changelog-commit:326ac7d5f7e7e4c516cd1c04070275d734218b39 -->
### Commit [`326ac7d`](https://github.com/superhero/operations.superduper.solutions/commit/326ac7d5f7e7e4c516cd1c04070275d734218b39)

```text
Fix workflow status badge filters
```

## 0.0.17

<!-- changelog-commit:ef9ca633d7b56c65ca754e06c972e88e25f7d54d -->
### Commit [`ef9ca63`](https://github.com/superhero/operations.superduper.solutions/commit/ef9ca633d7b56c65ca754e06c972e88e25f7d54d)

```text
docs(adr): define single-purpose artifacts
```

<!-- changelog-commit:47e308cfe55d5a963d5df12ff88fea5c0f8fe31f -->
### Commit [`47e308c`](https://github.com/superhero/operations.superduper.solutions/commit/47e308cfe55d5a963d5df12ff88fea5c0f8fe31f)

```text
ci: make PR-develop pull-request only
```

<!-- changelog-commit:6f9703df61ec3575eadb4b2d658dd9ee294c99a1 -->
### Commit [`6f9703d`](https://github.com/superhero/operations.superduper.solutions/commit/6f9703df61ec3575eadb4b2d658dd9ee294c99a1)

```text
ci: remove obsolete develop health dispatch
```

<!-- changelog-commit:b2385062661f463df82354ec6343fedb409cdfef -->
### Commit [`b238506`](https://github.com/superhero/operations.superduper.solutions/commit/b2385062661f463df82354ec6343fedb409cdfef)

```text
ci: quote PR-develop run name
```

<!-- changelog-commit:a4423c02ecd1de7a50846a1f4633a94e185b6c21 -->
### Commit [`a4423c0`](https://github.com/superhero/operations.superduper.solutions/commit/a4423c02ecd1de7a50846a1f4633a94e185b6c21)

```text
ci: simplify PR-develop run name
```

<!-- changelog-commit:b944772e112ecdf1b05e43dd89c0f3614cbc2524 -->
### Commit [`b944772`](https://github.com/superhero/operations.superduper.solutions/commit/b944772e112ecdf1b05e43dd89c0f3614cbc2524)

```text
ci: reuse installed dependencies in PR-develop
```

<!-- changelog-commit:0405b979b4b9143e51ed355d5eeb595cfbff32fc -->
### Commit [`0405b97`](https://github.com/superhero/operations.superduper.solutions/commit/0405b979b4b9143e51ed355d5eeb595cfbff32fc)

```text
ci: split Gitflow validation responsibilities
```

<!-- changelog-commit:febc8368ce125551f7a43c55ad015fa044eeab99 -->
### Commit [`febc836`](https://github.com/superhero/operations.superduper.solutions/commit/febc8368ce125551f7a43c55ad015fa044eeab99)

```text
ci: remove obsolete Gitflow topology compatibility job
```

<!-- changelog-commit:9bd4496a33a32d228119b98d671e321f9053fc68 -->
### Commit [`9bd4496`](https://github.com/superhero/operations.superduper.solutions/commit/9bd4496a33a32d228119b98d671e321f9053fc68)

```text
ci: rename branch direction validation job
```

<!-- changelog-commit:73ed4269d8d9a4cde715afa2c9dfa089bcdf79e3 -->
### Commit [`73ed426`](https://github.com/superhero/operations.superduper.solutions/commit/73ed4269d8d9a4cde715afa2c9dfa089bcdf79e3)

```text
ci: align validation job naming
```

<!-- changelog-commit:e028578fd07ef6bde50a1d35770deecf16fada9e -->
### Commit [`e028578`](https://github.com/superhero/operations.superduper.solutions/commit/e028578fd07ef6bde50a1d35770deecf16fada9e)

```text
ci: rename hotfix validation job
```

<!-- changelog-commit:c5338a9686aebbc8e79404615d946929cd29c4db -->
### Commit [`c5338a9`](https://github.com/superhero/operations.superduper.solutions/commit/c5338a9686aebbc8e79404615d946929cd29c4db)

```text
ci: align validation naming
```

<!-- changelog-commit:ecaece3bef3391d0483ed252cb0df90938f18225 -->
### Commit [`ecaece3`](https://github.com/superhero/operations.superduper.solutions/commit/ecaece3bef3391d0483ed252cb0df90938f18225)

```text
ci: add branch direction validator
```

<!-- changelog-commit:164a39e09ce1a0cd75ea0d7497c07509317d5b1b -->
### Commit [`164a39e`](https://github.com/superhero/operations.superduper.solutions/commit/164a39e09ce1a0cd75ea0d7497c07509317d5b1b)

```text
ci: add SemVer validator
```

<!-- changelog-commit:57c198ef415ffad6f4b8bf2c930cb3a014754bb0 -->
### Commit [`57c198e`](https://github.com/superhero/operations.superduper.solutions/commit/57c198ef415ffad6f4b8bf2c930cb3a014754bb0)

```text
ci: add tag availability validator
```

<!-- changelog-commit:eff5cb7c8de2a4d82da11a6a27765322376fe589 -->
### Commit [`eff5cb7`](https://github.com/superhero/operations.superduper.solutions/commit/eff5cb7c8de2a4d82da11a6a27765322376fe589)

```text
ci: add active branch validator
```

<!-- changelog-commit:5a87d21bc3fb4ad6e36d042863dcbe0792e139c7 -->
### Commit [`5a87d21`](https://github.com/superhero/operations.superduper.solutions/commit/5a87d21bc3fb4ad6e36d042863dcbe0792e139c7)

```text
ci: add next patch validator
```

<!-- changelog-commit:b2fc64bc957dac93e32c78080c589ad8a02a3436 -->
### Commit [`b2fc64b`](https://github.com/superhero/operations.superduper.solutions/commit/b2fc64bc957dac93e32c78080c589ad8a02a3436)

```text
ci: compose reusable validation scripts
```

<!-- changelog-commit:29ad0fa55d72bac6dccbc8fec1dbdd28ba5cdefc -->
### Commit [`29ad0fa`](https://github.com/superhero/operations.superduper.solutions/commit/29ad0fa55d72bac6dccbc8fec1dbdd28ba5cdefc)

```text
ci: remove extra blank line
```

<!-- changelog-commit:a233cb6e492b602d53318e088896987601e114ae -->
### Commit [`a233cb6`](https://github.com/superhero/operations.superduper.solutions/commit/a233cb6e492b602d53318e088896987601e114ae)

```text
ci: rename develop PR workflow
```

<!-- changelog-commit:d7df3490ecaac81947c2754d78920b6bcf71a0a8 -->
### Commit [`d7df349`](https://github.com/superhero/operations.superduper.solutions/commit/d7df3490ecaac81947c2754d78920b6bcf71a0a8)

```text
ci: remove old develop PR workflow name
```

<!-- changelog-commit:0db59183af38bc1602207626176f9afc7c7f8207 -->
### Commit [`0db5918`](https://github.com/superhero/operations.superduper.solutions/commit/0db59183af38bc1602207626176f9afc7c7f8207)

```text
ci: separate workflow sections
```

<!-- changelog-commit:4e822ee91018b5a9c44da8738cee4561e6d91bb2 -->
### Commit [`4e822ee`](https://github.com/superhero/operations.superduper.solutions/commit/4e822ee91018b5a9c44da8738cee4561e6d91bb2)

```text
ci: align workflow list formatting
```

<!-- changelog-commit:fa6f2f0dcab04debbfe4bda11a40a7b80030c7f5 -->
### Commit [`fa6f2f0`](https://github.com/superhero/operations.superduper.solutions/commit/fa6f2f0dcab04debbfe4bda11a40a7b80030c7f5)

```text
ci: use standard YAML list indentation
```

<!-- changelog-commit:06c2706d93a334362aa7fcdab7854506fad847d4 -->
### Commit [`06c2706`](https://github.com/superhero/operations.superduper.solutions/commit/06c2706d93a334362aa7fcdab7854506fad847d4)

```text
ci: support branch patterns in direction validator
```

<!-- changelog-commit:42159f403a2f5809cf954a805fda4900c833b3dc -->
### Commit [`42159f4`](https://github.com/superhero/operations.superduper.solutions/commit/42159f403a2f5809cf954a805fda4900c833b3dc)

```text
ci: add pr-on-release workflow
```

<!-- changelog-commit:64b9b450b77b98df81e1fc8b49a8376929752908 -->
### Commit [`64b9b45`](https://github.com/superhero/operations.superduper.solutions/commit/64b9b450b77b98df81e1fc8b49a8376929752908)

```text
ci: add pr-on-support workflow
```

<!-- changelog-commit:d67e1713e9f43154118a50d62609926e8d3351ff -->
### Commit [`d67e171`](https://github.com/superhero/operations.superduper.solutions/commit/d67e1713e9f43154118a50d62609926e8d3351ff)

```text
ci: remove old PR-release.yml workflow
```

<!-- changelog-commit:c4643efc12b998756a96bb1b5568b34531ade95c -->
### Commit [`c4643ef`](https://github.com/superhero/operations.superduper.solutions/commit/c4643efc12b998756a96bb1b5568b34531ade95c)

```text
ci: remove old PR-support.yml workflow
```

<!-- changelog-commit:b59386a33e385ea699c5f26806f2020d2404899f -->
### Commit [`b59386a`](https://github.com/superhero/operations.superduper.solutions/commit/b59386a33e385ea699c5f26806f2020d2404899f)

```text
ci: add pr-on-main workflow
```

<!-- changelog-commit:eb4d5f9775d73cd7c204591b1a0b51c0129cefcc -->
### Commit [`eb4d5f9`](https://github.com/superhero/operations.superduper.solutions/commit/eb4d5f9775d73cd7c204591b1a0b51c0129cefcc)

```text
ci: split release-on-main workflow
```

<!-- changelog-commit:de98833833040a58d968236761914a22344f2f2d -->
### Commit [`de98833`](https://github.com/superhero/operations.superduper.solutions/commit/de98833833040a58d968236761914a22344f2f2d)

```text
ci: align pr-on-main checkout configuration
```

<!-- changelog-commit:0daf73cc446f6e843ebdb84009f945fe3d737411 -->
### Commit [`0daf73c`](https://github.com/superhero/operations.superduper.solutions/commit/0daf73cc446f6e843ebdb84009f945fe3d737411)

```text
ci: remove old PR-main workflow
```

<!-- changelog-commit:99c3f5ec19ae8435e3e3f1425c1d8703cc4c23ba -->
### Commit [`99c3f5e`](https://github.com/superhero/operations.superduper.solutions/commit/99c3f5ec19ae8435e3e3f1425c1d8703cc4c23ba)

```text
ci: align pr-on-release concurrency
```

<!-- changelog-commit:dac5398fe1f391b9d05e1b0f3c1384390819fa35 -->
### Commit [`dac5398`](https://github.com/superhero/operations.superduper.solutions/commit/dac5398fe1f391b9d05e1b0f3c1384390819fa35)

```text
ci: align pr-on-support concurrency
```

<!-- changelog-commit:7e494fc2a6c67974e4eb67dd716b919a17a184ed -->
### Commit [`7e494fc`](https://github.com/superhero/operations.superduper.solutions/commit/7e494fc2a6c67974e4eb67dd716b919a17a184ed)

```text
ci: reuse SemVer validator during release tagging
```

<!-- changelog-commit:3db1aa2f0cfa6a96e9357051e9bee1a6633fc2ec -->
### Commit [`3db1aa2`](https://github.com/superhero/operations.superduper.solutions/commit/3db1aa2f0cfa6a96e9357051e9bee1a6633fc2ec)

```text
ci: reuse branch direction usage text
```

<!-- changelog-commit:ec3b11fa4e64b6ee4fc7397ca302748393c4b13c -->
### Commit [`ec3b11f`](https://github.com/superhero/operations.superduper.solutions/commit/ec3b11fa4e64b6ee4fc7397ca302748393c4b13c)

```text
ci: clarify missing branch validator arguments
```

<!-- changelog-commit:7815cc67a74150814574a669c2c6e412f2e71d1f -->
### Commit [`7815cc6`](https://github.com/superhero/operations.superduper.solutions/commit/7815cc67a74150814574a669c2c6e412f2e71d1f)

```text
ci: tidy branch validator usage errors
```

<!-- changelog-commit:cdba1676820e2e989ad97c7e9d810ac08abbf890 -->
### Commit [`cdba167`](https://github.com/superhero/operations.superduper.solutions/commit/cdba1676820e2e989ad97c7e9d810ac08abbf890)

```text
ci: simplify branch validator argument errors
```

<!-- changelog-commit:ecc6d4a5f745a613dab07e4d2f66c0c44b804213 -->
### Commit [`ecc6d4a`](https://github.com/superhero/operations.superduper.solutions/commit/ecc6d4a5f745a613dab07e4d2f66c0c44b804213)

```text
ci: move argument shift next to pattern loop
```

<!-- changelog-commit:62ca1485af835cacee671888cf42308bc6b42d25 -->
### Commit [`62ca148`](https://github.com/superhero/operations.superduper.solutions/commit/62ca1485af835cacee671888cf42308bc6b42d25)

```text
ci: use Unicode arrow in branch direction output
```

<!-- changelog-commit:9c7e9ed59531f81daa64e6f1af5f8c81780cf0f6 -->
### Commit [`9c7e9ed`](https://github.com/superhero/operations.superduper.solutions/commit/9c7e9ed59531f81daa64e6f1af5f8c81780cf0f6)

```text
ci: write branch validation errors to stderr
```

<!-- changelog-commit:4f53b7da3b8cef8fd58aa4eb57de7e4c007116ee -->
### Commit [`4f53b7d`](https://github.com/superhero/operations.superduper.solutions/commit/4f53b7da3b8cef8fd58aa4eb57de7e4c007116ee)

```text
ci: align next patch validator conventions
```

<!-- changelog-commit:30bef7249a573ac20c189865025a19f12698991c -->
### Commit [`30bef72`](https://github.com/superhero/operations.superduper.solutions/commit/30bef7249a573ac20c189865025a19f12698991c)

```text
ci: align SemVer validator conventions
```

<!-- changelog-commit:e8f74460c209edf0652c3c675f139ab61509703e -->
### Commit [`e8f7446`](https://github.com/superhero/operations.superduper.solutions/commit/e8f74460c209edf0652c3c675f139ab61509703e)

```text
ci: align active branch validator conventions
```

<!-- changelog-commit:f235ad91994f90946021d1bb1014c5ea457b467b -->
### Commit [`f235ad9`](https://github.com/superhero/operations.superduper.solutions/commit/f235ad91994f90946021d1bb1014c5ea457b467b)

```text
ci: align tag availability validator conventions
```

<!-- changelog-commit:2ce1ddcfe5b7b698cadc56d687fe5fa4619e581e -->
### Commit [`2ce1ddc`](https://github.com/superhero/operations.superduper.solutions/commit/2ce1ddcfe5b7b698cadc56d687fe5fa4619e581e)

```text
ci: simplify next patch comparison assignment
```

<!-- changelog-commit:4346307584942f362db5e5fc8953556930b11872 -->
### Commit [`4346307`](https://github.com/superhero/operations.superduper.solutions/commit/4346307584942f362db5e5fc8953556930b11872)

```text
ci: write release workflow errors to stderr
```

<!-- changelog-commit:c638a9f405640af73e1898c204e8ca40eca0a356 -->
### Commit [`c638a9f`](https://github.com/superhero/operations.superduper.solutions/commit/c638a9f405640af73e1898c204e8ca40eca0a356)

```text
Simplify release-on-main workflow
```

<!-- changelog-commit:6fc162a4cadedf474a24c5d20675aea5a831155f -->
### Commit [`6fc162a`](https://github.com/superhero/operations.superduper.solutions/commit/6fc162a4cadedf474a24c5d20675aea5a831155f)

```text
Rename workflows around CI and CD
```

<!-- changelog-commit:7e0f88373da54608a3227f924a0bf9ff921f1fcf -->
### Commit [`7e0f883`](https://github.com/superhero/operations.superduper.solutions/commit/7e0f88373da54608a3227f924a0bf9ff921f1fcf)

```text
Fix README status badges
```

<!-- changelog-commit:766cbe2942a74ad51cee2c51a77d302f6eea9c28 -->
### Commit [`766cbe2`](https://github.com/superhero/operations.superduper.solutions/commit/766cbe2942a74ad51cee2c51a77d302f6eea9c28)

```text
Update coverage badge label
```

<!-- changelog-commit:3cb3931c244ee6a1ef8e5e64a601a738411cc32f -->
### Commit [`3cb3931`](https://github.com/superhero/operations.superduper.solutions/commit/3cb3931c244ee6a1ef8e5e64a601a738411cc32f)

```text
Add dependency status badge workflow
```

## 0.0.16

<!-- changelog-commit:97f33196cd29bbf05da10939f00afb384a1809a8 -->
### Commit [`97f3319`](https://github.com/superhero/operations.superduper.solutions/commit/97f33196cd29bbf05da10939f00afb384a1809a8)

```text
fix(ci): restore GitHub App authentication for back-merge PRs
```

## 0.0.15

<!-- changelog-commit:77a998d6fae9dfd1619c837d9cfdafc27b1897b4 -->
### Commit [`77a998d`](https://github.com/superhero/operations.superduper.solutions/commit/77a998d6fae9dfd1619c837d9cfdafc27b1897b4)

```text
refactor(ci): consolidate main validation and release in main.yml

Keep release artifact promotion and non-gating back-merge unchanged.
Rename Development CI and its PR-direction job for clarity.
```

<!-- changelog-commit:12f0932cf29bc388db7b16b705de320ada66ff5b -->
### Commit [`12f0932`](https://github.com/superhero/operations.superduper.solutions/commit/12f0932cf29bc388db7b16b705de320ada66ff5b)

```text
fix(ci): validate development pull requests before merging

Run type checks, tests, and build on ordinary develop PRs, not pushes.
Keep the same-repository main back-merge exception and explicit health dispatch.
Use read-only pull_request jobs and retain the required Gitflow check name.
```

<!-- changelog-commit:594dcfacd79ecda69c851889769a220cbc6dbbe2 -->
### Commit [`594dcfa`](https://github.com/superhero/operations.superduper.solutions/commit/594dcfacd79ecda69c851889769a220cbc6dbbe2)

```text
fix(ci): isolate PR concurrency during workflow migration
```

<!-- changelog-commit:36d66b6ff1413736b693f99ef7b2b8d267b1a526 -->
### Commit [`36d66b6`](https://github.com/superhero/operations.superduper.solutions/commit/36d66b6ff1413736b693f99ef7b2b8d267b1a526)

```text
chore(ci): label main PR and push runs explicitly
```

<!-- changelog-commit:c193c22bdbba1c074872aa536aaaf425f08a09d6 -->
### Commit [`c193c22`](https://github.com/superhero/operations.superduper.solutions/commit/c193c22bdbba1c074872aa536aaaf425f08a09d6)

```text
chore(ci): label develop PR and health-check runs explicitly
```

<!-- changelog-commit:9f62d4ff15becdc31b0d24406d5172b2fa37b70e -->
### Commit [`9f62d4f`](https://github.com/superhero/operations.superduper.solutions/commit/9f62d4ff15becdc31b0d24406d5172b2fa37b70e)

```text
chore(ci): use the requested Main PR workflow name
```

<!-- changelog-commit:8e775efc4f819ae4db95df0ff68ed025b442bffe -->
### Commit [`8e775ef`](https://github.com/superhero/operations.superduper.solutions/commit/8e775efc4f819ae4db95df0ff68ed025b442bffe)

```text
refactor(ci): use PR-prefixed names and split release/support policy

Name workflows PR-main, PR-develop, PR-release, and PR-support.
Replace 05-gitflow-policy.yml with destination-specific release.yml and support.yml.
Preserve required check contexts, main release behavior, and the non-gating back-merge.
```

<!-- changelog-commit:074887566e9e57a4f6734ab2f18b3d56137d2bfc -->
### Commit [`0748875`](https://github.com/superhero/operations.superduper.solutions/commit/074887566e9e57a4f6734ab2f18b3d56137d2bfc)

```text
refactor(ci): use PR-prefixed workflow files and release on merged PRs

Rename workflows to PR-main.yml, PR-develop.yml, PR-release.yml and PR-support.yml.
Replace the main push trigger with pull_request.closed guarded by merged=true.
Keep pre-merge validation separate from release work and reuse the validated bundle.
Update artifact lookup and development health dispatch to the new filenames.
Retain explicit manual/health dispatches and existing required check names.

Validated four YAML files, 29 shell blocks, 100 event/job predicates,
eight release-context cases and four artifact-selection cases locally.
```

## 0.0.14

<!-- changelog-commit:c22c53347cd0b4e00f5127814a12c356a0b3ba1b -->
### Commit [`c22c533`](https://github.com/superhero/operations.superduper.solutions/commit/c22c53347cd0b4e00f5127814a12c356a0b3ba1b)

```text
fix(ci): synchronize develop without a test gate
```

<!-- changelog-commit:be6ae3722baa884f9bc8663d0c91b2e198ddebe3 -->
### Commit [`be6ae37`](https://github.com/superhero/operations.superduper.solutions/commit/be6ae3722baa884f9bc8663d0c91b2e198ddebe3)

```text
fix(ci): run development health checks after branch updates
```

## 0.0.13

<!-- changelog-commit:e4f2c9ac0da11ad1cf26d971a93b06bc0866cc5b -->
### Commit [`e4f2c9a`](https://github.com/superhero/operations.superduper.solutions/commit/e4f2c9ac0da11ad1cf26d971a93b06bc0866cc5b)

```text
fix(ci): prevent back-merge self-wait and respect installed App permissions
```

<!-- changelog-commit:a6734e268d97f716322a991dd4b96884b11b2ec6 -->
### Commit [`a6734e2`](https://github.com/superhero/operations.superduper.solutions/commit/a6734e268d97f716322a991dd4b96884b11b2ec6)

```text
fix(ci): select Development CI by workflow and exact main head
```

## 0.0.12

<!-- changelog-commit:a17e80ef44eb94aa4bc9aacc45ab86c071b8f1ae -->
### Commit [`a17e80e`](https://github.com/superhero/operations.superduper.solutions/commit/a17e80ef44eb94aa4bc9aacc45ab86c071b8f1ae)

```text
fix(ci): allow app token to merge back-merge PR
```

<!-- changelog-commit:b9537b23bc184d5ad1117cb60903ed63c22317ff -->
### Commit [`b9537b2`](https://github.com/superhero/operations.superduper.solutions/commit/b9537b23bc184d5ad1117cb60903ed63c22317ff)

```text
chore(hotfix): bump version to 0.0.12
```

<!-- changelog-commit:bebca3b9e8f95adabcf7a8fd2011f1bfb8f02b3b -->
### Commit [`bebca3b`](https://github.com/superhero/operations.superduper.solutions/commit/bebca3b9e8f95adabcf7a8fd2011f1bfb8f02b3b)

```text
chore(hotfix): update lockfile version to 0.0.12
```

## 0.0.11

<!-- changelog-commit:4aee6ca8fab63b56ceef3934d4572bbfc7d20f40 -->
### Commit [`4aee6ca`](https://github.com/superhero/operations.superduper.solutions/commit/4aee6ca8fab63b56ceef3934d4572bbfc7d20f40)

```text
fix(ci): use workflow token for back-merge
```

<!-- changelog-commit:a12be1d01213e4a98e33a488211d00393a49033b -->
### Commit [`a12be1d`](https://github.com/superhero/operations.superduper.solutions/commit/a12be1d01213e4a98e33a488211d00393a49033b)

```text
chore(hotfix): bump version to 0.0.11
```

<!-- changelog-commit:49d25db544d9c1b095e7a279d070ed44def4dd1d -->
### Commit [`49d25db`](https://github.com/superhero/operations.superduper.solutions/commit/49d25db544d9c1b095e7a279d070ed44def4dd1d)

```text
chore(hotfix): update lockfile version to 0.0.11
```

## 0.0.10

<!-- changelog-commit:5644566779afb08e8173ab45bda31eb1ed2a9da5 -->
### Commit [`5644566`](https://github.com/superhero/operations.superduper.solutions/commit/5644566779afb08e8173ab45bda31eb1ed2a9da5)

```text
fix(ci): trigger post-release from main
```

<!-- changelog-commit:e79f416acd06b1e134be81fd9e4d0124fe7f098d -->
### Commit [`e79f416`](https://github.com/superhero/operations.superduper.solutions/commit/e79f416acd06b1e134be81fd9e4d0124fe7f098d)

```text
fix(ci): complete automatic back-merge
```

<!-- changelog-commit:60aebe54029f093d797a47084faea0d1d8280650 -->
### Commit [`60aebe5`](https://github.com/superhero/operations.superduper.solutions/commit/60aebe54029f093d797a47084faea0d1d8280650)

```text
chore(release): bump version to 0.0.10
```

<!-- changelog-commit:4bb5d4f2f892984055a9b05313efde25b039f196 -->
### Commit [`4bb5d4f`](https://github.com/superhero/operations.superduper.solutions/commit/4bb5d4f2f892984055a9b05313efde25b039f196)

```text
chore(release): update lockfile version to 0.0.10
```

## 0.0.9

<!-- changelog-commit:81cc2b332080deee853c42424851d818b2576d26 -->
### Commit [`81cc2b3`](https://github.com/superhero/operations.superduper.solutions/commit/81cc2b332080deee853c42424851d818b2576d26)

```text
refactor(ci): consolidate post-release workflows
```

<!-- changelog-commit:24ed62308d4bb1ab373b974abbd7c8e279fb136c -->
### Commit [`24ed623`](https://github.com/superhero/operations.superduper.solutions/commit/24ed62308d4bb1ab373b974abbd7c8e279fb136c)

```text
refactor(ci): remove superseded deploy.yml
```

<!-- changelog-commit:92d790c65219a6f3d0e9614c39f2e56897b19c42 -->
### Commit [`92d790c`](https://github.com/superhero/operations.superduper.solutions/commit/92d790c65219a6f3d0e9614c39f2e56897b19c42)

```text
refactor(ci): remove superseded gitflow-release-tag.yml
```

<!-- changelog-commit:c24c27dca7d4c1503b98135e6a386dc9def50012 -->
### Commit [`c24c27d`](https://github.com/superhero/operations.superduper.solutions/commit/c24c27dca7d4c1503b98135e6a386dc9def50012)

```text
refactor(ci): remove superseded 09-auto-backmerge-pr.yml
```

<!-- changelog-commit:83585a5eb24496bac1a95231e1196f2d8251d919 -->
### Commit [`83585a5`](https://github.com/superhero/operations.superduper.solutions/commit/83585a5eb24496bac1a95231e1196f2d8251d919)

```text
chore(release): bump version to 0.0.9
```

<!-- changelog-commit:33a2195e7a7b941dc323699fb73c9b0ea83eabfc -->
### Commit [`33a2195`](https://github.com/superhero/operations.superduper.solutions/commit/33a2195e7a7b941dc323699fb73c9b0ea83eabfc)

```text
chore(release): update lockfile version to 0.0.9
```

## 0.0.8

<!-- changelog-commit:ae1a65978ec84ffacf64b42e2d80ad18f6f24857 -->
### Commit [`ae1a659`](https://github.com/superhero/operations.superduper.solutions/commit/ae1a65978ec84ffacf64b42e2d80ad18f6f24857)

```text
refactor(ci): make release validation PR-only
```

<!-- changelog-commit:af0d07c6db87166df3b9670b09754ef082aadba8 -->
### Commit [`af0d07c`](https://github.com/superhero/operations.superduper.solutions/commit/af0d07c6db87166df3b9670b09754ef082aadba8)

```text
feat(ci): deploy validated release artifact
```

<!-- changelog-commit:5862eb61d441d0727c08bd2210ab1ab0ffcbb2a1 -->
### Commit [`5862eb6`](https://github.com/superhero/operations.superduper.solutions/commit/5862eb61d441d0727c08bd2210ab1ab0ffcbb2a1)

```text
chore(release): bump version to 0.0.8
```

<!-- changelog-commit:ea812d356d9cb3743116a8554040c8f252781710 -->
### Commit [`ea812d3`](https://github.com/superhero/operations.superduper.solutions/commit/ea812d356d9cb3743116a8554040c8f252781710)

```text
chore(release): update lockfile version to 0.0.8
```

## 0.0.7

<!-- changelog-commit:c74dde5ad9a3d4107c676b6275992324240c1415 -->
### Commit [`c74dde5`](https://github.com/superhero/operations.superduper.solutions/commit/c74dde5ad9a3d4107c676b6275992324240c1415)

```text
refactor(ci): split development checks into atomic jobs
```

<!-- changelog-commit:57d0525c26576c22c5230694bdd37175d2f1e18c -->
### Commit [`57d0525`](https://github.com/superhero/operations.superduper.solutions/commit/57d0525c26576c22c5230694bdd37175d2f1e18c)

```text
refactor(ci): move develop topology check into development CI
```

<!-- changelog-commit:3f815f76710f20d7d192f009db814e942031cb48 -->
### Commit [`3f815f7`](https://github.com/superhero/operations.superduper.solutions/commit/3f815f76710f20d7d192f009db814e942031cb48)

```text
refactor(ci): include main topology check in CI
```

<!-- changelog-commit:44152f08a800461d4faebbce13e5371f0f50b0de -->
### Commit [`44152f0`](https://github.com/superhero/operations.superduper.solutions/commit/44152f08a800461d4faebbce13e5371f0f50b0de)

```text
refactor(ci): keep standalone policy for support-line targets
```

<!-- changelog-commit:9f3cee8559a39bbacd72726895ed3bf2c1a6b40f -->
### Commit [`9f3cee8`](https://github.com/superhero/operations.superduper.solutions/commit/9f3cee8559a39bbacd72726895ed3bf2c1a6b40f)

```text
fix(ci): rebuild main CI topology integration
```

<!-- changelog-commit:70ce7e8c94327b39c66dfcdbf8b48b1e5dc80014 -->
### Commit [`70ce7e8`](https://github.com/superhero/operations.superduper.solutions/commit/70ce7e8c94327b39c66dfcdbf8b48b1e5dc80014)

```text
chore(release): bump version to 0.0.7
```

<!-- changelog-commit:fed61dbd089c8a95c322899442cdb3a0bae8de34 -->
### Commit [`fed61db`](https://github.com/superhero/operations.superduper.solutions/commit/fed61dbd089c8a95c322899442cdb3a0bae8de34)

```text
chore(release): update lockfile version to 0.0.7
```

## 0.0.6

<!-- changelog-commit:88ee9c7651e82f6098528c2bd8ef37eb405470e5 -->
### Commit [`88ee9c7`](https://github.com/superhero/operations.superduper.solutions/commit/88ee9c7651e82f6098528c2bd8ef37eb405470e5)

```text
fix(ci): support configured GitHub App identifiers
```

<!-- changelog-commit:eb70ee2f5c1f2b7694e8a90fb4b8d99c676319dc -->
### Commit [`eb70ee2`](https://github.com/superhero/operations.superduper.solutions/commit/eb70ee2f5c1f2b7694e8a90fb4b8d99c676319dc)

```text
chore(hotfix): bump version to 0.0.6
```

<!-- changelog-commit:4b25a1fe1ceede68b35fcc2903e7ad76d40c0a38 -->
### Commit [`4b25a1f`](https://github.com/superhero/operations.superduper.solutions/commit/4b25a1fe1ceede68b35fcc2903e7ad76d40c0a38)

```text
chore(hotfix): update lockfile version to 0.0.6
```

## 0.0.5

<!-- changelog-commit:b4499c1011be3cc7b534ca2a59299b62fb2eb24a -->
### Commit [`b4499c1`](https://github.com/superhero/operations.superduper.solutions/commit/b4499c1011be3cc7b534ca2a59299b62fb2eb24a)

```text
fix(ci): authenticate back-merge with GitHub App
```

<!-- changelog-commit:9c1c3ecbd22b9709a9c965dd6e79ccabd41a41a9 -->
### Commit [`9c1c3ec`](https://github.com/superhero/operations.superduper.solutions/commit/9c1c3ecbd22b9709a9c965dd6e79ccabd41a41a9)

```text
chore(release): bump version to 0.0.5
```

<!-- changelog-commit:a47b4b034e5d80c88b81d393e4898ac3dcf6569f -->
### Commit [`a47b4b0`](https://github.com/superhero/operations.superduper.solutions/commit/a47b4b034e5d80c88b81d393e4898ac3dcf6569f)

```text
chore(release): update lockfile version to 0.0.5
```

## 0.0.4

<!-- changelog-commit:9eb63390f14b048f1e409ea4456da115877086d4 -->
### Commit [`9eb6339`](https://github.com/superhero/operations.superduper.solutions/commit/9eb63390f14b048f1e409ea4456da115877086d4)

```text
ci: remove redundant coverage badge writer
```

<!-- changelog-commit:1584ecf66b97dd0cea9587bbc19ca123c3afd832 -->
### Commit [`1584ecf`](https://github.com/superhero/operations.superduper.solutions/commit/1584ecf66b97dd0cea9587bbc19ca123c3afd832)

```text
hotfix: bump version to 0.0.4
```

<!-- changelog-commit:13e3b85740e89c9866b7bf5cda63306e76108953 -->
### Commit [`13e3b85`](https://github.com/superhero/operations.superduper.solutions/commit/13e3b85740e89c9866b7bf5cda63306e76108953)

```text
hotfix: sync lockfile version
```

## 0.0.3

<!-- changelog-commit:a7525ca56448d8d0bbc373a6a5f71821b1141d11 -->
### Commit [`a7525ca`](https://github.com/superhero/operations.superduper.solutions/commit/a7525ca56448d8d0bbc373a6a5f71821b1141d11)

```text
ui: hide Svelte Flow attribution
```

<!-- changelog-commit:7ef5651ba84cc49b568d2dd9b15ede14a75656b2 -->
### Commit [`7ef5651`](https://github.com/superhero/operations.superduper.solutions/commit/7ef5651ba84cc49b568d2dd9b15ede14a75656b2)

```text
docs: consolidate UI decisions
```

<!-- changelog-commit:36a4a98d8ebc57c833ced0d5d5dfdaa3be8c510d -->
### Commit [`36a4a98`](https://github.com/superhero/operations.superduper.solutions/commit/36a4a98d8ebc57c833ced0d5d5dfdaa3be8c510d)

```text
ui: initialize shadcn-svelte
```

<!-- changelog-commit:15948de5b0749fef1b5e589fe34b140d9163867c -->
### Commit [`15948de`](https://github.com/superhero/operations.superduper.solutions/commit/15948de5b0749fef1b5e589fe34b140d9163867c)

```text
ui: add shadcn button
```

<!-- changelog-commit:6f7ebc11a55f746976ce31a6cd64171ec8b0e507 -->
### Commit [`6f7ebc1`](https://github.com/superhero/operations.superduper.solutions/commit/6f7ebc11a55f746976ce31a6cd64171ec8b0e507)

```text
ui: add shadcn sheet primitives
```

<!-- changelog-commit:0b2dd9eeac86e1071da36ec6bfd7ce61ac401e30 -->
### Commit [`0b2dd9e`](https://github.com/superhero/operations.superduper.solutions/commit/0b2dd9eeac86e1071da36ec6bfd7ce61ac401e30)

```text
ui: complete shadcn sheet
```

<!-- changelog-commit:78f2db6aaa20126eeb5d0453510dfc9567053b72 -->
### Commit [`78f2db6`](https://github.com/superhero/operations.superduper.solutions/commit/78f2db6aaa20126eeb5d0453510dfc9567053b72)

```text
ui: use shadcn controls
```

<!-- changelog-commit:d1a58346841ea61e510985e34e1faab0d78f70b2 -->
### Commit [`d1a5834`](https://github.com/superhero/operations.superduper.solutions/commit/d1a58346841ea61e510985e34e1faab0d78f70b2)

```text
fix: use TypeScript 7 path aliases
```

<!-- changelog-commit:1afb085d0354bef0e8038c8091364eb051f9f0a6 -->
### Commit [`1afb085`](https://github.com/superhero/operations.superduper.solutions/commit/1afb085d0354bef0e8038c8091364eb051f9f0a6)

```text
fix: align shadcn exports with tsc setup
```

<!-- changelog-commit:6725c2f6290bf6181f19e3f17b971eaa755aec46 -->
### Commit [`6725c2f`](https://github.com/superhero/operations.superduper.solutions/commit/6725c2f6290bf6181f19e3f17b971eaa755aec46)

```text
build: use Svelte-aware type checking
```

<!-- changelog-commit:fa4912a8282b3cbb6acff869b23303a9fd7fafaf -->
### Commit [`fa4912a`](https://github.com/superhero/operations.superduper.solutions/commit/fa4912a8282b3cbb6acff869b23303a9fd7fafaf)

```text
build: use Svelte-aware type checking
```

<!-- changelog-commit:978eef440ef451a7cbcebb2d6130c8f90fbc1407 -->
### Commit [`978eef4`](https://github.com/superhero/operations.superduper.solutions/commit/978eef440ef451a7cbcebb2d6130c8f90fbc1407)

```text
build: use Svelte-aware type checking
```

<!-- changelog-commit:56cf063d3982f6aa8c3e22f001ab129a8ddd9ab2 -->
### Commit [`56cf063`](https://github.com/superhero/operations.superduper.solutions/commit/56cf063d3982f6aa8c3e22f001ab129a8ddd9ab2)

```text
build: use Svelte-aware type checking
```

<!-- changelog-commit:1f9485ff4155c0e8e05547d3fb0ce5f20d37ef83 -->
### Commit [`1f9485f`](https://github.com/superhero/operations.superduper.solutions/commit/1f9485ff4155c0e8e05547d3fb0ce5f20d37ef83)

```text
build: use Svelte-aware type checking
```

<!-- changelog-commit:6b4abb20329a0b4602fa93a424ca7eb6c6ac4a5d -->
### Commit [`6b4abb2`](https://github.com/superhero/operations.superduper.solutions/commit/6b4abb20329a0b4602fa93a424ca7eb6c6ac4a5d)

```text
build: add tailwind merge runtime dependency
```

<!-- changelog-commit:56c79e62b6cd54e67739f5ca268b4d4fe83f1fec -->
### Commit [`56c79e6`](https://github.com/superhero/operations.superduper.solutions/commit/56c79e62b6cd54e67739f5ca268b4d4fe83f1fec)

```text
build: generate npm lockfile
```

<!-- changelog-commit:3886a4832c1ed5b172d6ccbe771161596523191c -->
### Commit [`3886a48`](https://github.com/superhero/operations.superduper.solutions/commit/3886a4832c1ed5b172d6ccbe771161596523191c)

```text
build: add package lock

```

<!-- changelog-commit:95347a97f89d0bc27e7f9e82e213fe6da7491679 -->
### Commit [`95347a9`](https://github.com/superhero/operations.superduper.solutions/commit/95347a97f89d0bc27e7f9e82e213fe6da7491679)

```text
ci: use npm lockfile
```

<!-- changelog-commit:841f0d614b3b7040bdc83b8b7ae547464d5b7ad8 -->
### Commit [`841f0d6`](https://github.com/superhero/operations.superduper.solutions/commit/841f0d614b3b7040bdc83b8b7ae547464d5b7ad8)

```text
build: remove lockfile generator
```

<!-- changelog-commit:5a601f3bbfd0979689d16531b03d30bda0166313 -->
### Commit [`5a601f3`](https://github.com/superhero/operations.superduper.solutions/commit/5a601f3bbfd0979689d16531b03d30bda0166313)

```text
release: bump version to 0.0.3
```

<!-- changelog-commit:5a756c461e181c71b418af3d3e5a7045333bb1aa -->
### Commit [`5a756c4`](https://github.com/superhero/operations.superduper.solutions/commit/5a756c461e181c71b418af3d3e5a7045333bb1aa)

```text
release: sync lockfile version
```

<!-- changelog-commit:4a3b43126bb194c86a4d62dd8af8e7a2a8745560 -->
### Commit [`4a3b431`](https://github.com/superhero/operations.superduper.solutions/commit/4a3b43126bb194c86a4d62dd8af8e7a2a8745560)

```text
ci: prepare source test output directory
```

<!-- changelog-commit:80f99d57047c693aa9c6f902d52f5bb4c898bd44 -->
### Commit [`80f99d5`](https://github.com/superhero/operations.superduper.solutions/commit/80f99d57047c693aa9c6f902d52f5bb4c898bd44)

```text
test: exclude shadcn UI infrastructure from coverage
```

## 0.0.2

<!-- changelog-commit:c194d42467fca8789bd81633855e53382acfd02d -->
### Commit [`c194d42`](https://github.com/superhero/operations.superduper.solutions/commit/c194d42467fca8789bd81633855e53382acfd02d)

```text
ci: show deployment commits as hierarchy
```

<!-- changelog-commit:756be3337e04e111e6fba0d5c2ee4da787c3a425 -->
### Commit [`756be33`](https://github.com/superhero/operations.superduper.solutions/commit/756be3337e04e111e6fba0d5c2ee4da787c3a425)

```text
docs: add main and develop CI badges
```

<!-- changelog-commit:eab3f302a51d33fdee585c282a54d6f20936feea -->
### Commit [`eab3f30`](https://github.com/superhero/operations.superduper.solutions/commit/eab3f302a51d33fdee585c282a54d6f20936feea)

```text
docs: link CI badges to branch-specific workflow runs
```

<!-- changelog-commit:1200937c526c72d1cf9328b236713cb9040bf45e -->
### Commit [`1200937`](https://github.com/superhero/operations.superduper.solutions/commit/1200937c526c72d1cf9328b236713cb9040bf45e)

```text
docs: remove coverage badge workflow link
```

<!-- changelog-commit:67befbeda32c2918580bd6556e2c7a5495ae2068 -->
### Commit [`67befbe`](https://github.com/superhero/operations.superduper.solutions/commit/67befbeda32c2918580bd6556e2c7a5495ae2068)

```text
docs: simplify development status
```

<!-- changelog-commit:aaacf46f2cdfbf7df782f093c15c31bc310aff83 -->
### Commit [`aaacf46`](https://github.com/superhero/operations.superduper.solutions/commit/aaacf46f2cdfbf7df782f093c15c31bc310aff83)

```text
docs: simplify ADR title
```

<!-- changelog-commit:95afddaf2873388a85c0795a159ff5e09dcbb0d7 -->
### Commit [`95afdda`](https://github.com/superhero/operations.superduper.solutions/commit/95afddaf2873388a85c0795a159ff5e09dcbb0d7)

```text
docs: structure contributing license sections
```

<!-- changelog-commit:0e79f93b41d08fcd654bc5a089b82bced440dc38 -->
### Commit [`0e79f93`](https://github.com/superhero/operations.superduper.solutions/commit/0e79f93b41d08fcd654bc5a089b82bced440dc38)

```text
docs: remove redundant additional terms section
```

<!-- changelog-commit:810acb864f1c6c8e32b54f93dc4f08dd68eb90ba -->
### Commit [`810acb8`](https://github.com/superhero/operations.superduper.solutions/commit/810acb864f1c6c8e32b54f93dc4f08dd68eb90ba)

```text
ci: use npm scripts as CI entry points
```

<!-- changelog-commit:32feb369ba6f056215ba359a130b0ac06b2767c5 -->
### Commit [`32feb36`](https://github.com/superhero/operations.superduper.solutions/commit/32feb369ba6f056215ba359a130b0ac06b2767c5)

```text
ci: make coverage scripts self-contained
```

<!-- changelog-commit:fb1ce74f667499b4271e2d7dca78c959b99a379e -->
### Commit [`fb1ce74`](https://github.com/superhero/operations.superduper.solutions/commit/fb1ce74f667499b4271e2d7dca78c959b99a379e)

```text
ci: let npm prepare coverage directory
```

<!-- changelog-commit:78d6f1d80dc95f8f9fe6743f4f2a1da23854c578 -->
### Commit [`78d6f1d`](https://github.com/superhero/operations.superduper.solutions/commit/78d6f1d80dc95f8f9fe6743f4f2a1da23854c578)

```text
chore: ignore tmp directory
```

<!-- changelog-commit:abf19d315038680ca9cc679b1a8528a62efe9446 -->
### Commit [`abf19d3`](https://github.com/superhero/operations.superduper.solutions/commit/abf19d315038680ca9cc679b1a8528a62efe9446)

```text
chore: remove tmp placeholder
```

<!-- changelog-commit:6bfe963c349226e90f93f6136847f537ae07e79f -->
### Commit [`6bfe963`](https://github.com/superhero/operations.superduper.solutions/commit/6bfe963c349226e90f93f6136847f537ae07e79f)

```text
docs: use lowercase adr directory
```

<!-- changelog-commit:bc0ad794d016182d68e7b46dd02274b2871b98c1 -->
### Commit [`bc0ad79`](https://github.com/superhero/operations.superduper.solutions/commit/bc0ad794d016182d68e7b46dd02274b2871b98c1)

```text
docs: make color ADR theme-oriented
```

<!-- changelog-commit:94c7358dfbcfaf7c0d770a07ea346e521bdd6055 -->
### Commit [`94c7358`](https://github.com/superhero/operations.superduper.solutions/commit/94c7358dfbcfaf7c0d770a07ea346e521bdd6055)

```text
docs: simplify simplify ADR
```

<!-- changelog-commit:7a9493ae597c5fc13369a5360cf65c87525199ff -->
### Commit [`7a9493a`](https://github.com/superhero/operations.superduper.solutions/commit/7a9493ae597c5fc13369a5360cf65c87525199ff)

```text
docs: link Gitflow ADR
```

<!-- changelog-commit:b9535f8fbfc2a7a4dbaaa1b5661fb26b10f1a756 -->
### Commit [`b9535f8`](https://github.com/superhero/operations.superduper.solutions/commit/b9535f8fbfc2a7a4dbaaa1b5661fb26b10f1a756)

```text
docs: add Gitflow ADR
```

<!-- changelog-commit:35e4b25878892fc3e0c829f4e41ed515601c08d5 -->
### Commit [`35e4b25`](https://github.com/superhero/operations.superduper.solutions/commit/35e4b25878892fc3e0c829f4e41ed515601c08d5)

```text
docs: link Gitflow ADR
```

<!-- changelog-commit:53a987fc78eb41c14393a4aebc09e3a878579787 -->
### Commit [`53a987f`](https://github.com/superhero/operations.superduper.solutions/commit/53a987fc78eb41c14393a4aebc09e3a878579787)

```text
chore: release 0.0.2
```

<!-- changelog-commit:f40727a8cd8a31f05f8f492126817e2f8466acea -->
### Commit [`f40727a`](https://github.com/superhero/operations.superduper.solutions/commit/f40727a8cd8a31f05f8f492126817e2f8466acea)

```text
fix: ignore completed release branches
```

## 0.0.1

<!-- changelog-commit:5109e52084d4419b9708b2897d9ce844d05bae64 -->
### Commit [`5109e52`](https://github.com/superhero/operations.superduper.solutions/commit/5109e52084d4419b9708b2897d9ce844d05bae64)

```text
Add GNU AGPLv3 license
```

<!-- changelog-commit:e305d03c3506b82783b45baf32d5e6cc0f74e0b3 -->
### Commit [`e305d03`](https://github.com/superhero/operations.superduper.solutions/commit/e305d03c3506b82783b45baf32d5e6cc0f74e0b3)

```text
Set up repository
```

<!-- changelog-commit:c95b6f9f087f26af7fe94552b205c122b6521f42 -->
### Commit [`c95b6f9`](https://github.com/superhero/operations.superduper.solutions/commit/c95b6f9f087f26af7fe94552b205c122b6521f42)

```text
chore: add package.json
```

<!-- changelog-commit:391f5809d1131c6d8a3d95af91b22d7dd62f70eb -->
### Commit [`391f580`](https://github.com/superhero/operations.superduper.solutions/commit/391f5809d1131c6d8a3d95af91b22d7dd62f70eb)

```text
chore: add tsconfig.json
```

<!-- changelog-commit:0153792d1e5cffcffcd07bab0306d61b5fdd5580 -->
### Commit [`0153792`](https://github.com/superhero/operations.superduper.solutions/commit/0153792d1e5cffcffcd07bab0306d61b5fdd5580)

```text
chore: add .gitignore
```

<!-- changelog-commit:2460add5cc93cc0dfa5715a1b9799994045fbe82 -->
### Commit [`2460add`](https://github.com/superhero/operations.superduper.solutions/commit/2460add5cc93cc0dfa5715a1b9799994045fbe82)

```text
chore: add src/index.ts
```

<!-- changelog-commit:013084a4282c39463e67edbd5787f2f41cd4633c -->
### Commit [`013084a`](https://github.com/superhero/operations.superduper.solutions/commit/013084a4282c39463e67edbd5787f2f41cd4633c)

```text
chore: add TypeScript test dependencies
```

<!-- changelog-commit:e2e77c286ccad326f196294061b0c875ca24dfb4 -->
### Commit [`e2e77c2`](https://github.com/superhero/operations.superduper.solutions/commit/e2e77c286ccad326f196294061b0c875ca24dfb4)

```text
chore: add coverage and cucumber report dependencies
```

<!-- changelog-commit:20b22a090d0b42db2255fc41801403982ced77c9 -->
### Commit [`20b22a0`](https://github.com/superhero/operations.superduper.solutions/commit/20b22a090d0b42db2255fc41801403982ced77c9)

```text
chore: pin exact latest dev dependency versions
```

<!-- changelog-commit:718c713b80ea74025cb6d7cd9a46738b617fa120 -->
### Commit [`718c713`](https://github.com/superhero/operations.superduper.solutions/commit/718c713b80ea74025cb6d7cd9a46738b617fa120)

```text
chore: declare expected Node.js version
```

<!-- changelog-commit:5d7d681165cb586e82ff02eef1a0cdc7fc0dbe15 -->
### Commit [`5d7d681`](https://github.com/superhero/operations.superduper.solutions/commit/5d7d681165cb586e82ff02eef1a0cdc7fc0dbe15)

```text
chore: update expected Node and npm versions
```

<!-- changelog-commit:87b98b820d73dfdd5ffbbdf98384eccd6d93ae7e -->
### Commit [`87b98b8`](https://github.com/superhero/operations.superduper.solutions/commit/87b98b820d73dfdd5ffbbdf98384eccd6d93ae7e)

```text
chore: restrict published package files to dist
```

<!-- changelog-commit:b851cb13ca65f3ed95f4cb08f41a085b49af52a3 -->
### Commit [`b851cb1`](https://github.com/superhero/operations.superduper.solutions/commit/b851cb13ca65f3ed95f4cb08f41a085b49af52a3)

```text
chore: update package metadata
```

<!-- changelog-commit:489daa84d39a4682470c5f9e9a5ecced31ea0439 -->
### Commit [`489daa8`](https://github.com/superhero/operations.superduper.solutions/commit/489daa84d39a4682470c5f9e9a5ecced31ea0439)

```text
chore: define build pipeline
```

<!-- changelog-commit:bf489266a0c373ced2faf981981f3123c7e8d016 -->
### Commit [`bf48926`](https://github.com/superhero/operations.superduper.solutions/commit/bf489266a0c373ced2faf981981f3123c7e8d016)

```text
fix: remove unintended pre build step
```

<!-- changelog-commit:3c0ec56d5ddceee6046ff09e784703016f2b4049 -->
### Commit [`3c0ec56`](https://github.com/superhero/operations.superduper.solutions/commit/3c0ec56d5ddceee6046ff09e784703016f2b4049)

```text
chore: update TypeScript include patterns
```

<!-- changelog-commit:2f70840b9420c816705de5ffcfdd816c34725443 -->
### Commit [`2f70840`](https://github.com/superhero/operations.superduper.solutions/commit/2f70840b9420c816705de5ffcfdd816c34725443)

```text
chore: target ES2024
```

<!-- changelog-commit:01b46fa6b135e43c1340440e5854827a3a05cb51 -->
### Commit [`01b46fa`](https://github.com/superhero/operations.superduper.solutions/commit/01b46fa6b135e43c1340440e5854827a3a05cb51)

```text
chore: configure TypeScript compiler options
```

<!-- changelog-commit:34800b61c0474c2ac96efaa1e313981a28e9a774 -->
### Commit [`34800b6`](https://github.com/superhero/operations.superduper.solutions/commit/34800b61c0474c2ac96efaa1e313981a28e9a774)

```text
chore: add Node version file
```

<!-- changelog-commit:def16059a94a772ae58edd1e1f737f2a01965859 -->
### Commit [`def1605`](https://github.com/superhero/operations.superduper.solutions/commit/def16059a94a772ae58edd1e1f737f2a01965859)

```text
chore: add Cucumber configuration
```

<!-- changelog-commit:7a759f00da1f92085785da5c75403ce687c9aa71 -->
### Commit [`7a759f0`](https://github.com/superhero/operations.superduper.solutions/commit/7a759f00da1f92085785da5c75403ce687c9aa71)

```text
chore: update ignored generated files
```

<!-- changelog-commit:591331694f5e68bc16b4ab2b37bfd110fd1c1aa6 -->
### Commit [`5913316`](https://github.com/superhero/operations.superduper.solutions/commit/591331694f5e68bc16b4ab2b37bfd110fd1c1aa6)

```text
chore: keep temp directory
```

<!-- changelog-commit:c8bb9c4652c3e0abaf3ec575563b8b2f013a2223 -->
### Commit [`c8bb9c4`](https://github.com/superhero/operations.superduper.solutions/commit/c8bb9c4652c3e0abaf3ec575563b8b2f013a2223)

```text
chore: copy HTML into build output
```

<!-- changelog-commit:e2a3dfb9c7156da6f1162092024931aa538f4c87 -->
### Commit [`e2a3dfb`](https://github.com/superhero/operations.superduper.solutions/commit/e2a3dfb9c7156da6f1162092024931aa538f4c87)

```text
fix: align TypeScript rootDir with source directory
```

<!-- changelog-commit:a6dcd33dd3b37fc4ed50483a3c58631c15c7e3d7 -->
### Commit [`a6dcd33`](https://github.com/superhero/operations.superduper.solutions/commit/a6dcd33dd3b37fc4ed50483a3c58631c15c7e3d7)

```text
feat: add browser entry point
```

<!-- changelog-commit:5a5ae99baf2d2526460b7815cd6d92cdf98a84b1 -->
### Commit [`5a5ae99`](https://github.com/superhero/operations.superduper.solutions/commit/5a5ae99baf2d2526460b7815cd6d92cdf98a84b1)

```text
feat: add application HTML shell
```

<!-- changelog-commit:158ba722eaddb7c515bb329b4e21e6c0d91e2fed -->
### Commit [`158ba72`](https://github.com/superhero/operations.superduper.solutions/commit/158ba722eaddb7c515bb329b4e21e6c0d91e2fed)

```text
chore: move entry point to source directory
```

<!-- changelog-commit:b3c02e1310cdf46d41f872051fc31ffa180b7101 -->
### Commit [`b3c02e1`](https://github.com/superhero/operations.superduper.solutions/commit/b3c02e1310cdf46d41f872051fc31ffa180b7101)

```text
chore: remove Node types from frontend package
```

<!-- changelog-commit:a545a9b3c69003821fecf72397bbfb7317d6811d -->
### Commit [`a545a9b`](https://github.com/superhero/operations.superduper.solutions/commit/a545a9b3c69003821fecf72397bbfb7317d6811d)

```text
chore: remove Node types from frontend TypeScript config
```

<!-- changelog-commit:97acef30fd296756d8974276f78c44685ee3a4dc -->
### Commit [`97acef3`](https://github.com/superhero/operations.superduper.solutions/commit/97acef30fd296756d8974276f78c44685ee3a4dc)

```text
chore: add coverage and test run scripts
```

<!-- changelog-commit:4c431f416aa388dd424e6155fa1433caf2113fec -->
### Commit [`4c431f4`](https://github.com/superhero/operations.superduper.solutions/commit/4c431f416aa388dd424e6155fa1433caf2113fec)

```text
build: add esbuild production bundling
```

<!-- changelog-commit:bc21941c3ed541e01ca3223c1ce35d749e847de9 -->
### Commit [`bc21941`](https://github.com/superhero/operations.superduper.solutions/commit/bc21941c3ed541e01ca3223c1ce35d749e847de9)

```text
build: add single-page esbuild bundler
```

<!-- changelog-commit:96689f0dcbcde9a38c789c9c20ac10f35545727e -->
### Commit [`96689f0`](https://github.com/superhero/operations.superduper.solutions/commit/96689f0dcbcde9a38c789c9c20ac10f35545727e)

```text
build: make esbuild own production output
```

<!-- changelog-commit:0f6f14cd5c1518a24535a1ef05acf2e3a3ecfd75 -->
### Commit [`0f6f14c`](https://github.com/superhero/operations.superduper.solutions/commit/0f6f14cd5c1518a24535a1ef05acf2e3a3ecfd75)

```text
build: emit a single self-contained HTML artifact
```

<!-- changelog-commit:be4ed328a52f616aa7002167baa21a687104e6e4 -->
### Commit [`be4ed32`](https://github.com/superhero/operations.superduper.solutions/commit/be4ed328a52f616aa7002167baa21a687104e6e4)

```text
fix: collect coverage from TypeScript source
```

<!-- changelog-commit:2ae16c3ac8e097e0551772a851c0ae6c939e3663 -->
### Commit [`2ae16c3`](https://github.com/superhero/operations.superduper.solutions/commit/2ae16c3ac8e097e0551772a851c0ae6c939e3663)

```text
feat: add Svelte and build smoke test
```

<!-- changelog-commit:9f8033ef0da5dc83c0c0acddc00014996c8673cb -->
### Commit [`9f8033e`](https://github.com/superhero/operations.superduper.solutions/commit/9f8033ef0da5dc83c0c0acddc00014996c8673cb)

```text
build: compile Svelte components with esbuild
```

<!-- changelog-commit:b3d4e5daff473caa21db1eeb4e21056d36daf24c -->
### Commit [`b3d4e5d`](https://github.com/superhero/operations.superduper.solutions/commit/b3d4e5daff473caa21db1eeb4e21056d36daf24c)

```text
test: load Cucumber steps from source
```

<!-- changelog-commit:3d6312d86938a61bdb1d2549869ea1991e8ccb47 -->
### Commit [`3d6312d`](https://github.com/superhero/operations.superduper.solutions/commit/3d6312d86938a61bdb1d2549869ea1991e8ccb47)

```text
feat: mount Svelte application
```

<!-- changelog-commit:147ae82e7c6b56c916a1d0889f7df443672fc2d8 -->
### Commit [`147ae82`](https://github.com/superhero/operations.superduper.solutions/commit/147ae82e7c6b56c916a1d0889f7df443672fc2d8)

```text
feat: add initial Svelte application
```

<!-- changelog-commit:dee96308a9af9914131ed231c83f13edfaf022a4 -->
### Commit [`dee9630`](https://github.com/superhero/operations.superduper.solutions/commit/dee96308a9af9914131ed231c83f13edfaf022a4)

```text
chore: declare Svelte component modules
```

<!-- changelog-commit:ee9a55cdef196f7b7a153360540a0908bdc85c8d -->
### Commit [`ee9a55c`](https://github.com/superhero/operations.superduper.solutions/commit/ee9a55cdef196f7b7a153360540a0908bdc85c8d)

```text
test: add production build smoke feature
```

<!-- changelog-commit:829dea2992bcc2334c87b6ce0af7d153efbad9fd -->
### Commit [`829dea2`](https://github.com/superhero/operations.superduper.solutions/commit/829dea2992bcc2334c87b6ce0af7d153efbad9fd)

```text
test: add production build smoke steps
```

<!-- changelog-commit:e44f783866eb12082acb326e05e230698bd4dc9b -->
### Commit [`e44f783`](https://github.com/superhero/operations.superduper.solutions/commit/e44f783866eb12082acb326e05e230698bd4dc9b)

```text
test: expand production build smoke scenarios
```

<!-- changelog-commit:b054e13fdd756c011aad66a8172e441887e9b6ab -->
### Commit [`b054e13`](https://github.com/superhero/operations.superduper.solutions/commit/b054e13fdd756c011aad66a8172e441887e9b6ab)

```text
test: add production build smoke assertions
```

<!-- changelog-commit:1bceca48e77f3c4954061e5e1017ae700367ac43 -->
### Commit [`1bceca4`](https://github.com/superhero/operations.superduper.solutions/commit/1bceca48e77f3c4954061e5e1017ae700367ac43)

```text
fix: prepare test report directory
```

<!-- changelog-commit:b0d710ee2a722f7a599ce0a5d96ba7224d1bf29e -->
### Commit [`b0d710e`](https://github.com/superhero/operations.superduper.solutions/commit/b0d710ee2a722f7a599ce0a5d96ba7224d1bf29e)

```text
fix: identify in-memory esbuild outputs
```

<!-- changelog-commit:c63e1ca06564b17ce736898254b66c353c736061 -->
### Commit [`c63e1ca`](https://github.com/superhero/operations.superduper.solutions/commit/c63e1ca06564b17ce736898254b66c353c736061)

```text
ci: add build and test workflow
```

<!-- changelog-commit:193f7bd2d4c7c89c9d86179a6959d50e03e9c515 -->
### Commit [`193f7bd`](https://github.com/superhero/operations.superduper.solutions/commit/193f7bd2d4c7c89c9d86179a6959d50e03e9c515)

```text
ci: add coverage reporting
```

<!-- changelog-commit:d768d6d924b992cffe70e58c8858b13e712bcfea -->
### Commit [`d768d6d`](https://github.com/superhero/operations.superduper.solutions/commit/d768d6d924b992cffe70e58c8858b13e712bcfea)

```text
ci: reuse build artifact for coverage
```

<!-- changelog-commit:fe1bfc7e9b82918c79332edda016f8ddb7629666 -->
### Commit [`fe1bfc7`](https://github.com/superhero/operations.superduper.solutions/commit/fe1bfc7e9b82918c79332edda016f8ddb7629666)

```text
ci: split build test and coverage jobs
```

<!-- changelog-commit:1f9d037827c5000d768512b2a44ea4951cb51c8d -->
### Commit [`1f9d037`](https://github.com/superhero/operations.superduper.solutions/commit/1f9d037827c5000d768512b2a44ea4951cb51c8d)

```text
ci: add deploy stage
```

<!-- changelog-commit:cfbdd5e5ec5511c91e0465f295d532fb921aaee4 -->
### Commit [`cfbdd5e`](https://github.com/superhero/operations.superduper.solutions/commit/cfbdd5e5ec5511c91e0465f295d532fb921aaee4)

```text
ci: use descriptive Cloudflare deployment secret
```

<!-- changelog-commit:83a795b82b8a37b946fe43929e257e8d8c2ecd50 -->
### Commit [`83a795b`](https://github.com/superhero/operations.superduper.solutions/commit/83a795b82b8a37b946fe43929e257e8d8c2ecd50)

```text
ci: rename Cloudflare Pages API token secret
```

<!-- changelog-commit:3ae3755a3086c7cd1c1d926e4361f8e10b96e1b2 -->
### Commit [`3ae3755`](https://github.com/superhero/operations.superduper.solutions/commit/3ae3755a3086c7cd1c1d926e4361f8e10b96e1b2)

```text
ci: use Cloudflare account ID directly
```

<!-- changelog-commit:2e604fcbe771aca2f3a85ee291b6ac6029d571e3 -->
### Commit [`2e604fc`](https://github.com/superhero/operations.superduper.solutions/commit/2e604fcbe771aca2f3a85ee291b6ac6029d571e3)

```text
ci: read Cloudflare account ID from repository variable
```

<!-- changelog-commit:684869625335a8ebe3d21a04aecf6bc360930abc -->
### Commit [`6848696`](https://github.com/superhero/operations.superduper.solutions/commit/684869625335a8ebe3d21a04aecf6bc360930abc)

```text
ci: allow GitHub deployment records
```

<!-- changelog-commit:1d4054f17653e922d3eb3a58b982e160f257e70f -->
### Commit [`1d4054f`](https://github.com/superhero/operations.superduper.solutions/commit/1d4054f17653e922d3eb3a58b982e160f257e70f)

```text
ci: pin runners to Ubuntu 26.04
```

<!-- changelog-commit:f20126f4d7a1421936942c93fd33796454479b6c -->
### Commit [`f20126f`](https://github.com/superhero/operations.superduper.solutions/commit/f20126f4d7a1421936942c93fd33796454479b6c)

```text
ci: use ubuntu-latest runners
```

<!-- changelog-commit:26fd0b20c57790febe7ca54450feb0bcc71c3348 -->
### Commit [`26fd0b2`](https://github.com/superhero/operations.superduper.solutions/commit/26fd0b20c57790febe7ca54450feb0bcc71c3348)

```text
ci: fork report publishing from main pipeline
```

<!-- changelog-commit:cd0274ae8129ec865943d2c71fcf6b67594f09b4 -->
### Commit [`cd0274a`](https://github.com/superhero/operations.superduper.solutions/commit/cd0274ae8129ec865943d2c71fcf6b67594f09b4)

```text
ci: add non-blocking build report branch
```

<!-- changelog-commit:f072eeeb5a38f7bce916c56a91db816ff795bf64 -->
### Commit [`f072eee`](https://github.com/superhero/operations.superduper.solutions/commit/f072eeeb5a38f7bce916c56a91db816ff795bf64)

```text
ci: keep report forks without duplicate artifacts
```

<!-- changelog-commit:fc3cfb00146badd1341c646f061b553be9830774 -->
### Commit [`fc3cfb0`](https://github.com/superhero/operations.superduper.solutions/commit/fc3cfb00146badd1341c646f061b553be9830774)

```text
ci: prioritize main pipeline over report jobs
```

<!-- changelog-commit:0f06fb87844f414588fbdf1d24b465038f780f0e -->
### Commit [`0f06fb8`](https://github.com/superhero/operations.superduper.solutions/commit/0f06fb87844f414588fbdf1d24b465038f780f0e)

```text
ci: restore report forks and update cache actions
```

<!-- changelog-commit:968938dc28714be7bcdee515e6dd657401942fd0 -->
### Commit [`968938d`](https://github.com/superhero/operations.superduper.solutions/commit/968938dc28714be7bcdee515e6dd657401942fd0)

```text
ci: render useful build summary
```

<!-- changelog-commit:cd363b413bda71d953fa48dc1a37da6dfa6de474 -->
### Commit [`cd363b4`](https://github.com/superhero/operations.superduper.solutions/commit/cd363b413bda71d953fa48dc1a37da6dfa6de474)

```text
build: generate detailed build report
```

<!-- changelog-commit:fd41de2bc14394162bf8bcb1448907d191ce484a -->
### Commit [`fd41de2`](https://github.com/superhero/operations.superduper.solutions/commit/fd41de2bc14394162bf8bcb1448907d191ce484a)

```text
ci: publish build metadata summary
```

<!-- changelog-commit:880b18ed0877d4f17240c67606ad207ee7a2772b -->
### Commit [`880b18e`](https://github.com/superhero/operations.superduper.solutions/commit/880b18ed0877d4f17240c67606ad207ee7a2772b)

```text
build: hide dependencies from build report inputs
```

<!-- changelog-commit:6a0ba8012463e122fb4dd138a5d384676f9ea8d7 -->
### Commit [`6a0ba80`](https://github.com/superhero/operations.superduper.solutions/commit/6a0ba8012463e122fb4dd138a5d384676f9ea8d7)

```text
build: simplify report stage labels
```

<!-- changelog-commit:710b12dd09c2b06212cf1d434f8e857fb9ca88a8 -->
### Commit [`710b12d`](https://github.com/superhero/operations.superduper.solutions/commit/710b12dd09c2b06212cf1d434f8e857fb9ca88a8)

```text
build: render report as Mermaid diagrams
```

<!-- changelog-commit:7fa3b940338e0a6285dd57f51ecc7407520b1449 -->
### Commit [`7fa3b94`](https://github.com/superhero/operations.superduper.solutions/commit/7fa3b940338e0a6285dd57f51ecc7407520b1449)

```text
build: use state diagram for build process
```

<!-- changelog-commit:5ffd88bf1483794c785b9ff61b28036b3043810e -->
### Commit [`5ffd88b`](https://github.com/superhero/operations.superduper.solutions/commit/5ffd88bf1483794c785b9ff61b28036b3043810e)

```text
build: simplify process diagram labels
```

<!-- changelog-commit:0c5b19bba934ffe0a9bf0d4490924e37e8801346 -->
### Commit [`0c5b19b`](https://github.com/superhero/operations.superduper.solutions/commit/0c5b19bba934ffe0a9bf0d4490924e37e8801346)

```text
build: try requirement diagram for process
```

<!-- changelog-commit:c08dfdd4d440992e005488229cd63ad481d27083 -->
### Commit [`c08dfdd`](https://github.com/superhero/operations.superduper.solutions/commit/c08dfdd4d440992e005488229cd63ad481d27083)

```text
build: use requirement diagram for file graph
```

<!-- changelog-commit:73fbb5829c31debdd5aa983e6f1670bbec9bc478 -->
### Commit [`73fbb58`](https://github.com/superhero/operations.superduper.solutions/commit/73fbb5829c31debdd5aa983e6f1670bbec9bc478)

```text
build: render diagrams top to bottom
```

<!-- changelog-commit:9e4b05cdeba10d9e6703566200b10862457e34e0 -->
### Commit [`9e4b05c`](https://github.com/superhero/operations.superduper.solutions/commit/9e4b05cdeba10d9e6703566200b10862457e34e0)

```text
build: use human-readable class diagrams
```

<!-- changelog-commit:87be460400ce1a656181585eb0fc22cf0ef3f2bf -->
### Commit [`87be460`](https://github.com/superhero/operations.superduper.solutions/commit/87be460400ce1a656181585eb0fc22cf0ef3f2bf)

```text
build: simplify process class diagram
```

<!-- changelog-commit:decd87d70b4c392445d7464e8b771734a5950682 -->
### Commit [`decd87d`](https://github.com/superhero/operations.superduper.solutions/commit/decd87d70b4c392445d7464e8b771734a5950682)

```text
build: fix Mermaid class diagram syntax
```

<!-- changelog-commit:bc541627265b438a58d9365b41f91798f50ba041 -->
### Commit [`bc54162`](https://github.com/superhero/operations.superduper.solutions/commit/bc541627265b438a58d9365b41f91798f50ba041)

```text
build: fix Mermaid parser-safe class syntax
```

<!-- changelog-commit:267b5a977d51029f14ae0f7d5367aa48e634f0c5 -->
### Commit [`267b5a9`](https://github.com/superhero/operations.superduper.solutions/commit/267b5a977d51029f14ae0f7d5367aa48e634f0c5)

```text
build: align report diagram with handbook style
```

<!-- changelog-commit:459268f80ff61fd9c3477fcc652cc25a00f9b915 -->
### Commit [`459268f`](https://github.com/superhero/operations.superduper.solutions/commit/459268f80ff61fd9c3477fcc652cc25a00f9b915)

```text
build: remove markdown from Mermaid labels
```

<!-- changelog-commit:845140bec388f7b84d09d8bf88b8a6d5276f2d95 -->
### Commit [`845140b`](https://github.com/superhero/operations.superduper.solutions/commit/845140bec388f7b84d09d8bf88b8a6d5276f2d95)

```text
build: mirror handbook layered diagram style
```

<!-- changelog-commit:67c06ba30c575d695eb4834bd58d1ce44ed89d88 -->
### Commit [`67c06ba`](https://github.com/superhero/operations.superduper.solutions/commit/67c06ba30c575d695eb4834bd58d1ce44ed89d88)

```text
build: deepen handbook-style report hierarchy
```

<!-- changelog-commit:b7923244252954aefefeac0348597a43c380a854 -->
### Commit [`b792324`](https://github.com/superhero/operations.superduper.solutions/commit/b7923244252954aefefeac0348597a43c380a854)

```text
build: force vertical report layout
```

<!-- changelog-commit:a806b6dcf8c316e9a32e3dc558c6fe975d04d5e4 -->
### Commit [`a806b6d`](https://github.com/superhero/operations.superduper.solutions/commit/a806b6dcf8c316e9a32e3dc558c6fe975d04d5e4)

```text
build: normalize report operation labels
```

<!-- changelog-commit:b529516123b0b63921bf3c8ef7242c8fc4d23894 -->
### Commit [`b529516`](https://github.com/superhero/operations.superduper.solutions/commit/b529516123b0b63921bf3c8ef7242c8fc4d23894)

```text
build: separate build transformations accurately
```

<!-- changelog-commit:487304dd7b4dfb45325150654649d4d10915bc37 -->
### Commit [`487304d`](https://github.com/superhero/operations.superduper.solutions/commit/487304dd7b4dfb45325150654649d4d10915bc37)

```text
ci: remove build report
```

<!-- changelog-commit:313a7351ca9737109b74a4efdacb2f909daf0622 -->
### Commit [`313a735`](https://github.com/superhero/operations.superduper.solutions/commit/313a7351ca9737109b74a4efdacb2f909daf0622)

```text
ci: build frontend with Vite
```

<!-- changelog-commit:013f48d568b1397782be72ff749dc54dda28e23f -->
### Commit [`013f48d`](https://github.com/superhero/operations.superduper.solutions/commit/013f48d568b1397782be72ff749dc54dda28e23f)

```text
test: accept Vite inline tag attributes
```

<!-- changelog-commit:f0ec92665e720e0a07eebcbbe26d83a052c2662f -->
### Commit [`f0ec926`](https://github.com/superhero/operations.superduper.solutions/commit/f0ec92665e720e0a07eebcbbe26d83a052c2662f)

```text
ci: rename build stage to bundle
```

<!-- changelog-commit:9887e7bea4cd7559178b0cfaa41bceb04d191b4e -->
### Commit [`9887e7b`](https://github.com/superhero/operations.superduper.solutions/commit/9887e7bea4cd7559178b0cfaa41bceb04d191b4e)

```text
ci: split type check from bundle
```

<!-- changelog-commit:c045caa0816d21091a9d1e1e893b9dad09820423 -->
### Commit [`c045caa`](https://github.com/superhero/operations.superduper.solutions/commit/c045caa0816d21091a9d1e1e893b9dad09820423)

```text
ci: wait for test report before coverage report
```

<!-- changelog-commit:9e94281c39a0c695c93964015bba8fa1c5b3a075 -->
### Commit [`9e94281`](https://github.com/superhero/operations.superduper.solutions/commit/9e94281c39a0c695c93964015bba8fa1c5b3a075)

```text
ci: share dependencies across jobs
```

<!-- changelog-commit:a05140a432e086cb925ecdd74b210d957062f42d -->
### Commit [`a05140a`](https://github.com/superhero/operations.superduper.solutions/commit/a05140a432e086cb925ecdd74b210d957062f42d)

```text
ci: rename dependencies job to installation
```

<!-- changelog-commit:010f412531398e6cede693b5b6afadaa2b171610 -->
### Commit [`010f412`](https://github.com/superhero/operations.superduper.solutions/commit/010f412531398e6cede693b5b6afadaa2b171610)

```text
ci: summarize deployed commits
```

<!-- changelog-commit:1ab775d7cb15bbca4dd639ee3a18167607eea0a4 -->
### Commit [`1ab775d`](https://github.com/superhero/operations.superduper.solutions/commit/1ab775d7cb15bbca4dd639ee3a18167607eea0a4)

```text
ci: include test and coverage output in summaries
```

<!-- changelog-commit:947bf32fe90036d53aee2ad04dcbc7d0f7ac33c4 -->
### Commit [`947bf32`](https://github.com/superhero/operations.superduper.solutions/commit/947bf32fe90036d53aee2ad04dcbc7d0f7ac33c4)

```text
ci: make test output human readable
```

<!-- changelog-commit:2f3ad9bace16fa450109d5457dae376f4e11adcb -->
### Commit [`2f3ad9b`](https://github.com/superhero/operations.superduper.solutions/commit/2f3ad9bace16fa450109d5457dae376f4e11adcb)

```text
ci: clean test and coverage summaries
```

<!-- changelog-commit:a3a0bb455e12dc804406534391b81029891d5ca6 -->
### Commit [`a3a0bb4`](https://github.com/superhero/operations.superduper.solutions/commit/a3a0bb455e12dc804406534391b81029891d5ca6)

```text
ci: hide cucumber source locations in summary
```

<!-- changelog-commit:8725eeb5cfa4dd3c35c1731901397023e16f3a40 -->
### Commit [`8725eeb`](https://github.com/superhero/operations.superduper.solutions/commit/8725eeb5cfa4dd3c35c1731901397023e16f3a40)

```text
ci: simplify run summaries
```

<!-- changelog-commit:a3e403efbfb98ec9f959642aa64fd3e9b31b97fd -->
### Commit [`a3e403e`](https://github.com/superhero/operations.superduper.solutions/commit/a3e403efbfb98ec9f959642aa64fd3e9b31b97fd)

```text
ci: remove redundant deployment heading
```

<!-- changelog-commit:e844e3bcb19d8b7052d886bb3aba6cbf487ee498 -->
### Commit [`e844e3b`](https://github.com/superhero/operations.superduper.solutions/commit/e844e3bcb19d8b7052d886bb3aba6cbf487ee498)

```text
ci: simplify deployment summary table
```

<!-- changelog-commit:82220658982307bc3d1a3f797ebcf62247428876 -->
### Commit [`8222065`](https://github.com/superhero/operations.superduper.solutions/commit/82220658982307bc3d1a3f797ebcf62247428876)

```text
ci: simplify preview URL summary
```

<!-- changelog-commit:9625227888c4eca592bb9a35b332d8a513a9a1f4 -->
### Commit [`9625227`](https://github.com/superhero/operations.superduper.solutions/commit/9625227888c4eca592bb9a35b332d8a513a9a1f4)

```text
docs: remove purpose section
```

<!-- changelog-commit:8e89ee84718f63f530a13687964259fe5f1b9b99 -->
### Commit [`8e89ee8`](https://github.com/superhero/operations.superduper.solutions/commit/8e89ee84718f63f530a13687964259fe5f1b9b99)

```text
refactor: use conventional src and tmp directories
```

<!-- changelog-commit:c5911a58e302b4f5a14195e531233e5863712a7c -->
### Commit [`c5911a5`](https://github.com/superhero/operations.superduper.solutions/commit/c5911a58e302b4f5a14195e531233e5863712a7c)

```text
test: add runtime coverage
```

<!-- changelog-commit:dfa0ab316388df37a681821aa7bc446b4724aa34 -->
### Commit [`dfa0ab3`](https://github.com/superhero/operations.superduper.solutions/commit/dfa0ab316388df37a681821aa7bc446b4724aa34)

```text
ci: validate runtime coverage on dev
```

<!-- changelog-commit:055247d5aa186083dae790903c947b50eed9ac79 -->
### Commit [`055247d`](https://github.com/superhero/operations.superduper.solutions/commit/055247d5aa186083dae790903c947b50eed9ac79)

```text
test: resolve Svelte browser entry in Vitest
```

<!-- changelog-commit:f47284ba4abfe89340e8730d5c83b503fea96c64 -->
### Commit [`f47284b`](https://github.com/superhero/operations.superduper.solutions/commit/f47284ba4abfe89340e8730d5c83b503fea96c64)

```text
ci: remove temporary dev validation workflow
```

<!-- changelog-commit:0e4be1f4441fa22bcb7272f7f42974c6fe1529d3 -->
### Commit [`0e4be1f`](https://github.com/superhero/operations.superduper.solutions/commit/0e4be1f4441fa22bcb7272f7f42974c6fe1529d3)

```text
docs: link project title
```

<!-- changelog-commit:86513b8be681a6fa185f5d6a5664cd768290f0bd -->
### Commit [`86513b8`](https://github.com/superhero/operations.superduper.solutions/commit/86513b8be681a6fa185f5d6a5664cd768290f0bd)

```text
ci: publish live coverage badge
```

<!-- changelog-commit:d87ec98436016e3d738fbb4adec420d289c8ef8b -->
### Commit [`d87ec98`](https://github.com/superhero/operations.superduper.solutions/commit/d87ec98436016e3d738fbb4adec420d289c8ef8b)

```text
docs: add CI and coverage badges
```

<!-- changelog-commit:5a95ed8a62784b188e9592e64c86f8fc6f79655f -->
### Commit [`5a95ed8`](https://github.com/superhero/operations.superduper.solutions/commit/5a95ed8a62784b188e9592e64c86f8fc6f79655f)

```text
test: disable Vitest job summary
```

<!-- changelog-commit:f3a88c0aa61169e8163361ac44c7025dcb6598c4 -->
### Commit [`f3a88c0`](https://github.com/superhero/operations.superduper.solutions/commit/f3a88c0aa61169e8163361ac44c7025dcb6598c4)

```text
test: use Cucumber for source and acceptance tests
```

<!-- changelog-commit:660f74d0dbc782a43289c6719cdd336260241bdd -->
### Commit [`660f74d`](https://github.com/superhero/operations.superduper.solutions/commit/660f74d0dbc782a43289c6719cdd336260241bdd)

```text
ci: validate Cucumber-only test pipeline
```

<!-- changelog-commit:437490ced0098f7036affdc31b20a8954a44fee7 -->
### Commit [`437490c`](https://github.com/superhero/operations.superduper.solutions/commit/437490ced0098f7036affdc31b20a8954a44fee7)

```text
ci: expand squashed commits in deployment summary
```

<!-- changelog-commit:abb797d0aa29c94deffadb44acd5c3242d454118 -->
### Commit [`abb797d`](https://github.com/superhero/operations.superduper.solutions/commit/abb797d0aa29c94deffadb44acd5c3242d454118)

```text
ci: show squash commit after expanded commits
```

<!-- changelog-commit:b94178c1ad680fe2dbfa068aa8e3aa4f00f440b6 -->
### Commit [`b94178c`](https://github.com/superhero/operations.superduper.solutions/commit/b94178c1ad680fe2dbfa068aa8e3aa4f00f440b6)

```text
test: type application bootstrap helper
```

<!-- changelog-commit:c211d6641852452c8abe4aa448a41ca9edef7fe1 -->
### Commit [`c211d66`](https://github.com/superhero/operations.superduper.solutions/commit/c211d6641852452c8abe4aa448a41ca9edef7fe1)

```text
docs: point coverage badge to dev
```

<!-- changelog-commit:2194f8f7fbe97b198bab5683b64292624a28000d -->
### Commit [`2194f8f`](https://github.com/superhero/operations.superduper.solutions/commit/2194f8f7fbe97b198bab5683b64292624a28000d)

```text
ci: update coverage badge on dev
```

<!-- changelog-commit:2afa392e9def14e7bf237e1f95e1e0a7293a222a -->
### Commit [`2afa392`](https://github.com/superhero/operations.superduper.solutions/commit/2afa392e9def14e7bf237e1f95e1e0a7293a222a)

```text
ci: store coverage badge data on dev
```

<!-- changelog-commit:986ef373ace5a54bf9ee59a9f72a3f7318e7c66a -->
### Commit [`986ef37`](https://github.com/superhero/operations.superduper.solutions/commit/986ef373ace5a54bf9ee59a9f72a3f7318e7c66a)

```text
ci: publish coverage to GitHub Code Quality
```

<!-- changelog-commit:f9e8d4dac0a7c38bd7485a9c7b6194044b9ce1cc -->
### Commit [`f9e8d4d`](https://github.com/superhero/operations.superduper.solutions/commit/f9e8d4dac0a7c38bd7485a9c7b6194044b9ce1cc)

```text
ci: test pull request head commits
```

<!-- changelog-commit:c725c8badcd59859947f28c7362fa660b3874d7d -->
### Commit [`c725c8b`](https://github.com/superhero/operations.superduper.solutions/commit/c725c8badcd59859947f28c7362fa660b3874d7d)

```text
test: load Cucumber profiles explicitly
```

<!-- changelog-commit:7dcefcb3bb5944118147b2a9e74c3c147f207031 -->
### Commit [`7dcefcb`](https://github.com/superhero/operations.superduper.solutions/commit/7dcefcb3bb5944118147b2a9e74c3c147f207031)

```text
ci: separate source tests from coverage reporting
```

<!-- changelog-commit:3b1004225e50bd4af51c77f80e91b13a86a4e3ad -->
### Commit [`3b10042`](https://github.com/superhero/operations.superduper.solutions/commit/3b1004225e50bd4af51c77f80e91b13a86a4e3ad)

```text
ci: remove temporary dev validation workflow
```

<!-- changelog-commit:7781963c301bbc0b34bf5af4bfcd9d811070877f -->
### Commit [`7781963`](https://github.com/superhero/operations.superduper.solutions/commit/7781963c301bbc0b34bf5af4bfcd9d811070877f)

```text
test: export Cucumber profiles correctly
```

<!-- changelog-commit:5acc99e55d01a74e3ae33d844011a186391462bf -->
### Commit [`5acc99e`](https://github.com/superhero/operations.superduper.solutions/commit/5acc99e55d01a74e3ae33d844011a186391462bf)

```text
ci: gate GitHub coverage upload until enabled
```

<!-- changelog-commit:0cb1e6acd6d279bbd16211b6c0defecb01618a92 -->
### Commit [`0cb1e6a`](https://github.com/superhero/operations.superduper.solutions/commit/0cb1e6acd6d279bbd16211b6c0defecb01618a92)

```text
ci: enforce c8 coverage without Code Quality
```

<!-- changelog-commit:3e8a5dbe47b106a5e7644c6208b38aa7ad067739 -->
### Commit [`3e8a5db`](https://github.com/superhero/operations.superduper.solutions/commit/3e8a5dbe47b106a5e7644c6208b38aa7ad067739)

```text
ci: pass coverage directly to badge job
```

<!-- changelog-commit:677b962c1d291eed702398d3afb08923d0841efa -->
### Commit [`677b962`](https://github.com/superhero/operations.superduper.solutions/commit/677b962c1d291eed702398d3afb08923d0841efa)

```text
chore: update coverage badge
```

<!-- changelog-commit:d24e8a7dc008e76c5466ddc0f3dfc82da0e406b4 -->
### Commit [`d24e8a7`](https://github.com/superhero/operations.superduper.solutions/commit/d24e8a7dc008e76c5466ddc0f3dfc82da0e406b4)

```text
ci: keep dev checks fast
```

<!-- changelog-commit:2dfe7f8ecedb1a0d388ccb099ee7c7cb230acf7e -->
### Commit [`2dfe7f8`](https://github.com/superhero/operations.superduper.solutions/commit/2dfe7f8ecedb1a0d388ccb099ee7c7cb230acf7e)

```text
feat: add basic OpenAPI operation flow
```

<!-- changelog-commit:3674706adfc9cd9f4dafd08eb47e94101a2f4692 -->
### Commit [`3674706`](https://github.com/superhero/operations.superduper.solutions/commit/3674706adfc9cd9f4dafd08eb47e94101a2f4692)

```text
test: describe basic workflow in production build
```

<!-- changelog-commit:bcd040831fed551cbfb127c92ed448763cd3e6b4 -->
### Commit [`bcd0408`](https://github.com/superhero/operations.superduper.solutions/commit/bcd040831fed551cbfb127c92ed448763cd3e6b4)

```text
test: assert basic OpenAPI workflow stages
```

<!-- changelog-commit:431d628baf9e038b2a04cabaefd54b4462e106bd -->
### Commit [`431d628`](https://github.com/superhero/operations.superduper.solutions/commit/431d628baf9e038b2a04cabaefd54b4462e106bd)

```text
style: apply semantic five-color theme
```

<!-- changelog-commit:c7a5ef882a78323a79ca0fab4c1c557e8856318c -->
### Commit [`c7a5ef8`](https://github.com/superhero/operations.superduper.solutions/commit/c7a5ef882a78323a79ca0fab4c1c557e8856318c)

```text
docs: define semantic theme color contract
```

<!-- changelog-commit:020a1d9b0c33792025b7fc773cc8d31fad2cfd51 -->
### Commit [`020a1d9`](https://github.com/superhero/operations.superduper.solutions/commit/020a1d9b0c33792025b7fc773cc8d31fad2cfd51)

```text
ci: preserve full main release pipeline
```

<!-- changelog-commit:7b09eaef5ee7467fbedce9a27a9fb97422afbf86 -->
### Commit [`7b09eae`](https://github.com/superhero/operations.superduper.solutions/commit/7b09eaef5ee7467fbedce9a27a9fb97422afbf86)

```text
ci: add lean development workflow
```

<!-- changelog-commit:fa02e9044c96b83f05f4c12261e8b2869f7832c0 -->
### Commit [`fa02e90`](https://github.com/superhero/operations.superduper.solutions/commit/fa02e9044c96b83f05f4c12261e8b2869f7832c0)

```text
chore: update coverage badge
```

<!-- changelog-commit:018a3cff971c6352c6e5754f32491c1eb210cc04 -->
### Commit [`018a3cf`](https://github.com/superhero/operations.superduper.solutions/commit/018a3cff971c6352c6e5754f32491c1eb210cc04)

```text
feat: add Svelte Flow
```

<!-- changelog-commit:a97d2429a564179677b8c33243e65417aad32094 -->
### Commit [`a97d242`](https://github.com/superhero/operations.superduper.solutions/commit/a97d2429a564179677b8c33243e65417aad32094)

```text
feat: add editable flow node
```

<!-- changelog-commit:241e5b0d09c5b4b84ab6fa722e0d816afaccd71f -->
### Commit [`241e5b0`](https://github.com/superhero/operations.superduper.solutions/commit/241e5b0d09c5b4b84ab6fa722e0d816afaccd71f)

```text
feat: replace OpenAPI runner with flow canvas
```

<!-- changelog-commit:5d6e4ad8ac939e208d0b8b0fd3c4daaef3438ed0 -->
### Commit [`5d6e4ad`](https://github.com/superhero/operations.superduper.solutions/commit/5d6e4ad8ac939e208d0b8b0fd3c4daaef3438ed0)

```text
test: describe workflow canvas build
```

<!-- changelog-commit:33427b438c4be18334021434040355250fd11e3e -->
### Commit [`33427b4`](https://github.com/superhero/operations.superduper.solutions/commit/33427b438c4be18334021434040355250fd11e3e)

```text
test: assert workflow canvas in bundle
```

<!-- changelog-commit:38c3f14c18366644b5e96427e84665f71eac2e49 -->
### Commit [`38c3f14`](https://github.com/superhero/operations.superduper.solutions/commit/38c3f14c18366644b5e96427e84665f71eac2e49)

```text
docs: clarify current flow-editor milestone
```

<!-- changelog-commit:6c4efdf1f088247509d427638fc69e8ee24fb413 -->
### Commit [`6c4efdf`](https://github.com/superhero/operations.superduper.solutions/commit/6c4efdf1f088247509d427638fc69e8ee24fb413)

```text
chore: update coverage badge
```

<!-- changelog-commit:35631e029f8c33980a6268b3fc6ff1af9c122433 -->
### Commit [`35631e0`](https://github.com/superhero/operations.superduper.solutions/commit/35631e029f8c33980a6268b3fc6ff1af9c122433)

```text
docs: add simplify ADR
```

<!-- changelog-commit:67afa316956a29338f7ccb6c8d2d35ea7b815580 -->
### Commit [`67afa31`](https://github.com/superhero/operations.superduper.solutions/commit/67afa316956a29338f7ccb6c8d2d35ea7b815580)

```text
docs: link ADRs from contributing guide
```

<!-- changelog-commit:e41db7f6ef51e8cf4bc768e3279694df50adfd08 -->
### Commit [`e41db7f`](https://github.com/superhero/operations.superduper.solutions/commit/e41db7f6ef51e8cf4bc768e3279694df50adfd08)

```text
docs: add colors ADR
```

<!-- changelog-commit:e0f171da265f75895f5523176e56eb2d9c52c895 -->
### Commit [`e0f171d`](https://github.com/superhero/operations.superduper.solutions/commit/e0f171da265f75895f5523176e56eb2d9c52c895)

```text
docs: move theme colors to ADR
```

<!-- changelog-commit:f0ae7922c3d7e432042aef280109bd1ac2450d89 -->
### Commit [`f0ae792`](https://github.com/superhero/operations.superduper.solutions/commit/f0ae7922c3d7e432042aef280109bd1ac2450d89)

```text
docs: add security ADR
```

<!-- changelog-commit:7f865607f75122247200c2037cb5339959ec93a0 -->
### Commit [`7f86560`](https://github.com/superhero/operations.superduper.solutions/commit/7f865607f75122247200c2037cb5339959ec93a0)

```text
docs: move security guidance to ADR
```

<!-- changelog-commit:c6bebf87ee74a273fc98d75aa9f07af03d865610 -->
### Commit [`c6bebf8`](https://github.com/superhero/operations.superduper.solutions/commit/c6bebf87ee74a273fc98d75aa9f07af03d865610)

```text
docs: expand simplify ADR with less-is-more principle
```

<!-- changelog-commit:2061272af68d2b925b250cc033d2f77618ce8910 -->
### Commit [`2061272`](https://github.com/superhero/operations.superduper.solutions/commit/2061272af68d2b925b250cc033d2f77618ce8910)

```text
feat: add reusable menu button
```

<!-- changelog-commit:fa27b8efc971848b1ee835046d2063803b3904c6 -->
### Commit [`fa27b8e`](https://github.com/superhero/operations.superduper.solutions/commit/fa27b8efc971848b1ee835046d2063803b3904c6)

```text
feat: add fixed application header
```

<!-- changelog-commit:6f3851a89a4341eb921bc68a9a183fbc0dc0a0fd -->
### Commit [`6f3851a`](https://github.com/superhero/operations.superduper.solutions/commit/6f3851a89a4341eb921bc68a9a183fbc0dc0a0fd)

```text
feat: add slide-in side navigation
```

<!-- changelog-commit:0905ee64d761e74a5959ac89908f5b130ea4e284 -->
### Commit [`0905ee6`](https://github.com/superhero/operations.superduper.solutions/commit/0905ee64d761e74a5959ac89908f5b130ea4e284)

```text
feat: add application shell navigation
```

<!-- changelog-commit:16fb5e9ee86b89ad69e81ce6c7e7ea369c48a1f4 -->
### Commit [`16fb5e9`](https://github.com/superhero/operations.superduper.solutions/commit/16fb5e9ee86b89ad69e81ce6c7e7ea369c48a1f4)

```text
chore: update coverage badge
```

<!-- changelog-commit:5f26249e4a397404e6e863d76dfe4d38a1996915 -->
### Commit [`5f26249`](https://github.com/superhero/operations.superduper.solutions/commit/5f26249e4a397404e6e863d76dfe4d38a1996915)

```text
chore: rename dev references to develop
```

<!-- changelog-commit:cc250f085b7034a37f66fa0cc79f2f73023b5143 -->
### Commit [`cc250f0`](https://github.com/superhero/operations.superduper.solutions/commit/cc250f085b7034a37f66fa0cc79f2f73023b5143)

```text
ci: add Gitflow policy workflow
```

<!-- changelog-commit:1a5e4adcb69556e6b6971f8830ad39bbe774659d -->
### Commit [`1a5e4ad`](https://github.com/superhero/operations.superduper.solutions/commit/1a5e4adcb69556e6b6971f8830ad39bbe774659d)

```text
ci: add automatic release tagging
```

<!-- changelog-commit:c953115c4cf1b43b12ca32bb05d27142b9899cfe -->
### Commit [`c953115`](https://github.com/superhero/operations.superduper.solutions/commit/c953115c4cf1b43b12ca32bb05d27142b9899cfe)

```text
ci: add automatic Gitflow back-merge PR
```
