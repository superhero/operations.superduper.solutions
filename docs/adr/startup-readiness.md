# Startup readiness

> [!IMPORTANT]
> Application preparation belongs in the loading phase, so startup completion marks a responsive interface.

## Loading boundary

Initialization and any eager preparation finish before the loading screen shows
`Completed` and disappears. Deferring that work until the browser is idle after
startup moves its cost into the user's interaction time and makes readiness
misleading.

## On-demand views

Views may remain lazy when preparing or maintaining them would add unnecessary
startup, memory or rendering costs. Their preparation begins when requested;
they are not silently preloaded during idle time. The Browser settings dashboard
retains this approach for now.

If a view becomes eagerly prepared, its preparation belongs within loading.
Keeping it mounted must also account for subscriptions, calculations and DOM
updates while it is hidden; hiding a view alone does not remove those costs.

## Ongoing work

Resource monitoring, persistence and other ongoing application functions continue
after startup. Their scheduling protects interaction responsiveness. They are
runtime responsibilities, rather than unfinished startup preparation.
