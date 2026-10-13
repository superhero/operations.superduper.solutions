# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@manual-routing
Feature: Authored orthogonal segment routing

  Scenario: normalization clones exact orthogonal intent
    Given manual routing fixture: normalization clones exact orthogonal intent
    When manual routing action: normalization clones exact orthogonal intent
    Then manual routing guarantee: normalization clones exact orthogonal intent

  Scenario: normalization rejects malformed and oversized input
    Given manual routing fixture: normalization rejects malformed and oversized input
    When manual routing action: normalization rejects malformed and oversized input
    Then manual routing guarantee: normalization rejects malformed and oversized input

  Scenario: every normalized straight run exposes its axis and midpoint
    Given manual routing fixture: every normalized straight run exposes its axis and midpoint
    When manual routing action: every normalized straight run exposes its axis and midpoint
    Then manual routing guarantee: every normalized straight run exposes its axis and midpoint

  Scenario: both interior axes move without mutating the captured route
    Given manual routing fixture: both interior axes move without mutating the captured route
    When manual routing action: both interior axes move without mutating the captured route
    Then manual routing guarantee: both interior axes move without mutating the captured route

  Scenario: first last and single segments retain attached endpoint stubs in every direction
    Given manual routing fixture: first last and single segments retain attached endpoint stubs in every direction
    When manual routing action: first last and single segments retain attached endpoint stubs in every direction
    Then manual routing guarantee: first last and single segments retain attached endpoint stubs in every direction

  Scenario: a fast pointer cannot tunnel the selected run through a blocker
    Given manual routing fixture: a fast pointer cannot tunnel the selected run through a blocker
    When manual routing action: a fast pointer cannot tunnel the selected run through a blocker
    Then manual routing guarantee: a fast pointer cannot tunnel the selected run through a blocker

  Scenario: stretching connectors stop before blockers beyond the moving run
    Given manual routing fixture: stretching connectors stop before blockers beyond the moving run
    When manual routing action: stretching connectors stop before blockers beyond the moving run
    Then manual routing guarantee: stretching connectors stop before blockers beyond the moving run

  Scenario: exact obstacle boundary contact permits travel in both directions
    Given manual routing fixture: exact obstacle boundary contact permits travel in both directions
    When manual routing action: exact obstacle boundary contact permits travel in both directions
    Then manual routing guarantee: exact obstacle boundary contact permits travel in both directions

  Scenario: owner clearance cannot be borrowed by an interior segment
    Given manual routing fixture: owner clearance cannot be borrowed by an interior segment
    When manual routing action: owner clearance cannot be borrowed by an interior segment
    Then manual routing guarantee: owner clearance cannot be borrowed by an interior segment

  Scenario: a constrained terminal corridor shares the router clearance policy
    Given manual routing fixture: a constrained terminal corridor shares the router clearance policy
    When manual routing action: a constrained terminal corridor shares the router clearance policy
    Then manual routing guarantee: a constrained terminal corridor shares the router clearance policy

  Scenario: a full clearance route keeps its original policy while dragging
    Given manual routing fixture: a full clearance route keeps its original policy while dragging
    When manual routing action: a full clearance route keeps its original policy while dragging
    Then manual routing guarantee: a full clearance route keeps its original policy while dragging

  Scenario: invalid attachment and very short terminals cannot begin a drag
    Given manual routing fixture: invalid attachment and very short terminals cannot begin a drag
    When manual routing action: invalid attachment and very short terminals cannot begin a drag
    Then manual routing guarantee: invalid attachment and very short terminals cannot begin a drag

  Scenario: preparation and resolution fail closed when their work budget is exhausted
    Given manual routing fixture: preparation and resolution fail closed when their work budget is exhausted
    When manual routing action: preparation and resolution fail closed when their work budget is exhausted
    Then manual routing guarantee: preparation and resolution fail closed when their work budget is exhausted

  Scenario: scratch topology respects the original point cap
    Given manual routing fixture: scratch topology respects the original point cap
    When manual routing action: scratch topology respects the original point cap
    Then manual routing guarantee: scratch topology respects the original point cap

  Scenario: safe collinear collapse can reopen on the opposite side
    Given manual routing fixture: safe collinear collapse can reopen on the opposite side
    When manual routing action: safe collinear collapse can reopen on the opposite side
    Then manual routing guarantee: safe collinear collapse can reopen on the opposite side

  Scenario: opposite run collapse stops before a hairpin
    Given manual routing fixture: opposite run collapse stops before a hairpin
    When manual routing action: opposite run collapse stops before a hairpin
    Then manual routing guarantee: opposite run collapse stops before a hairpin

  Scenario: simultaneous connector collapse checks the whole path and endpoint direction
    Given manual routing fixture: simultaneous connector collapse checks the whole path and endpoint direction
    When manual routing action: simultaneous connector collapse checks the whole path and endpoint direction
    Then manual routing guarantee: simultaneous connector collapse checks the whole path and endpoint direction

  Scenario: manual intent is projected suspended and restored without mutation
    Given manual routing fixture: manual intent is projected suspended and restored without mutation
    When manual routing action: manual intent is projected suspended and restored without mutation
    Then manual routing guarantee: manual intent is projected suspended and restored without mutation

  Scenario: applied manual paths bypass crossing and overlap optimization
    Given manual routing fixture: applied manual paths bypass crossing and overlap optimization
    When manual routing action: applied manual paths bypass crossing and overlap optimization
    Then manual routing guarantee: applied manual paths bypass crossing and overlap optimization

  Scenario: invalid nodes are ignored consistently during manual certification
    Given manual routing fixture: invalid nodes are ignored consistently during manual certification
    When manual routing action: invalid nodes are ignored consistently during manual certification
    Then manual routing guarantee: invalid nodes are ignored consistently during manual certification

  Scenario: scene adapters clone authored points and invalidate worker cache keys
    Given manual routing fixture: scene adapters clone authored points and invalidate worker cache keys
    When manual routing action: scene adapters clone authored points and invalidate worker cache keys
    Then manual routing guarantee: scene adapters clone authored points and invalidate worker cache keys

  Scenario: tolerance-only obstacle clearance cannot snap a drag on pointer down
    Given manual routing fixture: tolerance-only obstacle clearance cannot snap a drag on pointer down
    When manual routing action: tolerance-only obstacle clearance cannot snap a drag on pointer down
    Then manual routing guarantee: tolerance-only obstacle clearance cannot snap a drag on pointer down

  Scenario: a body-only fallback never becomes editable by discarding requested clearance
    Given manual routing fixture: a body-only fallback never becomes editable by discarding requested clearance
    When manual routing action: a body-only fallback never becomes editable by discarding requested clearance
    Then manual routing guarantee: a body-only fallback never becomes editable by discarding requested clearance

  Scenario: successive segment edits adopt only the latest normalized geometry
    Given manual routing fixture: successive segment edits adopt only the latest normalized geometry
    When manual routing action: successive segment edits adopt only the latest normalized geometry
    Then manual routing guarantee: successive segment edits adopt only the latest normalized geometry

  Scenario: deterministic obstructed scenes retain valid clearance throughout captured gestures
    Given manual routing fixture: deterministic obstructed scenes retain valid clearance throughout captured gestures
    When manual routing action: deterministic obstructed scenes retain valid clearance throughout captured gestures
    Then manual routing guarantee: deterministic obstructed scenes retain valid clearance throughout captured gestures
