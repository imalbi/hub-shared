# Hub Shared Modules

Private catalog of trusted modules for Hub. Modules run inside the Hub server with its permissions: install only code you trust. No package installation or independent server is needed.

## Installation

1. Give each collaborator access to this private GitHub repository. On the machine running Hub, configure Git authentication for the same URL used in Catalogo: HTTPS with a credential helper, or SSH with an authorized key available to the Hub service. An iPhone uses the server credentials, not its own. Never put a token in the repository URL.
2. Open Impostazioni > Catalogo on the PC and add this repository's HTTPS or SSH URL. The source stays registered in that installation; it is not a public Hub default. Git runs without interactive credential prompts, so authentication must already work from the server environment.
3. Install Lavoro, then choose Ricostruisci e riavvia. Configure `modules.lavoro` in local Hub settings before collecting announcements. Keep its module name unchanged to reuse the existing database.
4. Copy `lavoro/skills/paths.example.json` to `lavoro/skills/paths.local.json` in the installed module and set the CV/output folder. This file is private and never published. Keep a separate backup: reinstalling or updating a catalog module replaces its directory, including this local file.

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

The source toggles live in `search.sites`; Indeed additionally requires local `sources.indeed` credentials. Provider keys, mail accounts, professional profile and preferences belong only to local settings. Geographic and employer defaults inherited from the initial installation remain for now: review each enabled source's settings before sharing with another person. Automatic setup from a CV/profile is deferred.

Removing or reinstalling Lavoro preserves its module database. Module code, migrations, tests and skills are versioned here; personal config, CVs, documents and databases are excluded. See [Lavoro](lavoro/README.md) and [skills](lavoro/skills/README.md).
