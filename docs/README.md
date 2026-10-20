# Project documentation

## What belongs here

This directory holds durable explanations of project decisions. Its current
contents are [architectural decision records](adr/README.md), which preserve
the choices and reasoning behind the application and its development practices.

## Service inventory

[Default service schemas](default-service-schemas.md) lists bundled providers,
selected product scopes and browser execution limits.

[Workflow files](workflow-files.md) explains parsed data, binary uploads and
automatic file casts.

[Schema performance](schema-performance.md) records the measured discovery,
matching and retention changes. Its JSON sidecar preserves numeric evidence;
raw profiles remain generated test artifacts.

## Choose the document type

| Information | Location |
| --- | --- |
| Architectural choice, rationale and consequences | [adr](adr/README.md) |
| Purpose and placement of files in a directory | That directory's `README.md` |
| Project commands and dependencies | [Root README](../README.md) |
| CI checks, reports, releases and recovery procedures | [Repository automation](../.github/workflows/README.md) |
| Contributor entry point and alphabetical ADR index | [Contributing](../CONTRIBUTING.md) |

Keep procedures with their owning domain and link to the relevant decision
instead of copying its explanation into several guides.

## Maintain useful guidance

Use descriptive headings, short paragraphs and concrete placement rules.
Update guidance alongside changes to responsibilities or behavior. Distinguish
implemented behavior from agreed standards with pending implementation work.
Temporary investigation notes and generated reports do not belong here.
