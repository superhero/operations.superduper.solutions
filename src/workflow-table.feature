Feature: Readable workflow table values
  Scenario: Table types follow retained values without coercing strings
    Then table columns infer genuine numeric and boolean types across bounded updates

  Scenario: Numeric columns share precision without floating point tails
    Then table decimal formatting keeps meaningful fractions and suppresses rounding noise

  Scenario: Boolean labels blend semantic colors with each active palette
    Then boolean table styles keep readable red and green hints in every theme mode

  Scenario: Repeated and incomplete table cells retain safe display values
    Then repeated numbers share formatting and incomplete runtime rows remain text
