Feature: Continuous speech storage and worker delivery
  Scenario: Long recordings retain every segment and export each unique sample once
    Then continuous audio storage retains thirty segments as one recording and exports exact cores
  Scenario: Unfinished audio remains recoverable after a page reload
    Then continuous recovery audio and its sample hash survive a reload
  Scenario: Speech workers import current source without model downloads
    Then the real continuous speech worker runs in production and development without page globals
  Scenario: Continuous controls and prepared playback follow the selected recording
    Then continuous controls omit legacy refinement and release prepared playback audio
