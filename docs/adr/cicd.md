# CICD

> [!IMPORTANT]
> Continuous integration and deployment follow a Gitflow branch strategy, with automated tests that help assure quality between development cycles and deployments.

## Development to release

The [AVH git-flow model](https://github.com/petervanderdoes/gitflow-avh) separates
ongoing work in `develop` from releases in `main`. Versions follow
[Semantic Versioning](https://semver.org/).

Read the diagrams **from bottom to top**. Branch labels omit topic and version
suffixes.

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

### Branching

`feature/*` and integration `bugfix/*` branches start from and return to `develop`
through PRs. A `release/<version>` branches from `develop` after feature
integration and incorporates current `main`.

The overview's `develop` → `release` update is not yet supported by CI branch
validation.

Stabilization fixes use `bugfix/*` branches from the active release and return
to that release through a PR.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:nth-last-of-type(-n+2) { visibility: hidden; } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; } .commit.branch { stroke: #B1CD5E; stroke-dasharray: none; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#B1CD5E", "gitBranchLabel1": "#0D1117",
    "git2": "#EB8D5B", "gitBranchLabel2": "#0D1117",
    "git3": "#57C3BC", "gitBranchLabel3": "#0D1117"
}}}%%
gitGraph BT:
    %% Hide the two initial notes while retaining their branch connections.
    commit id: "Released" tag: "1.0.0"
    branch develop order: 3
    commit id: "Start"
    branch release order: 1
    commit id: "Create release branch"
    branch bugfix order: 2
    commit id: "Fix"
    checkout release
    merge bugfix id: "Integrate fix"
    checkout main
    merge release id: "Deployed" tag: "1.1.0"
    checkout develop
    merge main id: "Sync release"
```

The fix is validated before merging into the release. After release validation,
`release` merges into `main`; a synchronization PR then carries `main` back into
`develop`.

### Validation and publication

Releases, including hotfixes, require a fully passing test suite and all required
checks. Protected branches enforce checks tied to the tested revision. CI merges
and tags the verified revision, deploys its tested artifacts, and opens a
`main` → `develop` synchronization PR.

### Merge policy

Feature and integration bugfix PRs, hotfix PRs into `main`, and documentation PRs
fast-forward when they contain one commit and the target is its ancestor;
otherwise they squash. Release stabilization, publication and synchronization
fast-forward where possible; otherwise they use merge commits.

## Hotfixes

A `hotfix/<version>` branches from released `main` using the next patch version,
allowing a production fix without waiting for the next release.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg, .commit-label-bkg { opacity: 0.9; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { opacity: 1; clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:nth-last-of-type(-n+2), .commit.develop-origin { visibility: hidden; } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#EB7D61", "gitBranchLabel1": "#0D1117",
    "git2": "#57C3BC", "gitBranchLabel2": "#0D1117"
}}}%%
gitGraph BT:
    %% In BT order, the initial commit note is the last label group; its tag stays visible.
    commit id: "Released" tag: "1.0.0"
    branch develop order: 2
    %% Invisible anchor: Mermaid requires a develop commit before merging main back.
    commit id: "develop-origin"
    checkout main
    branch "hotfix" order: 1
    commit id: "Repair"
    checkout main
    merge "hotfix" id: "Publish patch" tag: "1.0.1"
    checkout develop
    merge main id: "Sync patch"
```

After validation, the hotfix merges into `main` and receives its patch version
tag. A synchronization PR then carries `main` into `develop`.

### Including a hotfix in the next release

A hotfix can instead be included in an active release.

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

The hotfix merges into `release` without creating a separate tag. The validated
release then merges into `main` and receives its release version tag. A
`main` → `develop` synchronization PR follows.

## Updating documentation

`docs/<topic>` PRs update Markdown on explicitly selected `develop` or `main`
targets.

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

### Branch reuse

Here, a docs branch from `main` targets `develop` first, then `main` after a
release. Later edits retain earlier documentation changes; reliable branch reuse
across targets remains planned automation work.

### Validation and automation

Each target validates the full Markdown-only change set. Docs PRs skip
application tests and builds. They do not create release versions or tags,
publish releases, deploy, or open synchronization PRs—including `main` → `develop`.
Each target needs its own explicitly requested PR.
