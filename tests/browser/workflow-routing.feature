# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-routing
Feature: Measured workflow connection routing
  Scenario: Orthogonal connections avoid measured blockers and meet their handles
    Given an imported routing workflow with a blocking node
    Then the routed connection clears the blocker and meets its measured handles

  Scenario: Moving a node keeps routed endpoints attached during the drag
    Given an imported routing workflow with a blocking node
    Then moving the routed target keeps its endpoint attached in every sampled frame

  Scenario: A snapped preview retains the pointer and carries its detour into the dropped edge
    Given an imported routing workflow ready for a new connection
    Then its raw pointer line and translucent snapped route survive a body drop

  Scenario Outline: Disabled node controls allow a snapped connection to finish
    Given an imported routing workflow with disabled switch controls
    Then dropping a routed connection over its disabled <control> finishes the connection

    Examples:
      | control |
      | button  |
      | input   |

  Scenario Outline: Connections created later share dash phase at common coordinates
    Given an imported routing workflow with dash gap <gap>
    Then a later connection shares animated dash phase along overlapping routed segments

    Examples:
      | gap |
      | 4   |
      | 13  |

  Scenario: Reduced motion stops the shared routing dash clock
    Given an imported routing workflow with dash gap 13
    Then reduced motion keeps the routed dashes stationary

  @workflow-dash-settings
  Scenario: Dash preferences update routed and curved connections with pause and resume
    Given an imported routing workflow with dash gap 4
    Then dash length gap and speed update existing routes and previews and pause both connection styles

  Scenario: Curved connections retain the configured curve strength
    Given an imported routing workflow with a blocking node
    Then changing curve strength changes its control points without changing its endpoints

  Scenario: Routing remains derived geometry across save reload and undo
    Given an imported routing workflow with a blocking node
    Then moving and undoing the blocker restores its derived route without saving routing state

  Scenario: Routing workers close immediately when their canvas becomes inactive
    Given an imported routing workflow with observable worker lifetimes
    Then pending routing work closes with the canvas and reopening creates one fresh worker

  @delayed-routing
  Scenario: A busy routing worker retains only the newest scene and rejects stale geometry
    Given an imported routing workflow with observable worker lifetimes
    Then rapid node movement retains one calculation and only the newest pending scene

  @delayed-routing
  Scenario: A cancelled drag cannot supply a delayed preview to the next drag
    Given an unconnected routing workflow with observable worker replies
    Then a delayed reply from a cancelled drag cannot change the next drag preview

  @delayed-routing
  Scenario: Dropping a newly selected snap target carries the projected preview while its reply is delayed
    Given an unconnected routing workflow with observable worker replies
    Then changing snap targets with a delayed reply preserves the first dropped edge geometry

  @delayed-routing
  Scenario: Reverse native handle connections retain their routed preview after release
    Given a routing workflow with native handles and observable worker replies
    Then a reverse handle drag preserves the preview geometry when its edge direction is normalized

  @node-clearance
  Scenario: Node clearance reroutes existing connections and persists as an application setting
    Given an imported routing workflow with a blocking node
    Then changing node clearance preserves measured spacing without changing the workflow document

  @node-clearance
  Scenario Outline: A narrow handle exit preserves clearance around the rest of the route
    Given an imported routing workflow with a narrow output corridor
    Then its narrow output corridor preserves <clearance> units around unconstrained node faces

    Examples:
      | clearance |
      | 12        |
      | 36        |
