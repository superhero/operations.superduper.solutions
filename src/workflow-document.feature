# Copyright (C) 2026 Erik Landvall
# SPDX-License-Identifier: AGPL-3.0-only
# See LICENSE and LICENSE-ADDITIONAL-TERMS.

Feature: Local workflow documents
  Workflows preserve visual plans without executing operations or accepting unsafe graph data.

  Scenario: Exported plans retain operation identity and view settings
    Given a workflow connecting two instances of the same operation
    When that workflow is serialized and imported
    Then the operation identities, connections, and view settings are preserved
    And presentation-only and unrecognized data are removed

  Scenario: Invalid imported plans are rejected with meaningful reasons
    Given a workflow connecting two instances of the same operation
    Then invalid workflow documents are rejected for these reasons:
      | mutation            | reason                                      |
      | null document       | Expected a workflow document object         |
      | primitive document  | Expected a workflow document object         |
      | array document      | Expected a workflow document object         |
      | old version         | Unsupported workflow document version       |
      | missing nodes       | at most 500 nodes                           |
      | too many nodes      | at most 500 nodes                           |
      | missing edges       | at most 500 nodes                           |
      | too many edges      | at most 500 nodes                           |
      | unknown method      | Unsupported operation method                |
      | nontext name        | Operation name must be a nonempty text      |
      | blank name          | Operation name must be a nonempty text      |
      | long name           | Operation name must be a nonempty text      |
      | nontext description | Operation description must be a text        |
      | long description    | Operation description must be a text        |
      | nonnumeric position | Workflow coordinates must be finite numbers |
      | infinite position   | Workflow coordinates must be finite numbers |
      | oversized position  | Workflow coordinates must be finite numbers |
      | missing source      | must refer to nodes in this document        |
      | missing target      | must refer to nodes in this document        |
      | duplicate node      | IDs must be unique                          |
      | duplicate edge      | IDs must be unique                          |
      | invalid zoom low    | Workflow zoom must be between               |
      | invalid zoom high   | Workflow zoom must be between               |
      | invalid view flag   | Workflow view options must be booleans      |

  Scenario: Malformed or oversized JSON cannot be imported
    Then malformed and oversized workflow files are rejected

  @manual-routing-persistence
  Scenario Outline: Manual routes survive export and import in every supported document version
    Then version <version> workflows preserve authored routes and leave automatic connections unchanged

    Examples:
      | version |
      | 1       |
      | 2       |
      | 3       |

  @manual-routing-persistence
  Scenario: Authored routes are normalized without retaining caller-owned data
    Then manual route validation clones points and removes duplicate and collinear points

  @manual-routing-persistence
  Scenario: Route limits include their documented boundaries
    Then manual routes accept 128 points and coordinates at both allowed boundaries

  @manual-routing-persistence
  Scenario Outline: Invalid authored routes cannot enter workflow storage
    Then workflow validation rejects a manual route with <defect>

    Examples:
      | defect                    |
      | a null value              |
      | a non-array value         |
      | no points                 |
      | one point                 |
      | more than 128 points      |
      | too many redundant points |
      | a null point              |
      | an array point            |
      | a function point          |
      | a missing coordinate      |
      | a nonnumeric coordinate   |
      | an infinite coordinate    |
      | a NaN coordinate          |
      | a coordinate above bounds |
      | a coordinate below bounds |
      | a diagonal segment        |
      | a tiny diagonal segment   |
      | an immediate reversal     |
      | only duplicate points     |

  @manual-routing-persistence
  Scenario: Nested workflow routes remain isolated from their source and outer interface
    Then nested workflow snapshots clone authored routes while new interface connections remain automatic

  Scenario: Documented schemas create separate input and response branches
    Given a documented workflow with nested objects and arrays
    Then location panels and all documented HTTP response panels have stable named field handles
    And examples never invent workflow fields

  Scenario: HTTP response envelopes expose metadata body and documented headers
    Then response outputs retain status messages body shapes and referenced header contracts
    And response body and header properties remain editable without changing legacy body identities
    And open response header objects add only wire text unless a property schema declares another type

  Scenario: Rich documents preserve mappings and hidden schema branches
    Given a documented workflow with nested objects and arrays
    When a named output field is mapped to an input field
    And a separate schema branch is hidden
    Then the version 2 workflow survives export and import with its handles and branch state
    And runtime selection and dimensions are not persisted

  Scenario: Field mapping uses direction, named ports, and compatible declared types
    Given a documented workflow with nested objects and arrays
    Then only visible output-to-input named field connections are accepted
    And duplicate mappings and structural header connections are rejected

  Scenario: A selected schema arrow hides a recoverable branch
    Given a documented workflow with nested objects and arrays
    When a nested schema connection is removed
    Then that branch and its descendants are hidden while their topology is retained
    When that data branch is restored
    Then all its schema panels and connections are visible again

  Scenario: Deleting an operation removes its owned panels and mappings
    Given a documented workflow with nested objects and arrays
    When a named output field is mapped to an input field
    And the producing operation is deleted
    Then only the receiving operation and its panels remain

  Scenario: Deleting a mapping preserves the input panel
    Given a documented workflow with nested objects and arrays
    When a named output field is mapped to an input field
    And that field mapping is removed
    Then the input panel and all schema branches remain visible

  Scenario: Version 1 operation connections remain distinct in a richer plan
    Given a workflow connecting two instances of the same operation
    When a documented operation is added to the legacy workflow
    Then its legacy connection is preserved without becoming a field mapping

  Scenario: Rich imported graphs reject invalid owners, handles, and ancestry
    Given a documented workflow with nested objects and arrays
    Then invalid rich workflow documents are rejected for these reasons:
      | mutation                  | reason                              |
      | missing owner             | data owner must refer               |
      | data owner                | data owner must refer               |
      | unsupported node          | Unsupported workflow node type      |
      | unsupported edge          | Unsupported workflow connection kind |
      | unsupported direction     | direction must be                   |
      | unsupported field type    | Unsupported workflow field type     |
      | duplicate field           | IDs must be unique                  |
      | unknown connectable field | Unknown fields                      |
      | structural field id       | structural value ports              |
      | too many fields           | at most 200 fields                  |
      | bad root handle           | owner's named schema handle         |
      | bad nested handle         | declared object or array field      |
      | missing attachment        | schema branch leading to its owner  |
      | cyclic ancestry           | ancestry must not contain cycles    |
      | mismatched visibility     | visibility must agree               |
      | unknown mapping handle    | visible, named output fields        |
      | reversed mapping          | visible, named output fields        |
      | duplicate mapping         | Duplicate field mappings            |
      | untyped data connection   | Legacy connections must join        |
      | legacy rich source        | without field handles or schema panels |
      | legacy rich target        | without field handles or schema panels |

  Scenario: Incomplete response contracts remain explicit
    Then missing, alternative, recursive, and unsupported schemas display notices without guessed handles

  Scenario: Schema projection stays bounded and preserves documented alternatives
    Then deep, wide, and large schema trees stay within workflow document limits
    And parameter overrides, scalar responses, and unavailable representations remain explicit

  Scenario: Rich graph limits apply before malformed topology is accepted
    Then oversized field collections and ambiguous structural attachments are rejected

  Scenario: Version 3 retains editable workflow notes and utility node settings
    Given a workflow containing switches, casts, and comments
    When the extended workflow is exported and imported
    Then its description, gates, cast settings, comments, and named utility connections survive
    And earlier document versions retain their original supported shape

  Scenario: Utility connections follow their named scalar ports
    Given a workflow containing switches, casts, and comments
    Then utility ports accept scalar routes and reject invalid directions, objects, comments, and duplicate operands
    And deleting a utility removes only its connections and node

  Scenario: Editing switch gates keeps their connections coherent
    Given a workflow containing switches, casts, and comments
    When switch gates are added, edited, and removed
    Then unary gates lose operand wires and deleted gates lose both kinds of wire
    And switch editing respects gate and value limits

  Scenario: Casts make scalar conversions explicit
    Then scalar casts accept documented conversions and reject ambiguous values

  Scenario: Switches route only the first matching gate
    Then switch comparisons respect literal types, wired operands, missing values, and gate order

  Scenario: Routing input types propagate through casts and switch cycles
    Given a workflow containing switches, casts, and comments
    Then connected scalar types propagate without recursive traversal
    And switch literals adapt to inferred types without replacing wired operands

  Scenario: Saved workflows become portable nested snapshots
    Given a saved workflow with an internally supplied input
    When that saved workflow is embedded in another workflow
    Then the nested snapshot exposes unsupplied inputs and all visible outputs
    And removing the nested owner removes its interface panels

  Scenario: Partly supplied object inputs expose only the remaining fields
    Then nested interfaces omit supplied objects, supplied descendants, and hidden branches

  Scenario: Nested snapshots preserve portable endpoints across export and import
    Given a saved workflow with an internally supplied input
    When that saved workflow is embedded in another workflow
    Then nested snapshot edits are isolated from the saved source
    And repeated snapshot copies remain valid
    And forged nested endpoints and unsupported utility payloads are rejected

  Scenario: Embedded snapshots cannot exceed bounded depth, graph size, or file size
    Then cyclic and oversized embedded workflow documents are rejected

  Scenario: Nested interfaces retain schema notices and terminate malformed ancestry
    Then nested schema projection keeps explanatory notices and handles unfinished connections
    And aggregate field limits include every repeated snapshot copy

  Scenario: Every supported request media type has a usable input graph
    Then example request graphs include structured forms scalar roots headers and null values

  Scenario: Open object properties remain editable after import
    Then open object panels accept typed additional properties with stable escaped handles
    And added objects remain extensible after export and import

  Scenario: Schema-valued additional properties preserve nested contracts
    Then typed additional properties create nested object and array branches in both directions

  Scenario: Closed and ambiguous object contracts cannot be bypassed
    Then closed synthetic unavailable and constrained panels reject additional properties
    And declared hidden fields and repeated names cannot be added again

  Scenario: Additional object properties respect graph bounds
    Then property names fields and nested branches stay within document limits

  Scenario: Added property names can change without breaking their connections
    Then additional property renames preserve escaped handles mappings and hidden descendants

  Scenario: Added property types update only their affected branches
    Then property type changes retain compatible mappings and replace obsolete descendants

  Scenario: Removing an added property removes its owned branch
    Then removing added properties retains unrelated graph state and documented fields

  Scenario: Existing added properties remain editable when an object is full
    Then property edits use canonical names and enforce schema policy without addition limits
