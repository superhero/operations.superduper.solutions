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
explain the work and where it is integrated.

### Everyday changes

Features and integration fixes return to `develop`. Documentation returns only
to its chosen target: `develop` in this example, or `main` for released docs.

```mermaid
%%{init: {"theme": "base", "gitGraph": {"mainBranchName": "develop", "showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "12px", "commitLabelColor": "#0D1117", "commitLabelBackground": "#D8DEE4",
    "git0": "#39B8B0", "gitBranchLabel0": "#0D1117",
    "git1": "#E3B341", "gitBranchLabel1": "#0D1117",
    "git2": "#F06060", "gitBranchLabel2": "#0D1117",
    "git3": "#58A6FF", "gitBranchLabel3": "#0D1117"
}}}%%
gitGraph BT:
    commit id: "Start"
    branch "feature" order: 1
    commit id: "Feature"
    checkout develop
    merge "feature" id: "Integrate feature"
    branch "bugfix" order: 2
    commit id: "Fix"
    checkout develop
    merge "bugfix" id: "Integrate fix"
    branch "docs" order: 3
    commit id: "Documentation"
    checkout develop
    merge "docs" id: "Integrate docs"
```

### Preparing and publishing a release

A release incorporates `main` and receives stabilization fixes while development
continues. After validation, it is published to `main`, tagged, and synchronized
back into `develop`.

```mermaid
%%{init: {"theme": "base", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "12px", "commitLabelColor": "#0D1117", "commitLabelBackground": "#D8DEE4",
    "git0": "#2DA44E", "gitBranchLabel0": "#0D1117",
    "git1": "#A3C441", "gitBranchLabel1": "#0D1117",
    "git2": "#F06060", "gitBranchLabel2": "#0D1117",
    "git3": "#39B8B0", "gitBranchLabel3": "#0D1117"
}}}%%
gitGraph BT:
    commit id: "Released" tag: "1.0.0"
    branch develop order: 3
    commit id: "Integrated work"
    branch "release" order: 1
    merge main id: "Sync main"
    branch "bugfix" order: 2
    commit id: "Stabilize"
    checkout develop
    commit id: "Next work"
    checkout "release"
    merge "bugfix" id: "Integrate fix"
    checkout main
    merge "release" id: "Publish" tag: "1.1.0"
    checkout develop
    merge main id: "Sync release"
```

### Fixing production during a release

A hotfix starts from released `main`. Once published and tagged, `main` is
synchronized into `develop`. The hotfix branch also receives the tagged revision
before carrying the fix into the active release.

```mermaid
%%{init: {"theme": "base", "gitGraph": {"showCommitLabel": true, "rotateCommitLabel": false}, "themeVariables": {
    "commitLabelFontSize": "12px", "commitLabelColor": "#0D1117", "commitLabelBackground": "#D8DEE4",
    "git0": "#2DA44E", "gitBranchLabel0": "#0D1117",
    "git1": "#A371F7", "gitBranchLabel1": "#0D1117",
    "git2": "#A3C441", "gitBranchLabel2": "#0D1117",
    "git3": "#39B8B0", "gitBranchLabel3": "#0D1117"
}}}%%
gitGraph BT:
    commit id: "Released" tag: "1.0.0"
    branch develop order: 3
    commit id: "Next release"
    branch "release" order: 2
    commit id: "Prepare release"
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
