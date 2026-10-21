# Continuous integration

> [!IMPORTANT]
> Continuous integration follows a Gitflow branch strategy, with GitHub Actions automating tests that help assure quality between development cycles.

## Development to release

The [AVH git-flow model](https://github.com/petervanderdoes/gitflow-avh) separates
ongoing work in `develop` from releases in `main`. Versions follow
[Semantic Versioning](https://semver.org/).

Read the diagrams **from bottom to top**. Branch labels omit topic and version
suffixes. Plain branch ends indicate earlier or later history omitted from the
diagram.

The overview's `develop` → `release` update is performed by repeating the
`develop` → `main` release trigger. It updates the active release; a direct
`develop` → `release` PR is not a supported branch route.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:nth-last-of-type(-n+2), .commit.main-origin { visibility: hidden; } path.arrow2:not(.arrow2 ~ .arrow2) { filter: drop-shadow(0 50px 0 #57C3BC); } .commit-labels g:first-of-type, .commit.main-end { visibility: hidden; } .commit-arrows path.arrow2:nth-last-child(3) { filter: drop-shadow(0 -50px 0 #57C3BC); } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; } .commit.branch { stroke: #B1CD5E; stroke-dasharray: none; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#B1CD5E", "gitBranchLabel1": "#0D1117",
    "git2": "#57C3BC", "gitBranchLabel2": "#0D1117",
    "git3": "#E7BE5E", "gitBranchLabel3": "#0D1117",
    "git4": "#EB8D5B", "gitBranchLabel4": "#0D1117"
}}}%%
gitGraph BT:
    %% Show existing main and develop lanes with earlier ancestry and initial notes omitted.
    branch develop order: 2
    checkout main
    %% Hide the main marker; extend develop by 50px below its visible feature fork to align the starts.
    commit id: "main-origin"
    checkout develop
    commit id: "Start"
    branch "feature" order: 3
    commit id: "Feature"
    checkout develop
    merge "feature" id: "Integrate feature"
    branch "release" order: 1
    commit id: "Create release branch"
    checkout develop
    branch "bugfix" order: 4
    commit id: "Fix"
    checkout develop
    merge "bugfix" id: "Integrate fix"
    checkout "release"
    merge develop id: "Include fix"
    checkout main
    merge "release" id: "Integrate release" tag: "1.1.0"
    checkout develop
    merge main id: "Sync release"
    %% A hidden main endpoint and a 50px develop extension align the continuing tips.
    checkout main
    commit id: "main-end"
```

### Branching

`feature/*` and integration `bugfix/*` branches start from and return to `develop`
through PRs. A `release/<version>` branches from `develop` after feature
integration and incorporates current `main`. When `main` is already an ancestor,
release creation preserves the exact source snapshot.

Stabilization fixes use `bugfix/*` branches from the active release and return
to that release through a PR.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:nth-last-of-type(-n+2), .commit.main-origin { visibility: hidden; } path.arrow3:not(.arrow3 ~ .arrow3) { filter: drop-shadow(0 50px 0 #57C3BC); } .commit-labels g:first-of-type, .commit.main-end { visibility: hidden; } .commit-arrows path.arrow3:nth-last-child(3) { filter: drop-shadow(0 50px 0 #57C3BC) drop-shadow(0 -50px 0 #57C3BC); } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; } .commit.branch { stroke: #B1CD5E; stroke-dasharray: none; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#B1CD5E", "gitBranchLabel1": "#0D1117",
    "git2": "#EB8D5B", "gitBranchLabel2": "#0D1117",
    "git3": "#57C3BC", "gitBranchLabel3": "#0D1117"
}}}%%
gitGraph BT:
    %% Show existing main and develop lanes with earlier ancestry and initial notes omitted.
    branch develop order: 3
    checkout main
    %% Hide the main marker; extend develop by 50px below its visible release fork to align the starts.
    commit id: "main-origin"
    checkout develop
    commit id: "Start"
    branch release order: 1
    commit id: "Create release branch"
    branch bugfix order: 2
    commit id: "Fix"
    checkout release
    merge bugfix id: "Integrate fix"
    checkout main
    merge release id: "Integrate release" tag: "1.1.0"
    checkout develop
    merge main id: "Sync release"
    %% A hidden main endpoint and a 50px develop extension align the continuing tips.
    checkout main
    commit id: "main-end"
```

The fix is validated before merging into the release. After release validation,
`release` merges into `main`; a synchronization PR then carries `main` back into
`develop`.

A version tag reserves that version for publication. A tagged working release
may still receive stabilization fixes and documentation while its tag belongs
to that release branch, is absent from `main`, has no published GitHub Release,
and has no merged release or hotfix PR into `main`. Failed or incomplete API
verification blocks the update. Stabilization leaves the existing tag unchanged;
published versions remain closed to changes, and the tag continues to prevent
republishing that version through a new release PR.

### Validation and release

Integration workflows share one queue across development, release, main and
documentation changes. A run resolves current branch revisions when its turn
starts. Feature and bugfix candidates incorporate their latest target before
validation; source updates receive a fresh CI run. Synchronization preserves
the source branch and validates the current proposed merge.

Releases, including hotfixes, require a fully passing test suite and all required
checks. Protected branches enforce checks tied to the tested revision. GitHub
Actions merges and tags the verified revision, then opens a `main` → `develop`
synchronization PR.

Develop integration performs static checks and builds previews. Its test
suites run only through an explicit manual workflow on `develop`; preview builds
do not certify release validation.

Release candidates automatically complete scoped coverage, build and all
test suites. Later release/main workflows may reuse complete successful release
validation when every tracked input matches except the managed root
`CHANGELOG.md`. Reuse verifies the original run, tested revision,
complete reports and bundle hashes, preserving their provenance. Missing,
expired or unverifiable evidence requires fresh validation; current branch and
merge checks still apply.

### Merge policy

Feature and integration bugfix PRs, hotfix PRs into `main`, and documentation PRs
fast-forward when they contain one commit and the target branch tip is an
ancestor of that commit; otherwise they squash. Release stabilization PRs,
release PRs into `main` and synchronization PRs fast-forward where possible;
otherwise they use merge commits.

Commit messages are preserved in the root changelog before work is squashed
into `develop`. Unreleased entries accumulate under **Latest**. Release creation
preserves that changelog and automatically opens a separate
`docs/release-changelog-<version>` PR into the release branch to move those
entries into the selected version. That docs PR must merge before the release
can merge into `main`, so the version tag contains the correct changelog.

Further development preserves earlier released entries and adds new work to
Latest. Another changelog review extends the same release version without
duplicating entries. Its canonical metadata change resumes release processing
and may reuse complete validation when the remaining inputs match.

## Hotfixes

A `hotfix/<version>` branches from released `main` using the next patch version,
allowing a production fix without waiting for the next release.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:nth-last-of-type(-n+2), .commit.develop-origin { visibility: hidden; } path.arrow0:not(.arrow0 ~ .arrow0) { filter: drop-shadow(0 50px 0 #4CB269); } .commit-labels g:first-of-type, .commit.main-end { visibility: hidden; } .commit-arrows path.arrow2:nth-last-child(3) { filter: drop-shadow(0 -50px 0 #57C3BC); } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#EB7D61", "gitBranchLabel1": "#0D1117",
    "git2": "#57C3BC", "gitBranchLabel2": "#0D1117"
}}}%%
gitGraph BT:
    %% Show existing main and develop lanes with earlier ancestry and initial notes omitted.
    branch develop order: 2
    %% Hide the develop anchor before visible history; extend main downward by 50px to align the starts.
    commit id: "develop-origin"
    checkout main
    commit id: "Released" tag: "1.0.0"
    branch "hotfix" order: 1
    commit id: "Repair"
    checkout main
    merge "hotfix" id: "Integrate patch" tag: "1.0.1"
    checkout develop
    merge main id: "Sync patch"
    %% A hidden main endpoint and a 50px develop extension align the continuing tips.
    checkout main
    commit id: "main-end"
```

After validation, the hotfix merges into `main` and receives its patch version
tag. A synchronization PR then carries `main` into `develop`.

### Including a hotfix in the next release

A hotfix can instead be included in an active release.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:nth-last-of-type(-n+2), .commit.main-origin { visibility: hidden; } path.arrow3:not(.arrow3 ~ .arrow3) { filter: drop-shadow(0 100px 0 #57C3BC); } .commit-labels g:first-of-type, .commit.main-end { visibility: hidden; } .commit-arrows path.arrow3:nth-last-child(3) { filter: drop-shadow(0 100px 0 #57C3BC) drop-shadow(0 -50px 0 #57C3BC); } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; } .commit.branch { stroke: #B1CD5E; stroke-dasharray: none; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#EB7D61", "gitBranchLabel1": "#0D1117",
    "git2": "#B1CD5E", "gitBranchLabel2": "#0D1117",
    "git3": "#57C3BC", "gitBranchLabel3": "#0D1117"
}}}%%
gitGraph BT:
    %% Show existing main and develop lanes with earlier ancestry omitted.
    branch develop order: 3
    checkout main
    %% A hidden anchor continues main below the released version.
    commit id: "main-origin"
    commit id: "Released" tag: "1.0.0"
    checkout develop
    %% Extend develop by 100px before this fork to show prior history without a starting node.
    commit id: "Next release"
    branch "release" order: 2
    commit id: "Create release branch"
    checkout main
    branch "hotfix" order: 1
    commit id: "Repair"
    checkout "release"
    merge "hotfix" id: "Apply fix"
    checkout main
    merge "release" id: "Integrate release" tag: "1.1.0"
    checkout develop
    merge main id: "Sync release"
    %% A hidden main endpoint and a 50px develop extension align the continuing tips.
    checkout main
    commit id: "main-end"
```

The hotfix merges into `release` without creating a separate tag. The validated
release then merges into `main` and receives its release version tag. A
`main` → `develop` synchronization PR follows.

## Updating documentation

`docs/<topic>` branches start from their intended target and return through a
Markdown-only PR. Each diagram shows a separate target.

### Development

Documentation for ongoing development merges into `develop` before the next
release is prepared.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:nth-last-of-type(-n+2), .commit.main-origin { visibility: hidden; } path.arrow2:not(.arrow2 ~ .arrow2) { filter: drop-shadow(0 50px 0 #57C3BC); } .commit-labels g:first-of-type, .commit.main-end { visibility: hidden; } .commit-arrows path.arrow2:nth-last-child(3) { filter: drop-shadow(0 -50px 0 #57C3BC); } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; } .commit.branch { stroke: #B1CD5E; stroke-dasharray: none; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#B1CD5E", "gitBranchLabel1": "#0D1117",
    "git2": "#57C3BC", "gitBranchLabel2": "#0D1117",
    "git3": "#71B3FF", "gitBranchLabel3": "#0D1117"
}}}%%
gitGraph BT:
    %% Show existing main and develop lanes with earlier ancestry and initial notes omitted.
    branch develop order: 2
    checkout main
    %% Hide the main marker; extend develop by 50px below its visible docs fork to align the starts.
    commit id: "main-origin"
    checkout develop
    commit id: "Start"
    branch docs order: 3
    commit id: "Document development"
    checkout develop
    merge docs id: "Update develop"
    branch release order: 1
    commit id: "Create release branch"
    checkout main
    merge release id: "Integrate release" tag: "1.1.0"
    checkout develop
    merge main id: "Sync main"
    %% A hidden main endpoint and a 50px develop extension align the continuing tips.
    checkout main
    commit id: "main-end"
```

The docs PR updates `develop`. The later release follows the normal validation,
tagging and `main` → `develop` synchronization path.

### Release

Branch from the active `release/<version>` to update its documentation.
Ordinary documentation updates do not resume an open release's publication
pipeline; an explicit release action resumes validation of the updated revision.
The automatically generated changelog versioning PR is the narrow exception:
its canonical change resumes the release after merging, with complete matching
validation reused when available.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:nth-last-of-type(-n+2), .commit.main-origin { visibility: hidden; } path.arrow3:not(.arrow3 ~ .arrow3) { filter: drop-shadow(0 50px 0 #57C3BC); } .commit-labels g:first-of-type, .commit.main-end { visibility: hidden; } .commit-arrows path.arrow3:nth-last-child(3) { filter: drop-shadow(0 50px 0 #57C3BC) drop-shadow(0 -50px 0 #57C3BC); } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; } .commit.branch { stroke: #B1CD5E; stroke-dasharray: none; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#B1CD5E", "gitBranchLabel1": "#0D1117",
    "git2": "#71B3FF", "gitBranchLabel2": "#0D1117",
    "git3": "#57C3BC", "gitBranchLabel3": "#0D1117"
}}}%%
gitGraph BT:
    %% Show existing main and develop lanes with earlier ancestry and initial notes omitted.
    branch develop order: 3
    checkout main
    %% Hide the main marker; extend develop by 50px below its visible release fork to align the starts.
    commit id: "main-origin"
    checkout develop
    commit id: "Start"
    branch release order: 1
    commit id: "Create release branch"
    branch docs order: 2
    commit id: "Document release"
    checkout release
    merge docs id: "Update release"
    checkout main
    merge release id: "Integrate release" tag: "1.1.0"
    checkout develop
    merge main id: "Sync main"
    %% A hidden main endpoint and a 50px develop extension align the continuing tips.
    checkout main
    commit id: "main-end"
```

The intended docs PR updates `release`. The later release follows the normal
validation, tagging and `main` → `develop` synchronization path.

### Main

Branch from `main` to correct documentation for the released version.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:nth-last-of-type(-n+2), .commit.main-origin { visibility: hidden; } .commit-labels g:first-of-type, .commit.main-end { visibility: hidden; } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; }", "gitGraph": {"mainBranchName": "main", "showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#71B3FF", "gitBranchLabel1": "#0D1117"
}}}%%
gitGraph BT:
    %% A hidden anchor continues main below the visible documentation fork.
    commit id: "main-origin"
    %% Hide the existing target commit note while retaining its connection.
    commit id: "Existing"
    branch docs order: 1
    commit id: "Document main"
    checkout main
    merge docs id: "Update main"
    %% A hidden endpoint shows main continuing after the documentation merge.
    commit id: "main-end"
```

These changes reach `main` directly, without going through a release branch.

### Validation and automation

Each target validates the full Markdown-only change set. Docs PRs skip
application tests and builds. They do not allocate release numbers, create tags,
publish releases, or open synchronization PRs. Authored documentation needs an
explicit PR for each target; release changelog versioning has its own automatic
PR into the active release.

One source branch may serve several targets when its complete diff is
Markdown-only against each. Branch recovery preserves the original source
revision, including after a squash; it never propagates changes automatically.
