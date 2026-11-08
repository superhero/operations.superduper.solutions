# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: Source-qualified AWS Query and EC2 Query operations
  Scenario: Frozen query actions retain their canonical and strict identities
    Then all 2726 AWS query operations hydrate through both parsers with reviewed profiles
  Scenario: Standard Query parameters preserve nested lists maps timestamps and scalar values
    Then AWS Query encodes nested parameters without replacing Action or Version
  Scenario: EC2 Query uses its distinct member casing and flattened lists
    Then EC2 Query preserves documented filter names list indexes and empty collections
  Scenario: XML wrappers and EC2 results decode into logical SDK values
    Then AWS query XML decodes results errors and metadata while rejecting unsafe documents
  Scenario: Native query requests sign final GET and POST requests for every provider
    Then all twelve AWS query providers verify independent final request signatures
  Scenario: Queue routing remains inside the approved SQS authority
    Then SQS query variants preserve native queue paths and reject arbitrary queue destinations
  Scenario: Unsigned STS exchanges keep assertions and returned credentials private
    Then STS query exchanges use private assertions without requiring unrelated AWS credentials
  Scenario: Recursive credential results are adopted before publication
    Then AWS query credentials nested secrets MFA data and private map values never become public results
  Scenario: Modified models cannot obtain query signatures
    Then AWS query revisions input schemas methods and signing metadata reject drift
  Scenario: Long query descriptions fit stored workflows while source documentation stays complete
    Then the ten AWS query description synopses preserve their full canonical documentation
