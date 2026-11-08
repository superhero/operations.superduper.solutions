@native-windows-sandbox
Feature: Actual SDK Windows sandbox platform semantics
  Scenario: Actual Linux SDK exposes readiness and failed terminal setup rather than false success
    Then the actual SDK reports Linux Windows readiness and terminal setup failures without changing configuration
  Scenario: Paired Windows readiness needs no account or agent approval
    Then actual paired Windows readiness works without account or agent approval and keeps later calls available
  Scenario: Unverified Windows readiness responses never become confirmed workflow values
    Then malformed platform readiness changed authority and cancellation never return a verified status
