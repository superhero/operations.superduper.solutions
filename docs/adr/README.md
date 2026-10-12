# Architectural decision records

## Contents

Each Markdown record explains a coherent project choice, its rationale and its
consequences. Records cover application architecture, contributor standards and
delivery practices. The alphabetical [decision index](../../CONTRIBUTING.md#architectural-decision-records)
is maintained in `CONTRIBUTING.md`.

The [decision to keep ADRs](decision-records.md) defines their purpose and
maintenance. This README provides directory guidance rather than another decision.

## Add or revise a record

- Use a short, descriptive filename in lowercase with hyphens.
- Start with a short title and a GitHub Important callout stating the decision.
- Explain context, rationale, constraints and consequences in focused subsections.
- Group related choices when they share a rationale; separate distinct purposes.
- Add the descriptive decision summary to the alphabetical contributing index.

## Keep the boundary clear

Records describe agreed choices. Commands, detailed procedures and file-placement
guidance belong in operational guides or directory READMEs, which link to ADRs.
Decision records avoid internal hyperlinks; external sources may support their
reasoning.

## Preserve context

Review affected records when architecture changes. Explain revised choices and
their reasons; Git retains previous versions. Keep implementation gaps explicit,
and preserve still-relevant constraints when shortening a record.
