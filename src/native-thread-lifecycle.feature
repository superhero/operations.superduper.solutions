@native-thread-lifecycle
Feature: Scoped native stored-thread lifecycle
  Scenario: Lifecycle inputs preserve all eight bounded contracts
    Then native lifecycle inputs retain fork cutoffs nullable patches and section ordering

  Scenario: Lifecycle inputs identify forbidden authority and malformed metadata
    Then native lifecycle inputs name forbidden overrides and invalid mutation fields

  Scenario: Thread subtree inspection rejects cycles limits and foreign workspaces
    Then native thread trees include live descendants and reject cyclic oversized or escaping scopes

  Scenario: Lifecycle writes require separate grants and preserve thread ownership
    Then lifecycle dispatch preserves agent ownership and revokes execution until explicit resume

  Scenario: Lifecycle metadata uses pairing authority and blocks encoded credential disclosure
    Then paired lifecycle metadata requires no agent login and withholds encoded credentials
