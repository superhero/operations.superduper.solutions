# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@schema-history
Feature: Schema commit comparisons and correction review
  Schema settings show source ancestry, corrections and merge decisions without eager document loading.

  @service-defaults @chromium-only
  Scenario Outline: DigitalOcean corrections appear as separate reviewable schema revisions
    When I use a viewport of <width> by 900 pixels
    Then DigitalOcean revisions compare published security with retained token permissions

    Examples:
      | width |
      | 390   |
      | 1280  |

  Scenario: Commit comparisons and colored field diffs preserve conflict review and mobile scrolling
    Then schema history compares any saved commits with lazy colored diffs and persistent conflict choices

  Scenario: Settings protect default schemas and require deactivation before upload deletion
    Then schema settings explain deletion restrictions and cancel confirmation when an upload is reactivated

  @service-defaults @chromium-only
  Scenario Outline: Schema revisions open with their initial comparison ready
    When I use a viewport of <width> by 900 pixels
    Then schema revisions open without flashing disabled comparison controls

    Examples:
      | width |
      | 390   |
      | 1280  |

  @service-defaults @chromium-only
  Scenario Outline: Schema revisions retain their content until the closing slide ends
    When I use a viewport of <width> by 900 pixels
    Then schema revisions close without collapsing their content early and support reversal and reduced motion

    Examples:
      | width |
      | 390   |
      | 1280  |

  Scenario Outline: Schema settings group only name segments and preserve controls on desktop and mobile
    When I use a viewport of <width> by 844 pixels
    Then schema name folders preserve keyboard access renaming disablement deletion and reload

    Examples:
      | width |
      | 320   |
      | 1280  |
