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

The example prepares `1.1.0` while `1.0.1` fixes production. The tagged hotfix
returns to `develop` and the active release before that release is published.

```mermaid
%%{init: {"gitGraph": {"showCommitLabel": false}}}%%
gitGraph BT:
    commit tag: "1.0.0"
    branch develop order: 4
    branch "feature/topic" order: 5
    commit
    checkout develop
    merge "feature/topic"
    branch "bugfix/topic" order: 6
    commit
    checkout develop
    merge "bugfix/topic"
    branch "release/1.1.0" order: 2
    branch "bugfix/stabilize" order: 3
    commit
    checkout "release/1.1.0"
    merge "bugfix/stabilize"
    checkout main
    branch "hotfix/1.0.1" order: 1
    commit
    checkout main
    merge "hotfix/1.0.1" tag: "1.0.1"
    checkout develop
    merge main
    checkout "hotfix/1.0.1"
    merge main
    checkout "release/1.1.0"
    merge "hotfix/1.0.1"
    checkout main
    merge "release/1.1.0" tag: "1.1.0"
    checkout develop
    merge main
    branch "docs/guide" order: 7
    commit
    checkout develop
    merge "docs/guide"
```

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
