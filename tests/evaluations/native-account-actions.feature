@native-account-actions
Feature: Actual SDK account actions against an owned backend
  Scenario: The SDK preserves reset idempotency outcomes and email cooldowns
    Then actual SDK account actions retain their backend payloads and result enums
  Scenario Outline: Paired actions use native backend auth when provider metadata requires auth <required>
    Then actual paired account actions require explicit approval with provider auth "<required>"
    Examples:
      | required |
      | true     |
      | false    |
  Scenario: Anonymous and API key sessions cannot redeem credits or send owner email
    Then the actual SDK rejects account actions without ChatGPT backend authentication
  Scenario: Failed backend actions stay private and are not replayed
    Then actual account action failures retain no private backend text or implicit retry
