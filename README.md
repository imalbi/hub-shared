# Hub Shared Modules

A catalog of six optional modules for [Hub](https://github.com/imalbi/hub). Modules run inside the Hub server with its permissions: install only code you trust. Catalogo installs each module's declared dependencies; no independent server is needed.

## Modules

| Module    | What it adds                                                                         | Local setup                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `lavoro`  | Job searches, ranking, applications and interviews; optional integration with `mail` | Search sources, filters and professional profile under `modules.lavoro`. See [Lavoro](lavoro/README.md) and [skills](lavoro/skills/README.md). |
| `mail`    | Mailboxes, conversations, sending and new-mail notifications                         | Configure Himalaya separately, then list its account names and display labels in `modules.mail.accounts`.                                      |
| `sites`   | Site availability and check history                                                  | Set `modules.sites` to an array of `{ "name": "Example", "url": "https://example.org" }` entries.                                              |
| `weather` | Current weather and forecasts                                                        | Choose a location in Hub settings under `modules.weather`.                                                                                     |
| `study`   | Study plans, materials, review, calendar and today contributions                     | Configure plan and material folders under `modules.study`. See [Study](study/README.md) and its [plan schema](study/plan.schema.json).         |
| `music`   | YouTube library and playback queue in Media                                          | Settings belong under `modules.music`; the module owns `youtubei.js` and authenticated artwork below `/m/music/cover`.                         |

Pomodoro, system audio and the generic media player remain in Hub core. Keep module names unchanged to reuse existing databases.

## Installation

1. Open **Impostazioni > Catalogo** on the PC and add `https://github.com/imalbi/hub-shared.git` as a source.
2. Install the modules you need. Configure their local settings in Hub before using features that need accounts, folders or search preferences.
3. Choose **Ricostruisci e riavvia** to load the installed modules and their UI.
4. If using the Lavoro skills, copy `lavoro/skills/paths.example.json` to `lavoro/skills/paths.local.json` in the installed module and set your CV/output folder. Keep a separate backup: reinstalling or updating a catalog module replaces its directory, including this local file.

Removing or reinstalling a module preserves its module database. Personal configuration, credentials, CVs, documents and databases belong only to the local installation and are excluded from this repository.

## Lavoro configuration

Minimal example with invented values, using a source that needs no credential:

```json
{
  "modules": {
    "lavoro": {
      "search": {
        "sites": ["reteinformaticalavoro"],
        "location": "Exampleville",
        "hoursOld": 72,
        "queries": [{ "name": "Web", "keywords": "frontend" }]
      },
      "filter": {
        "minScore": 1,
        "minTitleScore": 0,
        "maxYearsExperience": 3,
        "allowedLocations": ["exampleville"]
      },
      "weights": { "title": { "frontend": 3 } }
    }
  }
}
```

Source selection lives in `search.sites`; each query can override it with its own `sites` list. The following scopes are optional when unused and must be explicitly configured when enabled globally or by any query. There are no implicit geographic or employer preferences.

| Scope under `modules.lavoro` | Required fields                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `search.inpa`                | `regionId` (positive inPA region ID)                                                                     |
| `search.iren`                | `regions` (non-empty list of IRENfutura region codes)                                                    |
| `search.successfactors`      | `employers` (non-empty list of `{ host, company }`), `places` (non-empty list)                           |
| `search.oracle`              | `employers` (non-empty list of `{ host, site, company }`)                                                |
| `search.avature`             | `employers` (non-empty list of `{ listUrl, company, country }`; empty `country` means no country filter) |
| `search.manpower`            | `city` and non-empty `functions`, using the site's URL slugs                                             |
| `search.workday`             | `employers` (non-empty list of `{ host, tenant, site, company, searchText? }`)                           |
| `search.synergie`            | `regions` (non-empty list of region names)                                                               |
| `sources.indeed`             | Local `apiKey`, `userAgent` and `appInfo` credentials when Indeed is enabled                             |

`reteinformaticalavoro` and `linkedin` need no additional required scope. Technical defaults such as page limits and delays remain available. Provider keys, mail accounts, professional profile and preferences belong only to local settings.

When upgrading from a version with implicit source preferences, configure the scopes of every enabled source before restarting. Existing explicit values remain valid at their current `search.<site>` paths. A missing or incomplete scope fails validation with its field path instead of silently collecting from inherited locations or employers. Automatic setup from a CV/profile is deferred.

## Rights and third-party notices

All rights reserved. No license is granted for this repository's original code. Public visibility allows viewing and forking as provided by GitHub's terms; it does not grant broader reuse rights.

Third-party material retains its own terms. See [Lavoro skill attributions](lavoro/skills/THIRD-PARTY.md); npm dependencies retain their respective licenses and notices.
