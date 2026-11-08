@native-windows-sandbox
Feature: Windows sandbox lifecycle contracts
  Scenario: Windows provisioning leaves the active catalog while its native evidence remains
    Then only Windows setup is excluded and every other native method retains its model
  Scenario: Windows sandbox input readiness and completion contracts preserve native semantics
    Then Windows sandbox contracts preserve modes nullable project scope and correlated completion without treating started as success
  Scenario: Windows readiness models preserve portable standalone workflow semantics
    Then Windows readiness models keep their native enum and standalone portable workflow while setup stays guarded
  Scenario: Windows readiness grants and authority cannot cross platform or runtime identity
    Then Windows readiness requires its owner grant and stable platform account workspace and configuration authority
