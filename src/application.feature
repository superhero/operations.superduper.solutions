Feature: Application startup

  Scenario: Application mounts into the page
    Given a document with an application mount target
    When the application starts
    Then the application is mounted into the target

  Scenario: Application requires a mount target
    Given a document without an application mount target
    When the application starts
    Then startup fails with "Missing #app element"

  Scenario: Dates follow browser language and local time without shifting calendar dates
    Then displayed dates respect browser language and local time

  @startup-recovery
  Scenario Outline: Development startup retries a stale module once in <browser>
    Then development startup reloads once for module failure "<message>"

    Examples:
      | browser  | message                                                           |
      | Chromium | Failed to fetch dynamically imported module: /src/application.ts   |
      | Firefox  | error loading dynamically imported module: /src/application.ts     |
      | WebKit   | Importing a module script failed.                                  |

  @startup-recovery
  Scenario: A failed automatic retry offers recovery instead of looping
    Then a repeated startup module failure stops reloading and displays its details safely

  @startup-recovery
  Scenario: Successful startup restores the next independent recovery attempt
    Then successful startup clears the earlier automatic reload guard

  @startup-recovery
  Scenario: Explicit reload remains available after automatic recovery fails
    Then the startup recovery button clears the guard and reloads the page

  @startup-recovery
  Scenario Outline: Unavailable browser storage cannot create a reload loop after <failure> fails
    Then startup remains recoverable when session storage "<failure>" fails

    Examples:
      | failure    |
      | access     |
      | getItem    |
      | setItem    |
      | removeItem |

  @startup-recovery
  Scenario: Production startup failures require an explicit reload
    Then production module failures show recovery without automatically reloading

  @startup-recovery
  Scenario Outline: Application errors do not trigger a stale module retry for <kind>: <message>
    Then startup "<kind>" with "<message>" shows recovery without automatically reloading

    Examples:
      | kind      | message                                                                        |
      | Error     | Settings storage failed                                                        |
      | TypeError | Cannot read properties of undefined                                            |
      | Error     | Failed to fetch dynamically imported module: application operation failed       |

  @startup-recovery
  Scenario: Mounted applications are not restarted by a later module failure
    Then a module failure after mounting does not automatically reload the page
