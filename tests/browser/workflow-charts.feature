Feature: Workflow visualization tabs
  Normal workflow forms and live views share a run without resetting requests.

  Scenario: All seven selected views render in workflow run tabs
    Then the chart example renders seven run views with multiple series and a table

  Scenario: Changing the view updates input ports and removes incompatible connections
    Then changing a chart to Sankey replaces series ports with nodes and links

  Scenario: Live streams update several tabs without resetting forms or duplicating requests
    Then a streamed workflow preserves forms across tabs and cancels its request on quit

  Scenario: Invalid values stay in their view while empty slices and table text render honestly
    Then invalid chart values remain local while zero slices and table text have honest displays

  Scenario: Charts use the selected theme and repaint when its mode changes
    Then chart marks and tooltips use theme colors across views and live theme changes

  Scenario: Pie labels fit a narrow workflow run
    Then narrow pie views keep percentage labels inside the plot and names in a legend

  Scenario: Two browser streams can run and stop independently
    Then two live sources keep separate controls while their views continue updating

  Scenario: Larger charts retain the original views and remain usable with more data
    Then expanded comparisons render dense views with solid pie slices and paged tables

  Scenario: Inspection fills the viewport and preserves zoom and legend choices across tabs
    Then dense charts support range zoom magnification reset filtering and local export

  Scenario: Pattern choices are independent saved opt-ins for different graph types
    Then chart patterns start off and saved per-type choices survive a reload

  Scenario: Dragging directly on a Cartesian plot zooms into the selected region
    Then plot selections zoom Line Area Bar and Scatter to the chosen coordinates

  Scenario: The scroll wheel zooms all graph types without a modifier key
    Then scrolling over each plot zooms in and out while reset and saved inspection still work

  Scenario: Sankey clicks toggle cumulative highlights while hover only shows values
    Then Sankey nodes and flows toggle independently and keep their highlights across tabs and zoom

  Scenario: Tables use readable type-aware columns and stable decimal precision
    Then table values use monospace stripes aligned types and themed booleans without changing exports

  Scenario: Diagram wheel magnification remains stable during resizing and tab changes
    Then repeated diagram wheel zoom produces no native resize errors

  Scenario: The overflowing run tab bar scrolls horizontally with the mouse wheel
    Then wheel input scrolls run tabs while native gestures and keyboard navigation remain usable

  Scenario: Responsive legends wrap entries and page crowded views with the wheel
    Then wrapped legends keep entries clear of the plot and crowded legends scroll without zooming
