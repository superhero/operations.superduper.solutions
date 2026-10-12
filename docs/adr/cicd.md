# Continuous integration and deployment follow Gitflow, with a fully passing test suite required for release

Development and releases follow the
[AVH git-flow model](https://github.com/petervanderdoes/gitflow-avh) with
[Semantic Versioning](https://semver.org/). `develop` integrates ongoing work;
`main` contains releases. This separation lets development continue while a
release is stabilized.

Releases require a fully passing test suite and all required validation.
Publication uses the verified release revision and build artifacts from that
validation run, preserving the connection between what was tested and what
users receive.

CI automates validation, merging, tagging, deployment and branch synchronization.
Protected branches and checks tied to the tested revision guard against
publishing unvalidated changes.

Markdown-only changes have a separate, strictly checked documentation path.
They skip application tests, builds and publication because they cannot change
the application.

## Branches and merge paths

| Branch | Role and starting point |
|---|---|
| `main` | Released code. |
| `develop` | Integration of ongoing work. |
| `feature/*` | New work, starting from `develop`. |
| `bugfix/*` | Fixes starting from `develop` or the active release, returning to that same branch. |
| `release/<version>` | Release preparation from `develop`, incorporating current `main`. |
| `hotfix/<version>` | Patch fixes starting from released `main`. |
| `docs/*` | Markdown-only updates with explicitly selected targets; see [documentation paths](#updating-documentation). |

Read each graph **from bottom to top**. Each example shows one part of the
branching model. Branch labels omit topic and version suffixes; commit labels
explain the work and where it is integrated.

### Development to release

Features and integration fixes return to `develop`. A release branches from
`develop` after feature integration and incorporates later fixes before
publication to `main`. After publication, `main` is merged back into `develop`.

The illustrated `develop` → `release` update is not yet supported by
[CI branch validation](../../.github/scripts/validate-pr.sh).

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

### Fixing production during a release

A hotfix starts from released `main` and also carries the fix into the active
release. Once published and tagged, `main` is synchronized into `develop`.

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
    checkout main
    merge "hotfix" id: "Publish patch" tag: "1.0.1"
    checkout "release"
    merge "hotfix" id: "Apply patch"
    checkout develop
    merge main id: "Sync patch"
```

### Updating documentation

One `docs/<topic>` branch carries two successive documentation edits, merged
into `develop` and `main` through explicitly selected PRs. The release branches
from `develop` after the first documentation merge, is validated and merged into
`main`, then `main` is merged back into `develop`. The second docs edit goes to
`main` afterward.

The shared docs branch starts from `main` and accumulates only documentation
changes; each later edit includes the earlier ones. Every target must pass the
full Markdown-only check. Reliable branch reuse across targets remains planned
automation work. The documentation workflow itself does not publish releases or
synchronize target branches.

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

### Merge methods

- Feature, integration bugfix, production hotfix and documentation PRs
  fast-forward when they contain one commit and the target is its ancestor;
  otherwise they squash.
- Release stabilization, publication and synchronization fast-forward where
  possible; otherwise they use a merge commit to preserve history.

Mermaid draws each [integration as a merge commit](https://mermaid.js.org/syntax/gitgraph.html#merging-two-branches);
the policies above determine the actual Git history. Each documentation PR
targets one branch explicitly, without automatic synchronization.

See [Repository automation](../../.github/workflows/README.md) for branch rules,
merge methods, contributor procedures and publication details.
