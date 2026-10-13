# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation @release-changelog
Feature: Release changelog preparation in Git
  Develop integrations fold Staging before a release head is tested and preserve
  the existing release version and its fixes.

  Scenario: Extend the same version with another develop integration
    Given a local release prepared from develop Staging
    And the release has its own fix and develop has another staged commit
    When the next develop integration prepares that release
    Then the release version contains each staged commit exactly once
    And the release retains its own fix and has empty Staging

  Scenario: Retry after changelog preparation before opening the release PR
    Given a local release prepared from develop Staging
    When release changelog preparation is retried
    Then the prepared release commit and remote branch do not change

  Scenario: Refuse conflicts in application files
    Given a local release prepared from develop Staging
    And release and develop have conflicting application changes
    When the next develop integration is refused
    Then the release remote branch does not change

  Scenario: Refuse a branch that advanced after preparation
    Given a local release prepared from develop Staging
    And the release has its own fix and develop has another staged commit
    When the release branch advances before publication
    Then publishing the prepared release refuses the stale expected head
    And the release remote branch does not change

  Scenario: Refuse publication that would discard release ancestry
    Given a local release prepared from develop Staging
    When publication would replace it with an unrelated prepared history
    Then the release remote branch does not change

  Scenario: Changelog formatting alone does not make a release eligible
    Given a local release prepared from develop Staging
    When only the initialized baseline is compared for release eligibility
    Then changelog preparation reports no substantive release changes
