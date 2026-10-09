# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Explore operations from a local OpenAPI catalog

  Scenario: The demo has generic project and task operations
    Then the demo exposes four operations grouped as Projects and Tasks
    And preparing a demo task creates an encoded request preview without making a request

  Scenario: Shared parameters and local schema references retain their meaning
    Then catalog parameters preserve locations and operation overrides
    And source names keep identical operation identifiers distinct
    And local references resolve escaped names and chained references
    And response previews use documented success examples only

  Scenario Outline: Unsupported catalogs fail with a useful reason
    When the catalog contains <problem>
    Then catalog loading fails mentioning "<reason>"

    Examples:
      | problem                       | reason                           |
      | a non-object document         | expected an object               |
      | an unsupported version        | OpenAPI 3.0 or 3.1                |
      | an empty source               | source name                      |
      | missing paths                 | expected an object               |
      | no operations                 | no operations                    |
      | a remote reference            | references must be local         |
      | a cyclic reference            | non-cyclic                       |
      | a missing reference           | reference                        |
      | a malformed reference escape  | JSON pointers                    |
      | reference sibling fields      | sibling fields                   |
      | a numeric reference           | references must be local         |
      | duplicate operation IDs       | duplicate operation identifier   |
      | non-array parameters          | parameters must be an array      |
      | an unsupported location       | supported path/query/header location    |
      | an unnamed parameter          | inputs require a name            |
      | an optional path parameter    | path inputs must be required     |
      | an invalid required flag      | path inputs must be required     |
      | duplicate parameters          | duplicate parameter              |
      | a missing path parameter      | path placeholders                |
      | an unused path parameter      | path placeholders                |
      | missing array items           | expected an object              |
      | an unsupported constraint     | unsupported schema fields        |
      | an invalid enum type          | enum values must match           |
      | an empty enum                 | enum values must match           |
      | a fractional integer enum     | enum values must match           |
      | a string length on a number   | invalid minLength                |
      | a fractional length           | invalid minLength                |
      | a negative length             | invalid maxLength                |
      | a nonnumeric limit            | invalid minimum                  |
      | an infinite limit             | invalid minimum                  |
      | a numeric bound on text       | invalid maximum                  |
      | conflicting numeric bounds    | minimum exceeds maximum          |
      | conflicting text bounds       | minimum exceeds maximum          |
      | an unsupported media type     | application/json                 |
      | invalid body required         | body required must be Boolean    |
      | an unknown schema type        | unsupported input type           |
      | dynamic body properties       | body must describe an object     |
      | undeclared required fields    | required body properties         |
      | invalid required fields       | required body properties         |
      | invalid operation tags        | tags must be nonempty strings    |
      | blank operation tags          | tags must be nonempty strings    |

  Scenario Outline: Local matching tolerates spelling and naming differences
    When I search the demo operations for "<prompt>"
    Then the first matching operation is "<identifier>"

    Examples:
      | prompt             | identifier        |
      | LIST PROJECTS      | demo:listProjects |
      | list_projects      | demo:listProjects |
      | listProjects       | demo:listProjects |
      | demo:listProjects  | demo:listProjects |
      | List projetcs      | demo:listProjects |
      | Create task        | demo:createTask   |

  Scenario: Search handles empty and unrelated queries with no invented match
    Then empty, oversized and unrelated searches return no operations
    And equal matching scores are ordered by operation identifier

  Scenario: Evaluation explains filtering without discarding comparison evidence
    Then evaluation retains every compared score and the exact proposed results

  Scenario: Request input conversion respects the schema
    Then text, numbers, booleans and enum inputs are converted correctly
    And absent optional bodies and fields stay absent

  Scenario Outline: Invalid request input fails at the named field
    When I prepare a request with <problem>
    Then preparation fails mentioning "<reason>"

    Examples:
      | problem                  | reason                     |
      | a missing required path  | Project ID: this field     |
      | a missing required body  | Title: this field          |
      | a blank required value   | Title: this field          |
      | a fractional integer     | Result limit: enter        |
      | an invalid numeric value | Result limit: enter        |
      | an infinite numeric value| Result limit: enter        |
      | a malformed exponent     | Result limit: enter        |
      | a malformed decimal      | Result limit: enter        |
      | a long Unicode string    | Title: text length         |
      | a hexadecimal number     | Result limit: enter        |
      | a number below minimum   | Result limit: value        |
      | a number above maximum   | Result limit: value        |
      | a short string           | Title: text length         |
      | a long string            | Title: text length         |
      | an unknown enum value    | Priority: choose           |
      | an invalid boolean value | Completed: choose          |

  Scenario: Bundled examples cover both execution modes and request representations
    Then both example schemas expose methods and body alternatives
    And request inputs preserve structured JSON, headers and query collections
    And request bodies preserve scalar JSON, plain text and form values

  Scenario: Unsupported representations are rejected instead of losing constraints
    Then unsupported structures and serializations fail during catalog loading

  Scenario: Structured values are checked before request preparation or mapping
    Then nested values enforce declared types, required fields and bounds
