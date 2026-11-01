Feature: Chart preferences and inspection ranges
  Scenario: Patterns require an explicit valid choice for each graph type
    Then chart preferences default to solid graphs and validate each graph independently

  Scenario: Pattern choices use different geometry without inventing colors
    Then chart patterns keep the supplied theme color and support independent fill and line styles

  Scenario: Zoom stays bounded and separate run views keep separate inspection state
    Then chart zoom preserves its centre and clamps its bounds without sharing run state

  Scenario: Plot selections require Shift for directional ranges and normalize rectangles
    Then chart selections require Shift for axis ranges and stay inside the plot

  Scenario: Sankey selections combine connected flows and retain identity across updates
    Then Sankey highlights combine clicked items and ignore missing selections

  Scenario: Legend rows reserve plot space and crowded legends retain navigation
    Then legend rows fit the measured width and share their reserved space with selection geometry

  Scenario: Pattern updates notify active views without mutating default preferences
    Then chart pattern subscribers receive normalized updates and release their subscription

  Scenario: Palette errors and exhausted color choices have bounded fallbacks
    Then chart colors reject malformed tones and keep degenerate palettes bounded
