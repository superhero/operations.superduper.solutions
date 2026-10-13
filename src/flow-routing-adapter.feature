# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

@flow-routing
Feature: Measured routing geometry and persistent routing sessions

  Scenario: Unnamed handles and pointer-free previews preserve measured endpoint geometry
    Given measured source and target nodes whose handles have no identifiers
    When a snapped unnamed-handle preview is compared with a completed edge
    Then unnamed handles resolve their outer positions and absent pointers retain the snapped endpoint

  Scenario: Failed layout and incremental calculations retain the last successful session cache
    Given routing sessions whose full and incremental engines can fail
    When a scene edit fails and the previous scene is requested before retrying
    Then the native error cause is preserved and only successful edits replace cached routes

  Scenario: routing uses measured node bounds and the named handles in absolute flow coordinates
    Given measured absolute node bounds and several named handles
    When the routing scene is built from the named connection handles
    Then routing uses measured node bounds and the named handles in absolute flow coordinates

  Scenario: hidden branches, missing measurements and non-routed edge styles stay out of the routing scene
    Given visible nodes mixed with hidden unmeasured and non-routed items
    When the routing scene filters unsupported nodes and edges
    Then hidden branches, missing measurements and non-routed edge styles stay out of the routing scene

  Scenario: connection previews retain exact pointer geometry and handle direction before and after snapping
    Given an active connection with fractional pointer coordinates
    When free and snapped connection geometries are derived
    Then connection previews retain exact pointer geometry and handle direction before and after snapping

  Scenario: the cursor arrow follows the raw pointer while the landing preview remains snapped
    Given a snapped connection with a separate raw screen pointer
    When pointer and landing geometries are calculated at two zoom levels
    Then the cursor arrow follows the raw pointer while the landing preview remains snapped

  Scenario: snapped previews use the same outer handle endpoints as completed edges in either drag direction
    Given a completed edge and a matching snapped drag in each direction
    When the preview endpoints are compared with the completed edge
    Then snapped previews use the same outer handle endpoints as completed edges in either drag direction

  Scenario: a preview sharing an existing source handle avoids a false crossing detour
    Given an existing arrow and a preview sharing one source handle
    When the measured preview is routed beside the existing arrow
    Then a preview sharing an existing source handle avoids a false crossing detour

  Scenario: worker reuses scene routing during pointer movement and applies changed crossing options
    Given a routing session with an existing crossing arrow
    When pointer movement and crossing options change between calculations
    Then worker reuses scene routing during pointer movement and applies changed crossing options

  Scenario: worker replaces routes when obstacles move and recovers after a failed scene
    Given a routing session whose edge is blocked by a movable node
    When the obstacle moves and a failed scene is followed by a valid scene
    Then worker replaces routes when obstacles move and recovers after a failed scene

  Scenario: releasing a connection retains its preview route and leaves existing arrows unchanged
    Given a routed preview that avoids an existing crossing arrow
    When the preview is committed and an existing arrow is then removed
    Then releasing a connection retains its preview route and leaves existing arrows unchanged

  Scenario: a shared-input preview keeps its two-bend overlay on release
    Given a preview approaching the same input as an existing lower arrow
    When the shared-input preview is committed to the session
    Then a shared-input preview keeps its two-bend overlay on release

  Scenario: a preview aligns with an existing parallel section and retains that alignment on release
    Given a preview aligned with an existing parallel route section
    When the aligned preview is committed to the session
    Then a preview aligns with an existing parallel section and retains that alignment on release
