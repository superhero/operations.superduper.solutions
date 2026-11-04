Feature: Continuous capture with durable serial speech segments
  Scenario: Capture continues while an earlier segment is unfinished
    Given a speech coordinator with a memory archive and a slow recognizer
    When I capture 41 seconds without completing recognition
    Then only the first segment has started and later audio is safely retained

  Scenario: Arbitrary packet partitions preserve exact overlap and global samples
    Given a speech coordinator with a memory archive and a slow recognizer
    When I capture irregular packets for 65 seconds and 123 samples and drain
    Then archived cores reconstruct every input sample exactly once

  Scenario: A long recognition backlog keeps only bounded PCM in memory
    Given a speech coordinator with a memory archive and a slow recognizer
    When I capture 95 seconds without completing recognition
    Then pending segment descriptors are durable and PCM memory stays bounded

  Scenario: Queued segments replay serially after the active result
    Given a speech coordinator with a memory archive and a slow recognizer
    When I capture 41 seconds without completing recognition
    And I send an out of order result then finish the first segment
    Then the second segment starts from archived audio without skipping samples

  Scenario: Stop drains exact-boundary segments without a duplicated overlap tail
    Given a speech coordinator with a memory archive and a slow recognizer
    When I capture exactly 40 seconds then stop and drain
    Then exactly two segments finish with all features released

  Scenario: Cancel fences a delayed start but preserves captured audio
    Given a speech coordinator with a memory archive and a slow recognizer
    When I cancel during an unacknowledged segment start
    Then late messages cannot publish a transcript and the audio stays archived

  Scenario: A storage quota failure preserves recovery audio
    Given a speech coordinator with a memory archive and a slow recognizer
    When storage rejects the first sealed segment
    Then the failure is explicit and the captured core remains recoverable

  Scenario: A stalled archive cannot create an unbounded PCM promise queue
    Given a speech coordinator with a memory archive and a slow recognizer
    When a second core fills before the first archive write completes
    Then backpressure fails visibly while both captured cores remain recoverable

  Scenario: Stop waits for a pending rotation write before sealing its final tail
    Given a speech coordinator with a memory archive and a slow recognizer
    When I stop with a rotation write pending and a one second final tail
    Then all twenty one seconds finish without a storage backpressure error

  Scenario: Empty stop creates no inference or feature owners
    Given a speech coordinator with a memory archive and a slow recognizer
    When I stop without capturing audio
    Then no segment or feature owner was created

  Scenario: Repeated cancellation waits for the same pending archive
    Given a speech coordinator with a memory archive and a slow recognizer
    When I cancel twice while archiving a final captured tail
    Then both cancellation calls wait for one durable audio archive

  Scenario: Stop seals an idle active segment without another PCM push
    Given a speech coordinator with a memory archive and a slow recognizer
    When I stop an idle active stream while its final archive is held
    Then exactly one end follows durable storage and Stop finishes without more audio
