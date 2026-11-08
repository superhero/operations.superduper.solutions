@native-gateway-oauth
Feature: Actual SDK gateway OAuth
  Scenario: Explicit gateway login and cancellation stay passive until the owned handoff
    Then the actual SDK keeps gateway reads passive and releases an owned cancelled login

  Scenario: Native runtime authority changes when an encrypted credential store changes
    Then the actual runtime pins encrypted credential bytes separately from gateway sidecar locks

  Scenario: Actual SDK gateway workflows cancel and retry through the private paired broker
    Then the actual SDK gateway controls retain their private workflow owner
