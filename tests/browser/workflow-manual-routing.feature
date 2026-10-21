# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.
@workflow-manual-routing
@toolbar-controls
Feature: Manually adjusting workflow connections
  Scenario: Hover and selection expose accessible controls at every segment midpoint
    Given an imported manual routing workflow at zoom 1
    Then its segment controls follow hover and selection and describe their allowed motion

  Scenario Outline: Dragging remains axis constrained at every supported zoom
    Given an imported manual routing workflow at zoom <zoom>
    Then both segment axes follow diagram coordinates without panning or selecting nodes

    Examples:
      | zoom |
      | 0.25 |
      | 1    |
      | 2    |

  Scenario Outline: Endpoint segments can move without disconnecting their ports
    Given an imported <shape> connection for manual routing
    Then dragging its <segment> segment inserts attached endpoint bends

    Examples:
      | shape    | segment |
      | authored | first   |
      | authored | last    |
      | straight | only    |

  Scenario: A fast pointer movement cannot tunnel a segment through a node
    Given an imported manual routing workflow with a nearby blocker
    Then a single pointer jump stops its segment at node clearance

  Scenario: Cancelled and unchanged drags do not create durable revisions
    Given an imported manual routing workflow at zoom 1
    Then unchanged Escape pointer cancellation and window blur preserve its route and history

  Scenario: Repeated keyboard movements commit on release and focus departure cancels them
    Given an imported manual routing workflow at zoom 1
    Then focused segment keys move on their axis and save once on release or cancel with Escape

  Scenario: Moving a blocker temporarily suspends and then restores authored geometry
    Given an imported manual routing workflow with a nearby blocker
    Then moving the blocker across its authored route preserves intent and restores the route when cleared

  Scenario: A completed drag is one durable edit through undo reload import and reset
    Given an imported automatic connection for manual routing
    Then one manual drag survives history navigation reload and import and can be reset

  Scenario: Curved and orthogonal modes share authored routes and editing
    Given an imported manual routing workflow at zoom 1
    Then curved connections retain editable anchors and preserve adjustments across styles

  Scenario: Pending manual edits survive later cancellations dialogs and delayed replies
    Given an imported manual routing workflow with delayed worker replies
    Then a stale calculation cannot flash an older route over two completed manual drags
