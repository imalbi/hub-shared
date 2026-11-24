# Sites (server)

- Sites (`server.ts`, `sites.ts`) uses one module database: raw checks are retained for 24 hours, local-date rollups for 90 days. Each failed five-minute poll counts as five estimated down minutes; an unobserved day is no data. The poller must close before its database and tests inject fetch.

# Sites (web)

- `ui/status-bars.tsx` adapts Hairline status-bars for the Sites history: copy is required from the caller, bars are keyboard-readable, and the last 30 remain visible in narrow containers. Sites with no configured entries are hidden from the rail and widget picker, decided by `sites.configured` (answered from the config; never `sites.state`, which waits for a running check); the settings restart invalidates their configuration query. `ZonePage` waits for that query on a direct Lavoro load before deciding the page is missing; the rail keeps an unknown configuration hidden to avoid changing keyboard shortcuts during load.

- The catalog source uses install-relative imports, checked from `modules.installed/sites/`. Keep its migrations unchanged so the existing module database is reused. The e2e wrapper owns its fake fetch and history seed; the public fake server has no Sites fixture.
