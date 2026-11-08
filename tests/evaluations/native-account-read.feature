@native-account-read
Feature: Actual SDK account reads
  Scenario: Four account reads use only the owned authenticated backend
    Then the pinned SDK reads gateway readiness usage limits and workspace messages through the owned backend
  Scenario: Four account reads complete through the paired encrypted broker
    Then four actual SDK account reads complete through the encrypted paired broker
  Scenario: Backend account responses cannot publish native credential values
    Then native account credentials and encoded echoes remain private at the companion
