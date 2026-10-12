# Contributing

Thank you for contributing to `operations.superduper.solutions`.

## Architectural decision records

- [Simple, clear solutions take precedence over unnecessary complexity](docs/adr/simplify.md)
- [The interface is built around Svelte, with shared theme and interaction rules](docs/adr/ui.md)
- [Secrets are excluded from version control and supplied through runtime configuration](docs/adr/security.md)
- [Continuous integration and deployment follow Gitflow, with a fully passing test suite required for release](docs/adr/branching-and-releases.md)
- [Errors are reported clearly through the user interface and console](docs/adr/diagnostics-and-error-reporting.md)
- [Dedicated workers handle background processing to reduce main-thread workload](docs/adr/background-processing.md)
- [Test reporting includes every test, and release validation requires 100% coverage of explicitly scoped application logic](docs/adr/testing-coverage-and-reporting.md)
- [Project code and contributions are licensed under AGPLv3-only with additional terms under Section 7](docs/adr/licensing.md)
- [Application content is versioned in separate browser-local Git repositories to preserve independent change histories](docs/adr/content-versioning.md)
- [OpenAPI documents define the application’s available operations and are managed through a browser-local schema library](docs/adr/schema-management.md)
- [The application’s workflows represent HTTP operations as nodes whose inputs and responses follow the OpenAPI model](docs/adr/workflow-operation-nodes.md)
- [The application provides current and historical insights into processing, memory and storage usage](docs/adr/resource-monitoring.md)
- [Artifacts with distinct purposes are kept separate wherever practical](docs/adr/single-purpose-artifacts.md)
