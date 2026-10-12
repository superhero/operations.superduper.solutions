# Contributing

Thank you for considering contributing to `operations.superduper.solutions`.

Before contributing, please review the architectural decision records (ADRs) below to understand the project's design choices and the reasons behind them.

## Architectural decision records

- [Simple, clear solutions take precedence over unnecessary complexity](docs/adr/simplicity.md)
- [The interface is built around Svelte, with shared theme and interaction rules](docs/adr/svelte-interface.md)
- [Secrets are excluded from version control and supplied through runtime configuration](docs/adr/runtime-secrets.md)
- [Continuous integration and deployment follow Gitflow, with a fully passing test suite required for release](docs/adr/continuous-integration-and-deployment.md)
- [Errors are reported clearly through the user interface and console](docs/adr/error-view.md)
- [Dedicated workers handle background processing to reduce main-thread workload](docs/adr/dedicated-workers.md)
- [Test reporting includes every test, and release validation requires 100% coverage of explicitly scoped application logic](docs/adr/test-suite-reports.md)
- [Project code and contributions are licensed under AGPLv3-only with additional terms under Section 7](docs/adr/licensing-choice.md)
- [Application content is versioned in separate browser-local Git repositories to preserve independent change histories](docs/adr/browser-version-management.md)
- [OpenAPI documents define the application’s available operations and the input and response models of its workflow nodes](docs/adr/openapi-adaptation.md)
- [The application provides current and historical insights into processing, memory and storage usage](docs/adr/resource-monitoring.md)
- [Artifacts with distinct purposes are kept separate wherever practical](docs/adr/responsibility-segregation.md)
