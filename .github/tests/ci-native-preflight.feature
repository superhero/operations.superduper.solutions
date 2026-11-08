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

  Scenario: Uncertain AppArmor profile state retains its recovery source
    Then native AppArmor load and unload uncertainty retains its owned profile files

  Scenario: Native sandbox failure audits include only the owned probe interval
    Then native kernel audit diagnostics filter exact profile time and host PID and redact other data

  Scenario: Native sandbox diagnostics identify the selected qualified helper
    Then native helper diagnostics verify the first qualified PATH entry and record its actual digest

  Scenario: Native SDK qualification precedes source coverage in every validation workflow
    Then all validation preparation jobs gate expensive checks on the real native sandbox
