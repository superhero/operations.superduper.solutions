@automation
Feature: Owned native containers retain enforcing AppArmor confinement
  Scenario: Native AppArmor rules retain Docker protection and bound sandbox setup
    Then the owned native AppArmor policy preserves Docker denials and constrains sandbox mounts

  Scenario: Native AppArmor removal requires verified container absence
    Then an owned native AppArmor profile loads uniquely and unloads only after verified container removal

  Scenario: Native AppArmor detection fails closed on unavailable protection
    Then inactive AppArmor needs no policy while active unavailable tooling fails closed

  Scenario: Native AppArmor failures retain safe recovery evidence
    Then native AppArmor load and unload failures retain their owned profile for recovery
