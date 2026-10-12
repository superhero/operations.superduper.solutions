# Contributing

Thank you for considering contributing to `operations.superduper.solutions`.

> [!NOTE]
> Before contributing, please review the architectural decision records (ADRs) below to understand the project's design choices and the reasons behind them.

## Architectural decision records

- [Application content is versioned in separate browser-local Git repositories to preserve independent change histories](docs/adr/local-resource-management.md)
- [Architectural decision records are maintained to preserve reasoning and guide future changes](docs/adr/decision-records.md)
- [Artifacts with distinct purposes are kept separate wherever practical](docs/adr/responsibility-segregation.md)
- [Continuous deployment publishes tested artifacts to Cloudflare, preserving traceability to validated revisions.](docs/adr/continuous-deployment.md)
- [Continuous integration follows a Gitflow branch strategy, with GitHub Actions automating tests that help assure quality between development cycles.](docs/adr/continuous-integration.md)
- [Dedicated workers handle background processing to reduce main-thread workload](docs/adr/dedicated-workers.md)
- [Errors are reported with full transparency through both the user interface and console](docs/adr/error-view.md)
- [OpenAPI documents define the application’s available operations and the input and response models of its workflow nodes](docs/adr/openapi-adaptation.md)
- [Project code and contributions are licensed under AGPLv3-only with additional terms under Section 7](docs/adr/licensing-choice.md)
- [Secrets are excluded from version control and supplied through runtime configuration](docs/adr/runtime-secrets.md)
- [Simple, clear solutions take precedence over unnecessary complexity](docs/adr/simplicity.md)
- [Test reporting includes every test, and release validation requires 100% coverage of explicitly scoped application logic](docs/adr/test-suite-reports.md)
- [The application provides current and historical insights into processing, memory and storage usage](docs/adr/resource-monitoring.md)
- [The interface is built around Svelte, with shared theme and interaction rules](docs/adr/svelte-interface.md)
