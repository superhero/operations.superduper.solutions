# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@automation
Feature: Record verified Cloudflare Pages deployment outcomes

  Scenario Outline: Confirm the deployed bundle in its own GitHub environment
    Given a successful Pages deployment for "<branch>"
    When the Pages deployment outcome is recorded
    Then GitHub records a successful Pages deployment for the requested commit
    And the Pages summary links to the stable branch and immutable deployment URLs

    Examples:
      | branch         |
      | main           |
      | develop        |
      | release/1.2.3  |
      | hotfix/1.2.4   |

  Scenario: An unchanged bundle may reuse a verified older deployment
    Given a successful Pages deployment for "develop"
    And the existing Pages deployment belongs to an older commit
    When the Pages deployment outcome is recorded
    Then GitHub records a successful Pages deployment for the requested commit

  Scenario: Wait for the deploy stage instead of trusting the build stage
    Given a successful Pages deployment for "develop"
    And Pages first reports a successful build followed by an active deploy
    When the Pages deployment outcome is recorded
    Then GitHub records a successful Pages deployment for the requested commit

  Scenario Outline: Unconfirmed Cloudflare outcomes are recorded as failures
    Given a successful Pages deployment for "develop"
    And Pages verification reports "<problem>"
    When the Pages deployment outcome is recorded
    Then GitHub records a failed Pages deployment with "<reason>"

    Examples:
      | problem                  | reason                                      |
      | failed deploy            | stage=deploy:failure                        |
      | canceled deploy          | stage=deploy:canceled                       |
      | wrong branch             | mismatched deployment identity              |
      | wrong environment        | mismatched deployment identity              |
      | wrong bundle             | mismatched deployment identity              |
      | untrusted URL            | mismatched deployment identity              |
      | invalid JSON             | invalid deployment response                 |
      | invalid stage            | invalid deployment stage                    |
      | API rejection            | Cloudflare error 10000                      |
      | transport failure        | Cloudflare error 10000                      |
      | timeout                  | Timed out waiting for Cloudflare            |
      | missing credentials      | requires CLOUDFLARE_API_TOKEN                |

  Scenario: An action failure without a deployment ID still reaches GitHub
    Given a successful Pages deployment for "develop"
    And the Pages action failed before returning a deployment ID
    When the Pages deployment outcome is recorded
    Then GitHub records a failed Pages deployment with "Cloudflare deployment action failed"

  Scenario Outline: GitHub recording failures include operation context and redact credentials
    Given a successful Pages deployment for "develop"
    And GitHub rejects Pages recording at "<operation>"
    When the Pages deployment outcome is recorded
    Then Pages recording fails with "<reason>" and safe deployment context

    Examples:
      | operation          | reason                                |
      | deployment create  | Could not create GitHub deployment    |
      | deployment status  | Could not record GitHub deployment    |

  Scenario Outline: Invalid deployment identities cannot write GitHub records
    Given a successful Pages deployment for "develop"
    And the Pages recording argument "<argument>" is invalid
    When the Pages deployment outcome is recorded
    Then no external Pages recording request is made

    Examples:
      | argument      |
      | branch        |
      | commit        |
      | bundle        |
      | deployment ID |
