@native-guardian
Feature: Observed Guardian denial approvals
  Scenario: Guardian inputs select observed IDs and preserve all seven native actions
    Then Guardian action conversion preserves all seven variants and rejects editable events
  Scenario: Guardian lifecycle ownership and freshness cannot be forged or replayed
    Then Guardian reviews reject foreign changed expired and replayed lifecycles
  Scenario: Thread reviewers keep human defaults and require the independent host grant
    Then AI approval review requires both an explicit thread choice and its host grant
  Scenario: A selected denial waits for human confirmation before native dispatch
    Then an observed Guardian denial dispatches only after one matching human approval
  Scenario: Decline cancellation and revoked source authority prevent approval effects
    Then declined cancelled or revoked Guardian approvals never dispatch
  Scenario: Foreign review IDs and malformed native events cannot acquire approval
    Then foreign and malformed Guardian denials remain unavailable
  Scenario: Malformed native acknowledgements cannot become successful approvals
    Then malformed Guardian acknowledgement withholds success without replay
  Scenario: Guardian private action content cannot reach public progress
    Then Guardian action credential echoes are withheld
  Scenario: Guardian models retain native wire definitions and portable workflow fields
    Then Guardian operation models retain native event and notification schemas
  Scenario: Multiline content stays explicit while native identifiers remain strict
    Then native multiline action text preserves content without widening identifier validation
