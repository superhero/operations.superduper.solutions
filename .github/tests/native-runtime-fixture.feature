@automation
Feature: Native browser fixture setup diagnostics
  Scenario: Missing native qualification pins produce a safe HTTP setup diagnostic
    Then the native browser fixture reports missing qualification pins without exposing runtime authority
