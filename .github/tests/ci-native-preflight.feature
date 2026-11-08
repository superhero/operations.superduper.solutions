@automation
Feature: Real native SDK sandbox qualification fails before expensive CI work
  Scenario: Native SDK preflight reports only owned sandbox diagnostics
    Then the native preflight verifies persisted command output and redacts failure context

  Scenario: Native SDK probe processes have a hard group deadline
    Then container native probes require complete evidence and enforce the fifteen second deadline

  Scenario: Early native qualification uses an immutable browser image
    Then native qualification resolves only the exact declared browser image and its registry digest

  Scenario: Early native qualification fails closed and removes its owned container
    Then a failed native sandbox gate retains evidence and cleans its isolated runtime

  Scenario: Native qualification cleanup failures cannot certify success
    Then native preflight cleanup failures fail the gate and preserve its diagnostic

  Scenario: Native SDK qualification precedes source coverage in every validation workflow
    Then all validation preparation jobs gate expensive checks on the real native sandbox
