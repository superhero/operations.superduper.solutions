Feature: Append-only merging across bounded Parakeet input segments
 Scenario: A word cut at rotation stays provisional until corrected
  Given a fresh global transcript merger
  When a rotation ends with the truncated word inter
  Then committed text is "We discuss" and draft text is "inter"
  When the next segment only decodes its repeated context prefix
  Then committed text is "We discuss" and draft text is "inter"
  When the next segment corrects the seam to international trade
  Then committed text is "We discuss" and draft text is "international trade"
  When the corrected segment rotates
  Then committed text is "We discuss international trade" and draft text is ""

 Scenario: A word crossing the safe cutoff survives an incomplete next prefix
  Given a fresh global transcript merger
  When a complete word straddles the rotation cutoff
  Then committed text is "Use" and draft text is "continuous speech"
  When the next segment sees only the con prefix of that protected word
  Then committed text is "Use" and draft text is "continuous speech"
  When the next segment confirms those words at a natural pause
  Then committed text is "Use continuous speech" and draft text is ""

 Scenario: Finalized silence cannot acquire fresh words from repeated context
  Given a fresh global transcript merger
  When a segment finishes with decoded silence after its last word
  Then committed text is "country." and draft text is ""
  And word commitment ends at 58.08 while finalized audio ends at 59
  When the next segment proposes a fresh word inside that finalized silence
  Then committed text is "country." and draft text is ""

 Scenario: A held seam correction may shift before the nominal safe cutoff
  Given a fresh global transcript merger
  When a complete word straddles the rotation cutoff
  And the next segment corrects that word to an earlier ending
  Then committed text is "Use continuity speech" and draft text is ""

 Scenario: A short genuine repeat after finalized silence remains distinct
  Given a fresh global transcript merger
  When a segment finishes with decoded silence after its last word
  And the next segment repeats that word beyond the finalized boundary
  Then committed text is "country. country." and draft text is ""

 Scenario: Genuine consecutive repetitions survive repeated context
  Given a fresh global transcript merger
  When two genuine occurrences of very cross the seam
  Then committed text is "very very" and draft text is ""

 Scenario: An identical sentence spoken later is not deduplicated
  Given a fresh global transcript merger
  When the sentence Go is spoken twice at different absolute times
  Then committed text is "Go. Go." and draft text is ""

 Scenario: Timestamp jitter in repeated context does not append duplicate words
  Given a fresh global transcript merger
  When repeated context shifts slightly into the committed time boundary
  Then committed text is "Hello world. again" and draft text is ""

 Scenario: Repeated context stretches the end of an already committed seam word
  Given a fresh global transcript merger
  When a successor pause commits the previous segment's held word
  Then committed text is "my fellow Americans." and draft text is ""
  When later context extends that same word's end by six hundred milliseconds
  Then committed text is "my fellow Americans. ask not" and draft text is ""

 Scenario: A genuine short repeated word with a nearby onset survives
  Given a fresh global transcript merger
  When a committed short word is repeated at a distinct nearby time
  Then committed text is "Go go" and draft text is ""

 Scenario: Late retired-segment results cannot rewrite the new draft
  Given a fresh global transcript merger
  When a rotation ends with the truncated word inter
  And the next segment corrects the seam to international trade
  And a late previous-segment result says something unrelated
  Then committed text is "We discuss" and draft text is "international trade"
  And the result is explicitly ignored as "retired-segment"

 Scenario: Stable sentences commit before rotation and stay immutable
  Given a fresh global transcript merger
  When the same punctuated partial arrives twice at the same horizon
  Then committed text is "" and draft text is "Hello. next"
  When new decoded audio confirms the sentence
  Then committed text is "Hello." and draft text is "next sentence"
  When a later hypothesis attempts to replace that committed sentence
  Then committed text is "Hello." and draft text is "next sentence"

 Scenario: Real pauses commit while artificial rotations hold the seam
  Given two fresh transcript mergers
  When one reports a natural pause and the other an artificial rotation
  Then the real pause commits all observed words
  And the artificial rotation retains the last second even if pause is incorrectly set

 Scenario: Stopping waits for drained finalization
  Given a fresh global transcript merger
  When the stopping segment returns its final words
  Then committed text is "" and draft text is "still speaking"
  When all segments have drained and I finish the transcript
  Then committed text is "still speaking" and draft text is ""
  And finishing again appends nothing

 Scenario: Empty results preserve a previous draft
  Given a fresh global transcript merger
  When a nonempty partial is followed by an empty result
  Then committed text is "" and draft text is "keep this draft"

 Scenario: Segment-local timestamps are rebased exactly once
  Given a fresh global transcript merger
  When a segment starting at audio second 18 recognizes a local word
  Then the committed word spans absolute seconds 18.2 through 18.5
  And append sequence and committed time never regress

 Scenario: Append-ready fragments retain normal punctuation and spacing
  Given a fresh global transcript merger
  When two natural pauses deliver Hello comma world and then Again
  Then committed text is "Hello, world. Again!" and draft text is ""

 Scenario: A thirty-minute sentence makes progress with bounded retained state
  Given a fresh global transcript merger
  When thirty minutes of unpunctuated speech cross twenty-second cores
  Then all 1800 words appear once and in source order
  And retained words never exceed 34 including at most 12 committed context words
  And append sequence and committed time never regress

 Scenario: Reset starts a new recording without old offsets or sequence
  Given a fresh global transcript merger
  When a segment starting at audio second 18 recognizes a local word
  And I reset and start a new recording
  Then committed text is "new" and draft text is ""
  And the new recording starts with append sequence 1

 Scenario Outline: Invalid local timestamp evidence fails clearly
  Given a fresh global transcript merger
  When the merger receives invalid "<kind>" evidence
  Then the merger rejects that evidence
  Examples:
   | kind                      |
   | already global timestamps |
   | nonfinite timestamp       |
   | reversed timestamp        |
