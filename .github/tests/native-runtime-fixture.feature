@automation
Feature: Native browser fixture setup diagnostics
  Scenario: Missing native qualification pins produce a safe HTTP setup diagnostic
    Then the native browser fixture reports missing qualification pins without exposing runtime authority

  Scenario: Stored-thread SDK failures expose safe sandbox setup classifications
    Then the native browser fixture identifies sandbox setup failures without publishing private SDK exceptions
