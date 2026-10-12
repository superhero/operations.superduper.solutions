# Architectural decision records

> [!IMPORTANT]
> Architectural decision records are maintained to preserve reasoning and guide future changes.

## Purpose

ADRs retain the context, constraints and tradeoffs behind significant decisions.
They give contributors a shared basis for reviewing changes, understanding the
architecture and reconsidering choices when circumstances change. This knowledge
remains available beyond individual conversations and contributors.

## Scope and format

Each record covers one coherent decision and its rationale and consequences.
Closely related choices may share a record when they share that rationale.

A short title, Important decision summary and focused subsections make records
easy to scan. Decisions describe agreed choices; operational guides carry
commands and detailed procedures.

## Maintenance

ADRs live in `docs/adr`, with an alphabetical index in `CONTRIBUTING.md`.
Architectural changes include a review of the relevant records. Revised decisions
explain what changed and why; Git history preserves earlier reasoning.

Operational guides link to ADRs. ADRs avoid internal links, while external
references may support their reasoning.
