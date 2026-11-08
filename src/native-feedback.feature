# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@native-feedback
Feature: Explicit native feedback delivery
  Uploads have separate host authority, consented bounded diagnostics and no automatic replay.

  Scenario: Feedback preserves native inputs results and portable workflow models
    Then feedback uploads preserve their complete bounded inputs and native result ports

  Scenario: Feedback cannot borrow metadata app or agent authority
    Then feedback and diagnostic tickets require their separate host permissions

  Scenario: Consented feedback attachments are frozen and removed after delivery
    Then feedback uploads freeze complete workspace files and clean their private snapshots

  Scenario: Feedback attachments reject escapes links special files and byte excess
    Then feedback attachment preparation rejects unauthorized paths and bounded file violations

  Scenario: Feedback cannot publish credential echoes or malformed acknowledgements
    Then feedback result validation withholds private values and unclassified acknowledgements

  Scenario: Managed OAuth access refresh and signing secrets cannot enter feedback
    Then native feedback withholds encrypted managed OAuth credentials before and after delivery

  Scenario: Feedback cancellation source drift and transport failure never replay delivery
    Then cancelled stale and uncertain feedback closes its owned child without retrying

  Scenario: Thread feedback stays within owned host and account authority
    Then feedback accepts owned threads and rejects foreign or changed thread authority
