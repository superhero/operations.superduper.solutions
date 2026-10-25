# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
Feature: BigQuery metadata-only jobs
  Scenario: Metadata correction preserves native contracts and Google grant alternatives
    Then BigQuery metadata correction preserves its pinned source identities peers and scopes

  Scenario: Job metadata prepares the documented JSON destination
    Then BigQuery job configuration and reference prepare exact metadata without an upload route

  Scenario: Private metadata dispatch retains credential isolation
    Then BigQuery metadata dispatch uses one private bearer request and rejects stale authority

  Scenario: Changed native contracts cannot receive the metadata correction
    Then BigQuery metadata correction rejects changed destinations bodies and provenance

  Scenario: Upstream JSON and repeated corrections remain stable
    Then BigQuery metadata correction preserves an already correct Job body and reviewed provenance
