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
| `docs/*` | Markdown changes starting from the explicitly chosen `develop` or `main` target. |

Read each graph **from bottom to top**. Each example shows one part of the
branching model. Branch labels omit topic and version suffixes; commit labels
explain the work and where it is integrated. The first graph shows where
`develop` and `release` branch from; the hotfix example omits the earlier shared
history of `main` and `develop`.

### Development to release

Features and integration fixes return to `develop`. Documentation returns only
to its chosen target: `develop` in this example, or `main` for released docs.
Here, a release branches from `develop` after feature integration. Later fix and
documentation updates are explicitly incorporated before publication to `main`.
After publication, `main` is merged back into `develop`.

The illustrated `develop` → `release` updates are not yet supported by
[CI branch validation](../../.github/scripts/validate-pr.sh).

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:nth-last-of-type(-n+2) { visibility: hidden; } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { opacity: 1; stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; } .commit.branch { stroke: #B1CD5E; stroke-dasharray: none; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#B1CD5E", "gitBranchLabel1": "#0D1117",
    "git2": "#57C3BC", "gitBranchLabel2": "#0D1117",
    "git3": "#E7BE5E", "gitBranchLabel3": "#0D1117",
    "git4": "#EB8D5B", "gitBranchLabel4": "#0D1117",
    "git5": "#71B3FF", "gitBranchLabel5": "#0D1117"
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
    checkout develop
    branch "docs" order: 5
    commit id: "Documentation"
    checkout develop
    merge "docs" id: "Integrate docs"
    checkout "release"
    merge develop id: "Include docs"
    checkout main
    merge "release" id: "Deployed" tag: "1.1.0"
    checkout develop
    merge main id: "Sync release"
```

### Fixing production during a release

A hotfix starts from released `main`. Once published and tagged, `main` is
synchronized into `develop`. The hotfix branch also receives the tagged revision
before carrying the fix into the active release.

```mermaid
%%{init: {"theme": "base", "themeCSS": "line.branch { stroke: #8B949E; stroke-width: 1px; stroke-dasharray: 1 4; stroke-linecap: round; } .branchLabel, .tag-label { font-weight: 700; } .tag-label-bkg { fill: #B8E6C4; stroke: #8ED3A2; } .branchLabelBkg { clip-path: inset(0 8px 0 0 round 4px) fill-box; } .commit-labels g:last-of-type { visibility: hidden; } .commit-labels g { transform-box: fill-box; transform-origin: calc(100% + 17px) calc(50% + 2px); transform: rotate(-10deg); } .commit-label { font-weight: 700; transform: translateX(-8px); } .commit-label-bkg { opacity: 1; stroke: #17365D; stroke-width: 20px; transform: translateX(-5px); clip-path: polygon(-4px -4px, calc(100% + 4px) -4px, calc(100% + 10px) 50%, calc(100% + 4px) calc(100% + 4px), -4px calc(100% + 4px)) fill-box; } .commit.branch { stroke: #B1CD5E; stroke-dasharray: none; }", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "14px", "commitLabelColor": "#FFFFFF", "commitLabelBackground": "#17365D",
    "git0": "#4CB269", "gitBranchLabel0": "#0D1117",
    "git1": "#B186F8", "gitBranchLabel1": "#0D1117",
    "git2": "#B1CD5E", "gitBranchLabel2": "#0D1117",
    "git3": "#57C3BC", "gitBranchLabel3": "#0D1117"
}}}%%
gitGraph BT:
    %% In BT order, the initial commit note is the last label group; its tag stays visible.
    branch develop order: 3
    checkout main
    commit id: "Released" tag: "1.0.0"
    checkout develop
    commit id: "Next release"
    branch "release" order: 2
    commit id: "Create release branch"
    checkout main
    branch "hotfix" order: 1
    commit id: "Repair"
    checkout main
    merge "hotfix" id: "Publish patch" tag: "1.0.1"
    checkout "hotfix"
    merge main id: "Sync tag"
    checkout "release"
    merge "hotfix" id: "Apply patch"
    checkout develop
    merge main id: "Sync patch"
```

### Merge methods

- Feature, integration bugfix, production hotfix and documentation PRs
  fast-forward when they contain one commit and the target is its ancestor;
  otherwise they squash.
- Release stabilization, publication and synchronization fast-forward where
  possible; otherwise they use a merge commit to preserve history.

Mermaid draws each [integration as a merge commit](https://mermaid.js.org/syntax/gitgraph.html#merging-two-branches);
the policies above determine the actual Git history. Each documentation branch
merges only into its chosen `develop` or `main` target, without automatic
synchronization.

See [Repository automation](../../.github/workflows/README.md) for branch rules,
merge methods, contributor procedures and publication details.
