# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@github-archive
Feature: Private GitHub migration archives
  Scenario: GitHub migration archives retain their native source and explicit transport
    Then both archive models preserve native302 contracts and require the qualified companion

  Scenario: GitHub archive downloads isolate credentials across actual HTTP hops
    Then both private archive requests follow one302 and preserve exact compressed bytes without forwarding credentials

  Scenario: GitHub archive destinations redirects and binary limits fail closed
    Then the archive host rejects unapproved locations extra redirects oversized bytes and cancelled requests

  Scenario: GitHub archive private state rejects stale transport and connection grants
    Then archive pairing references survive encrypted reload and invalidate on rotation or removal

  Scenario: GitHub archive relay replies cannot expose private download locations
    Then malformed archive replies changed guards and permission failures expose no private response material
