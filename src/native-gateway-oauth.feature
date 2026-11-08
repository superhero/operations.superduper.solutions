@native-gateway-oauth
Feature: Owned native gateway OAuth contracts
  Scenario: Gateway actions accept no credential or endpoint overrides
    Then gateway action inputs retain empty native params and name overrides

  Scenario: Every paired initialization negotiates explicit gateway sign-in
    Then native initialization prevents implicit gateway authentication

  Scenario: Credential authority covers encrypted stores without treating locks as credentials
    Then native credential snapshots track both encrypted stores and reject aliases

  Scenario: Workflow gateway sign-in retains only confirmed credentials and transient instructions
    Then gateway workflows adopt only an owned confirmed secondary credential transition

  Scenario: Owned gateway cancellation waits for native acknowledgement in either response order
    Then gateway cancellation releases its owner before rejecting the pending login

  Scenario: Gateway controls require their independent grant and lose changed authority
    Then gateway workflows reject missing grants foreign handoffs and changed primary authority

  Scenario: Gateway models retain native acknowledgements confirmation and notification schemas
    Then gateway operation models preserve their scoped native wire contracts
