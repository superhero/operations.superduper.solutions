@native-turn-work
Feature: Owned review and compaction workflow lifecycles
  Scenario: Review target inputs preserve native variants and stable delivery boundaries
    Then native turn work validates all review targets and identifies invalid fields
  Scenario: Review and compaction operation models retain native wire contracts
    Then native turn work models preserve acknowledgements and terminal notifications
  Scenario Outline: <method> waits for completion after its acknowledgement
    Then owned native work "<method>" waits for its terminal turn
    Examples:
      | method               |
      | review/start         |
      | thread/compact/start |
  Scenario Outline: <method> retains an early terminal until acknowledgement
    Then early native work "<method>" completes only after its acknowledgement
    Examples:
      | method               |
      | review/start         |
      | thread/compact/start |
  Scenario: Native work rejects foreign threads and foreign acknowledgements
    Then native turn work rejects foreign owners without exposing results
  Scenario: Review and compaction allow owned stop but withhold steering
    Then native turn work supports interruption and rejects steering
  Scenario: Revoked authority and private results cannot complete native work
    Then native turn work withholds revoked and credential-bearing results
  Scenario: An inline review delegate cannot replace its parent turn ownership
    Then review delegate starts preserve the acknowledged parent in both event orders
