@native-account-auth
Feature: Actual SDK account authentication
  Scenario: API key sign-in logout and browser cancellation retain their native effects
    Then the pinned SDK signs in with an owned key logs out and cancels its own browser attempt
  Scenario: Three authentication methods complete through their own granted broker scope
    Then the actual SDK authenticates logs out and cancels through the encrypted workflow broker
  Scenario: A provider without account requirements still persists an explicitly selected sign-in key
    Then account authentication preserves native provider metadata when authentication is optional
