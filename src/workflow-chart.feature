Feature: Workflow chart views
  Charts display connected workflow values without owning measurement retention.

  Scenario: Invalid and legacy visualization configurations have explicit boundaries
    Then visualization configuration validates bounded ports and restores legacy defaults

  Scenario: Missing and legacy chart values remain local safe view results
    Then visualization snapshots bound malformed inputs and retain legacy text safely

  Scenario: JSON streams handle endings and reject malformed or oversized frames
    Then JSON stream readers preserve complete endings and reject invalid bounded input

  Scenario: JSON streams cancel and expire without leaving a locked reader
    Then JSON stream readers cancel at delivery boundaries and release failed readers

  Scenario: Chart configuration validates supported views and bounded fields
    Then chart configuration accepts supported views and rejects invalid settings

  Scenario: Chart field mapping preserves zero null gaps and escaped property names
    Then chart mapping uses JSON pointers without coercing invalid numbers

  Scenario: Chart axes handle categories numbers and timestamps with bounded points
    Then chart axes validate coordinates and keep only the latest configured points

  Scenario: Chart configuration round trips through documents and clipboard
    Then chart configuration survives import export and independent clipboard identities

  Scenario: Chart data ports accept compatible sources and reject invalid connections
    Then chart ports accept JSON data and reject private or incompatible direct sources

  Scenario: File values render chart results without an API operation
    Then a file to chart workflow completes with transient bounded chart results

  Scenario: Chart mapping errors stay local to the view
    Then malformed chart input produces an honest chart error without failing execution

  Scenario: Inactive chart branches do not fabricate values
    Then inactive chart branches leave no chart results

  Scenario: Private transformations cannot leak into chart results
    Then chart sinks withhold private vault processing values

  Scenario: Nested chart results retain their workflow scope
    Then nested charts preserve their document identity in transient results

  Scenario: Chart edits and dimensions have meaningful workflow history
    Then chart history describes configuration and size changes

  Scenario: Named series have independent ports and bounded live samples
    Then named chart series preserve their ports mappings and independent live windows

  Scenario: Table columns select fields and keep cell text safe and bounded
    Then table views infer or select columns and bound retained rows and cells

  Scenario: Sankey inputs validate nodes weighted links and acyclic graphs
    Then Sankey views reject missing nodes negative weights and cycles

  Scenario Outline: JSON streams deliver samples before completion across chunk boundaries
    Then a "<profile>" stream delivers chart samples before closing
    Examples:
      | profile  |
      | sse-json |
      | ndjson   |

  Scenario: Live chart updates do not execute downstream operations
    Then streamed values reach chart ports while normal workflow requests remain step driven

  Scenario: Credential streams withhold secret-bearing samples
    Then credential stream samples are checked before leaving the execution boundary

  Scenario: Stream cancellation releases the reader and ignores late samples
    Then cancelling a JSON stream releases its reader and ends pending chart delivery

  Scenario: Healthy series cannot hide an error in another input
    Then chart input errors remain visible until their own input recovers

  Scenario: Chart colors and styles follow semantic names and blends of active theme tones
    Then chart presentation blends theme tones and keeps named identities across ordering

  Scenario: Large comparison examples preserve the original data and add all seven views
    Then the expanded chart example preserves small views and executes larger datasets

  Scenario: A live stream releases later workflow forms after its first sample
    Then a live stream continues updating after later operations and workflow steps finish

  Scenario: Multiple live streams can be stopped independently
    Then stopping one stream leaves another stream running and Quit cancels all

  Scenario: Background completion cannot cancel a later pending request
    Then a completed background stream preserves the foreground request controller

  Scenario: Background stream failures remain visible without blocking later forms
    Then a stream failure after promotion leaves the next form usable

  Scenario: Completed streams ignore late samples
    Then a completed stream cannot change its views through a stale callback

  Scenario: A stream failing before its first sample can be retried explicitly
    Then stream connection failure keeps the original form ready without an automatic retry
