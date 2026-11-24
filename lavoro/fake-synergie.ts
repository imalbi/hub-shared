export const bootstrapHtml = (appId = 'FAKEAPP01', apiKey = 'fixturealgolia01', indexName = 'fixture_jobs') => `
<!doctype html>
<html>
  <head><title>Offerte</title></head>
  <body>
    <script>
      window.ALGOLIA_APP_ID = "${appId}";
      window.ALGOLIA_API_KEY = "${apiKey}";
      window.ALGOLIA_APPLICATIONS_INDEX_NAME = "${indexName}";
    </script>
  </body>
</html>
`;

export const hit = (
  id: string | number,
  opts: {
    title?: string;
    company?: string | null;
    city?: string | null;
    county?: string | null;
    region?: string | null;
    linkKey?: string | null;
    sourceUrl?: string | null;
    archived?: string | number | boolean;
    contract?: string | null;
    area?: string | null;
    remuneration?: string | null;
    publishedFrom?: number | null;
    positionHtml?: string | null;
    requirementsHtml?: string | null;
  } = {},
) => ({
  objectID: String(id),
  title: opts.title ?? `Addetto esempio ${id}`,
  company_name: opts.company === undefined ? 'Synergie Italia S.p.a.' : opts.company,
  city: opts.city === undefined ? 'Torino' : opts.city,
  county: opts.county === undefined ? 'Torino' : opts.county,
  region: opts.region === undefined ? 'Piemonte' : opts.region,
  linkKey: opts.linkKey === undefined ? `addetto-esempio-${id}` : opts.linkKey,
  source_vacancy_url:
    opts.sourceUrl === undefined
      ? `https://www.synergie-italia.it/candidato/offerte-di-lavoro/addetto-esempio-${id}`
      : opts.sourceUrl,
  published_from: opts.publishedFrom === undefined ? 1795392000000 : opts.publishedFrom,
  contract_type: opts.contract === undefined ? 'Tempo indeterminato' : opts.contract,
  functional_area: opts.area === undefined ? 'ICT' : opts.area,
  remuneration: opts.remuneration === undefined ? null : opts.remuneration,
  archived: opts.archived === undefined ? '0' : opts.archived,
  description_company_html: '<p>Azienda cliente</p>',
  description_position_html:
    opts.positionHtml === undefined ? '<p>Attività tecniche</p><script>hidden()</script>' : opts.positionHtml,
  description_requirements_html: opts.requirementsHtml === undefined ? '<p>Diploma tecnico</p>' : opts.requirementsHtml,
  description_other_info_html: '<p>Orario full time</p>',
});

export const algoliaPage = (hits: ReturnType<typeof hit>[], nbPages = 1) => ({
  nbPages,
  hits,
});

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
