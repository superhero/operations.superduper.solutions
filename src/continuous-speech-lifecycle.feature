Feature: Continuous speech application lifetime
  Scenario: The archive acknowledgement finishes before runtime handoff
    Then continuous capture waits for the complete archive before releasing its recording
  Scenario: Confirmed text is appended once and finalization waits for storage
    Then continuous dictation preserves its stable sequence and waits for the main recording save
  Scenario: An obsolete permission failure cannot close a replacement session
    Then late continuous microphone failures leave the new speech worker alive
  Scenario: Failed preparation releases its recording and permits a fresh worker
    Then failed continuous preparation releases its recording claim before retry
  Scenario: Cancellation fences a pending recovery metadata lookup
    Then a cancelled archive lookup cannot create a recording on a replacement worker
  Scenario: Failed archival settles before dropping its recovery source
    Then continuous failure cleanup is coalesced and retains a late failed PCM tail
  Scenario: Old Stop completion cannot update a replacement session
    Then an old continuous Stop cannot change replacement state
  Scenario: A missing stable update is a visible recoverable error
    Then a continuous stable sequence gap stops explicitly with recovery retained
  Scenario: Failed continuous loading preserves a previous legacy recording
    Then a continuous load failure leaves the previous legacy audio untouched
  Scenario: Unloading during optional module loading prevents late initialization
    Then a cancelled continuous module import cannot initialize speech later
