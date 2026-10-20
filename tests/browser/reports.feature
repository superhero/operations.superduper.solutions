# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Local evaluation and operation reports
  Scenario: Evaluation details are an optional saved developer preference
    Then evaluation details stay hidden until enabled and the saved choice survives reload

  Scenario Outline: Evaluation reports explain the actual local comparison
    When I search for the operation "<prompt>"
    And I review the matching details
    Then the evaluation report reflects "<prompt>" with top similarity "<similarity>"
    And the evaluation columns show "<proposed>" opposite "<not_proposed>"

    Examples:
      | prompt               | similarity | proposed | not_proposed |
      | Example array response | 100% | Example array response, Example object response, Example HEAD request, Example TRACE request, Example GET request, Example PATCH request, Example POST request, Example PUT request | Example DELETE request, Example OPTIONS request, Example POST body, Example JSON scalar, Example plain text, Example PATCH body, Example query and header inputs |
      | List projetcs        | 85%        | Example array response, Example object response, Example query and header inputs, HTTPBin query and header inputs, Example POST body | Example PATCH body, Example PATCH request, Example POST request, HTTPBin PATCH request |
      | Example array response please | 76% | Example array response, Example object response, Example HEAD request, Example TRACE request, Example GET request | Example JSON array, Example JSON scalar, Example PATCH request, Example POST request |
      | task                 | 36%        | Example POST body, Example PATCH body, Example TRACE request, HTTPBin HEAD request, Example multipart text fields | HTTPBin multipart text fields, HTTPBin PATCH request, Example GET request, Example PUT request |
      | HTTPBin request      | 79%        | HTTPBin GET request, HTTPBin PUT request, HTTPBin HEAD request, HTTPBin POST request, HTTPBin PATCH request, HTTPBin DELETE request, HTTPBin OPTIONS request, HTTPBin plain text, HTTPBin JSON object | Example OPTIONS request, Example GET request, Example PUT request, HTTPBin JSON scalar, HTTPBin URL-encoded form, HTTPBin multipart text fields, Example HEAD request, Example POST request |

  Scenario: Evaluation report values and statuses provide styled accessible hints
    When I search for the operation "listProjects"
    And I review the matching details
    Then evaluation values and statuses show styled hints on hover and keyboard focus

  Scenario: Editing the prompt updates an open report automatically
    When I search for the operation "Example array response"
    And I review the matching details
    And I edit the report prompt to "zzzzzzzzzzzz"
    Then the open report follows the latest prompt automatically
    And the evaluation report reflects "zzzzzzzzzzzz" with top similarity "0%"

  Scenario: Run reports separate catalog sources and input locations between executions
    Given I open the "Example POST body" operation from the catalog
    When I enter these operation inputs:
      | label      | value                 |
      | Path value | report-project        |
      | Title      | Preserve report draft |
      | Priority   | normal                |
    And I expand the operation details
    Then the operation report describes the demo Example POST body source and inputs
    And changing the reported operation resets its schema view and run inputs

  Scenario Outline: Expanded reports fit the available space in both themes
    Then both reports fit a <width> pixel viewport in the "<theme>" theme

    Examples:
      | width | theme |
      | 1280  | light |
      | 390   | dark  |
