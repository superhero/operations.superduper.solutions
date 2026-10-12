# CICD

> [!IMPORTANT]
> Continuous integration and deployment follow a Gitflow branch strategy, with automated tests that help assure quality between development cycles and deployments.

## Development to release

Development and releases follow the
[AVH git-flow model](https://github.com/petervanderdoes/gitflow-avh) with
[Semantic Versioning](https://semver.org/). `develop` integrates ongoing work;
`main` contains releases. This separation lets development continue while a
release is prepared.

Read all four diagrams **from bottom to top**. Branch labels omit topic and
version suffixes; commit labels explain the work and its integration.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:nth-last-of-type(-n+2) { visibility: hidden; } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; } .commit.branch { stroke: #B1CD5E; stroke-dasharray: none; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#B1CD5E", "gitBranchLabel1": "#0D1117",
    "git2": "#57C3BC", "gitBranchLabel2": "#0D1117",
    "git3": "#E7BE5E", "gitBranchLabel3": "#0D1117",
    "git4": "#EB8D5B", "gitBranchLabel4": "#0D1117"
}}}%%
gitGraph BT:
    %% In BT order, the last two label groups are the initial notes; the version tag stays visible.
    commit id: "Released" tag: "1.0.0"
    branch develop order: 2
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
    merge "release" id: "Deployed" tag: "1.1.0"
    checkout develop
    merge main id: "Sync release"
```

New work starts on `feature/*` branches from `develop`. Integration fixes use
`bugfix/*` branches from `develop`; both return through PRs. A `release/<version>`
branch starts from `develop` after feature integration, incorporates current
`main`, and collects later fixes before publication. Stabilization fixes use
`bugfix/*` branches from the active release and return to that release.

Every release, including a hotfix, requires a fully passing test suite and all
required validation. CI automates validation, merging, tagging, deployment and
synchronization. Protected branches and checks tied to the tested revision guard
publication. The verified revision and its tested artifacts are published
together. After publication to `main`, a synchronization PR carries `main` back
into `develop`.

Feature and integration bugfix PRs fast-forward when they contain one commit and
the target is its ancestor; otherwise they squash. Release stabilization,
publication and synchronization fast-forward where possible; otherwise they use
a merge commit to preserve history. Mermaid draws every
[integration as a merge commit](https://mermaid.js.org/syntax/gitgraph.html#merging-two-branches);
the merge policies described here determine the actual Git history.

The illustrated `develop` → `release` update is not yet supported by
[CI branch validation](../../.github/scripts/validate-pr.sh). See
[Repository automation](../../.github/workflows/README.md) for the operational
branch rules, contributor procedures and publication details.

## Hotfixes

A production fix starts on `hotfix/<version>` from released `main`, using the
next patch version. It can be published without waiting for the next release.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:last-of-type { visibility: hidden; } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#EB7D61", "gitBranchLabel1": "#0D1117",
    "git2": "#57C3BC", "gitBranchLabel2": "#0D1117"
}}}%%
gitGraph BT:
    %% In BT order, the initial commit note is the last label group; its tag stays visible.
    commit id: "Released" tag: "1.0.0"
    branch develop order: 2
    commit id: "Next release"
    checkout main
    branch "hotfix" order: 1
    commit id: "Repair"
    checkout main
    merge "hotfix" id: "Publish patch" tag: "1.0.1"
    checkout develop
    merge main id: "Sync patch"
```

After validation, the hotfix merges back into `main` and receives its patch
version tag. A synchronization PR from `main` to `develop` then carries the
published fix into ongoing development.

A hotfix PR into `main` fast-forwards when it contains one commit and the target
is its ancestor; otherwise it squashes. Publication and synchronization follow
the validation and merge policies described above.

---

### Including a hotfix in the next release

A hotfix can also enter an active release. This example shows the fix reaching
production through that release.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:last-of-type { visibility: hidden; } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; } .commit.branch { stroke: #B1CD5E; stroke-dasharray: none; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#EB7D61", "gitBranchLabel1": "#0D1117",
    "git2": "#B1CD5E", "gitBranchLabel2": "#0D1117",
    "git3": "#57C3BC", "gitBranchLabel3": "#0D1117"
}}}%%
gitGraph BT:
    %% In BT order, the initial commit note is the last label group; its tag stays visible.
    commit id: "Released" tag: "1.0.0"
    branch develop order: 3
    commit id: "Next release"
    branch "release" order: 2
    commit id: "Create release branch"
    checkout main
    branch "hotfix" order: 1
    commit id: "Repair"
    checkout "release"
    merge "hotfix" id: "Apply fix"
    checkout main
    merge "release" id: "Deployed" tag: "1.1.0"
    checkout develop
    merge main id: "Sync release"
```

The hotfix merges into `release`, then the validated release merges into `main`
and receives its release version tag. Synchronization from `main` to `develop`
follows publication. The hotfix-to-release merge does not create a separate tag.
These merges fast-forward where possible; otherwise merge commits preserve
the release history.

## Updating documentation

A `docs/<topic>` branch contains Markdown-only updates for explicitly selected
`develop` or `main` PRs. This example reuses one docs branch for two successive
edits.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:nth-last-of-type(-n+2) { visibility: hidden; } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; } .commit.branch { stroke: #B1CD5E; stroke-dasharray: none; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#B1CD5E", "gitBranchLabel1": "#0D1117",
    "git2": "#57C3BC", "gitBranchLabel2": "#0D1117",
    "git3": "#71B3FF", "gitBranchLabel3": "#0D1117"
}}}%%
gitGraph BT:
    %% Hide the two initial notes while retaining their branch connections.
    commit id: "Released" tag: "1.0.0"
    branch develop order: 2
    commit id: "Start"
    checkout main
    branch docs order: 3
    commit id: "Document development"
    checkout develop
    merge docs id: "Update develop"
    branch release order: 1
    commit id: "Create release branch"
    checkout main
    merge release id: "Deployed" tag: "1.1.0"
    checkout develop
    merge main id: "Sync main"
    checkout docs
    commit id: "Document main"
    checkout main
    merge docs id: "Update main"
```

The first docs edit enters `develop` and is included in a normal release. After
that release reaches `main` and is synchronized into `develop`, the second docs
edit goes directly to `main`.

The shared docs branch starts from `main` and retains its earlier documentation
changes. Every target must pass the full Markdown-only check; reliable branch
reuse across targets remains planned automation work. This restricted path skips
application tests and builds because it cannot change the application.
Documentation PRs fast-forward when they contain one commit and the target is
its ancestor; otherwise they squash.

Documentation merges do not create release versions or tags, publish releases,
or trigger deployments. A docs PR merged into `main` does not open a
synchronization PR to `develop`; each target requires its own explicitly
requested PR.
