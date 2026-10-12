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

See [Repository automation](../../.github/workflows/README.md) for branch rules,
merge methods, contributor procedures and publication details.
