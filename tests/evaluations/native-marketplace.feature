@native-marketplace
Feature: Actual SDK marketplace effects
  Scenario: Marketplace add upgrade and remove preserve their exact native filesystem and configuration effects
    Then the pinned SDK registers local and Git marketplaces upgrades real revisions and removes only its owned clones
  Scenario: Marketplace changes keep the encrypted pairing current across native effects
    Then actual SDK marketplace changes advance their encrypted binding and preserve later calls
  Scenario: Marketplace effects cannot be adopted without their exact verified receipt
    Then unverified marketplace effects and receipts never advance the encrypted pairing
