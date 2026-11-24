import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultCategories, parereIntervalMs, profileSchema } from './config.ts';
import { inventedIndeed, inventedProfile } from './invented-profile.ts';

const paths = (input: unknown) => {
  const result = profileSchema.safeParse(input);
  assert.equal(result.success, false);
  return result.error.issues.map((issue) => issue.path.join('.'));
};

void test('automatic Parere defaults off with a 15 RPM rate and five manual calls reserved', () => {
  const settings = profileSchema.parse(inventedProfile()).parere;
  assert.equal(settings.auto, false);
  assert.equal(settings.perMinute, 15);
  assert.equal(settings.manualReserve, 5);
  for (const perMinute of [0, -1, 1.5]) {
    assert.equal(profileSchema.safeParse({ ...inventedProfile(), parere: { perMinute } }).success, false);
  }
  assert.equal(profileSchema.safeParse({ ...inventedProfile(), parere: { manualReserve: -1 } }).success, false);
});

void test('the per-minute limit spaces Gemini calls and never a local Ollama model', () => {
  const parere = profileSchema.parse(inventedProfile()).parere;
  assert.equal(parereIntervalMs({ ...parere, provider: 'gemini', perMinute: 15 }), 4000);
  assert.equal(parereIntervalMs({ ...parere, provider: 'ollama', perMinute: 15 }), 0);
});

void test('a profile with the draft shape parses and keeps its values', () => {
  const profile = profileSchema.parse(inventedProfile());
  assert.equal(profile.search.queries.length, 2);
  assert.equal(profile.search.queries[1]?.maxResults, 20);
  assert.equal(profile.search.linkedin.maxRequests, 90);
  assert.equal(profile.filter.minScore, 5);
  assert.equal(profile.weights.title.senior, -4);
  assert.equal(profile.weights.workMode.remote, 2);
});

void test('defaults fill country names, categories, patterns and the LinkedIn limits', () => {
  const minimal = {
    search: { sites: ['indeed'], location: 'Examplia', hoursOld: 24, queries: [{ name: 'Web', keywords: 'web' }] },
    filter: { minScore: 1, minTitleScore: 0, maxYearsExperience: 3 },
    weights: { title: { web: 1 } },
    sources: { indeed: inventedIndeed },
  };
  const profile = profileSchema.parse(minimal);
  assert.deepEqual(profile.filter.countryNames, ['italia', 'italy']);
  assert.deepEqual(profile.categories, defaultCategories);
  assert.deepEqual(Object.keys(profile.categories), [
    'RAG',
    'AI / LLM',
    'Frontend',
    'Backend',
    'Mobile',
    'Cloud / DevOps',
    'Data',
  ]);
  assert.deepEqual(profile.patterns, {
    years: { companySentence: [] },
    workMode: { remote: [], hybrid: [], onsite: [] },
  });
  assert.equal(profile.search.linkedin.maxRequests, 180);
  assert.equal(profile.search.linkedin.minIntervalSeconds, 4);
  assert.equal(profile.search.knownPagesToStop, 1);
  assert.deepEqual(profile.search.queries[0]?.indeedTerms, []);
  assert.equal(profile.filter.keepRemote, true);
});

void test('a key a query does not know blocks the profile and the path names the query by index', () => {
  const input = inventedProfile();
  Reflect.set(descend(input, 'search.queries.1'), 'sorBy', 'DD');
  const result = profileSchema.safeParse(input);
  assert.equal(result.success, false);
  assert.deepEqual(
    result.error.issues.map((issue) => [issue.path.join('.'), issue.message]),
    [['search.queries.1', 'Unrecognized key: "sorBy"']],
  );
});

/** The object at a dotted path of a plain config value, so a test can change it in place. */
function descend(root: object, path: string) {
  let node: unknown = root;
  for (const key of path.split('.').filter(Boolean)) {
    assert.ok(typeof node === 'object' && node !== null, path);
    node = Reflect.get(node, key);
  }
  assert.ok(typeof node === 'object' && node !== null, path);
  return node;
}

void test('an unknown key anywhere in the profile is refused', () => {
  for (const place of [
    '',
    'search',
    'search.linkedin',
    'sources',
    'sources.indeed',
    'filter',
    'weights',
    'weights.workMode',
  ]) {
    const input = inventedProfile();
    Reflect.set(descend(input, place), 'typo', 1);
    assert.deepEqual(paths(input), [place], place);
  }
});

void test('values out of range are refused with the path of the field', () => {
  // [path reported, object holding the field, field, bad value]
  const cases: Array<[string, string, string, unknown]> = [
    ['search.hoursOld', 'search', 'hoursOld', 0],
    ['search.maxResultsPerQuery', 'search', 'maxResultsPerQuery', -1],
    ['search.pauseSeconds', 'search', 'pauseSeconds', -1],
    ['search.sites.1', 'search', 'sites', ['indeed', 'monster']],
    ['search.linkedin.experience.0', 'search.linkedin', 'experience', [7]],
    ['search.linkedin.workTypes.0', 'search.linkedin', 'workTypes', [4]],
    ['search.linkedin.maxRequests', 'search.linkedin', 'maxRequests', 0],
    ['search.queries.0.maxResults', 'search.queries.0', 'maxResults', 0],
    ['search.queries.0.experience.0', 'search.queries.0', 'experience', [0]],
    ['filter.maxYearsExperience', 'filter', 'maxYearsExperience', 0],
    ['search.queries', 'search', 'queries', []],
  ];
  for (const [path, place, field, value] of cases) {
    const input = inventedProfile();
    Reflect.set(descend(input, place), field, value);
    assert.ok(paths(input).includes(path), `${path} in ${paths(input).join(', ')}`);
  }
});

void test('a wrong type is reported by path and type, never by the value that was written', () => {
  const input = inventedProfile();
  Reflect.set(descend(input, 'search'), 'hoursOld', 'TOP-SECRET-VALUE');
  const result = profileSchema.safeParse(input);
  assert.equal(result.success, false);
  assert.ok(!JSON.stringify(result.error.issues).includes('TOP-SECRET-VALUE'));
});

void test('sources.indeed holds the credentials and fills the country defaults', () => {
  const profile = profileSchema.parse({ ...inventedProfile(), sources: { indeed: inventedIndeed } });
  assert.deepEqual(profile.sources.indeed, {
    ...inventedIndeed,
    domain: 'it.indeed.com',
    country: 'IT',
    locale: 'it-IT',
  });
});

void test('indeed among the sites needs its credentials, and the refusal names only the path', () => {
  const input = { ...inventedProfile(), sources: {} };
  assert.deepEqual(paths(input), ['sources.indeed']);
  // nothing to require when Indeed is not searched
  const search = { ...inventedProfile().search, sites: ['linkedin'] };
  assert.equal(profileSchema.safeParse({ ...inventedProfile(), search, sources: {} }).success, true);
  const { sources: _omitted, ...withoutKey } = { ...inventedProfile(), sources: {} };
  assert.equal(profileSchema.safeParse({ ...withoutKey, search }).success, true);
});

void test('every credential is required and non-empty, and an unknown key is a typo', () => {
  for (const field of ['apiKey', 'userAgent', 'appInfo']) {
    const missing: Record<string, string> = { ...inventedIndeed };
    Reflect.deleteProperty(missing, field);
    assert.deepEqual(paths({ ...inventedProfile(), sources: { indeed: missing } }), [`sources.indeed.${field}`]);
    assert.deepEqual(paths({ ...inventedProfile(), sources: { indeed: { ...inventedIndeed, [field]: '' } } }), [
      `sources.indeed.${field}`,
    ]);
  }
  assert.deepEqual(paths({ ...inventedProfile(), sources: { indeed: { ...inventedIndeed, apiKy: 'x' } } }), [
    'sources.indeed',
  ]);
  assert.deepEqual(paths({ ...inventedProfile(), sources: { indeed: inventedIndeed, linkedin: {} } }), ['sources']);
});

void test('a credential of the wrong type is refused without echoing it', () => {
  const result = profileSchema.safeParse({
    ...inventedProfile(),
    sources: { indeed: { ...inventedIndeed, apiKey: ['TOP-SECRET-KEY'] } },
  });
  assert.equal(result.success, false);
  assert.ok(!JSON.stringify(result.error.issues).includes('TOP-SECRET-KEY'));
});

void test('the stable section is optional, has defaults, and an unknown key inside it blocks the profile', () => {
  assert.equal(profileSchema.parse(inventedProfile()).stable, undefined);
  assert.deepEqual(profileSchema.parse({ ...inventedProfile(), stable: {} }).stable, {
    category: 'Stabile',
    companies: [],
    sites: [],
    bonus: 0,
    titleWeights: {},
    extraLocations: [],
    excludePhrases: [],
    inpaSkipCategories: [],
  });
  assert.equal(profileSchema.parse({ ...inventedProfile(), stable: { bonus: 10 } }).stable?.bonus, 10);
  assert.deepEqual(paths({ ...inventedProfile(), stable: { bonus: -1 } }), ['stable.bonus']);
  assert.deepEqual(paths({ ...inventedProfile(), stable: { companys: ['Acme'] } }), ['stable']);
  assert.deepEqual(paths({ ...inventedProfile(), stable: { sites: ['nowhere'] } }), ['stable.sites.0']);
});

void test('iren is a site, its regions default to Piemonte and a malformed code blocks the profile', () => {
  const withIren = (iren: object) => ({
    ...inventedProfile(),
    search: { ...inventedProfile().search, sites: ['iren'], iren },
  });
  assert.deepEqual(profileSchema.parse(withIren({})).search.iren, { regions: ['02'] });
  assert.deepEqual(profileSchema.parse(withIren({ regions: ['01', '02'] })).search.iren.regions, ['01', '02']);
  assert.deepEqual(paths(withIren({ regions: ['Piemonte'] })), ['search.iren.regions.0']);
  assert.deepEqual(paths(withIren({ regions: [] })), ['search.iren.regions']);
  assert.deepEqual(paths(withIren({ region: ['02'] })), ['search.iren']);
});

void test('successfactors defaults are valid and a host must be a bare hostname', () => {
  const withSettings = (successfactors: object) => ({
    ...inventedProfile(),
    search: { ...inventedProfile().search, sites: ['successfactors'], successfactors },
  });
  const settings = profileSchema.parse(withSettings({})).search.successfactors;
  assert.deepEqual(
    settings.employers.map((employer) => employer.company),
    ['Intesa Sanpaolo', 'Italgas', 'Anas'],
  );
  assert.deepEqual(settings.places, ['Torino']);
  assert.equal(settings.maxPages, 10);
  assert.deepEqual(paths(withSettings({ employers: [{ host: 'https://example.org/path', company: 'Example' }] })), [
    'search.successfactors.employers.0.host',
  ]);
});

void test('oracle defaults and employer validation', () => {
  const withSettings = (oracle: object) => ({
    ...inventedProfile(),
    search: { ...inventedProfile().search, sites: ['oracle'], oracle },
    stable: { sites: ['oracle'] },
  });
  const settings = profileSchema.parse(withSettings({})).search.oracle;
  assert.deepEqual(
    settings.employers.map((row) => row.company),
    ['A2A', 'Credem', 'Poste Italiane'],
  );
  assert.equal(settings.maxPages, 10);
  assert.deepEqual(
    paths(withSettings({ employers: [{ host: 'https://example.org/path', site: 'wrong', company: 'Example' }] })),
    ['search.oracle.employers.0.host', 'search.oracle.employers.0.site'],
  );
});

void test('Avature site and employer defaults validate HTTPS URLs', () => {
  const profile = profileSchema.parse({
    ...inventedProfile(),
    search: { ...inventedProfile().search, sites: ['avature'] },
    stable: { sites: ['avature'] },
  });
  assert.equal(profile.search.avature.employers.length, 2);
  assert.equal(profile.search.avature.maxPages, 25);
  assert.equal(profile.search.avature.employers[1]?.country, 'Italy');
  assert.equal(
    profileSchema.safeParse({
      ...inventedProfile(),
      search: {
        ...inventedProfile().search,
        avature: { employers: [{ listUrl: 'http://example.org/list', company: 'Example', country: '' }] },
      },
    }).success,
    false,
  );
});

void test('M8 Manpower defaults, site and slug validation', () => {
  const profile = inventedProfile();
  const parsed = profileSchema.parse({ ...profile, search: { ...profile.search, sites: ['manpower'] } });
  assert.deepEqual(parsed.search.manpower, {
    city: 'torino',
    functions: ['ict', 'engineering', 'manutenzione-e-riparazione', 'ricerca-e-sviluppo'],
    maxPages: 5,
  });
  assert.deepEqual(
    paths({ ...profile, search: { ...profile.search, manpower: { city: 'bad/city', functions: ['ict', 'bad1'] } } }),
    ['search.manpower.city', 'search.manpower.functions.1'],
  );
});

void test('Workday defaults, site and tenant validation', () => {
  const profile = inventedProfile();
  const parsed = profileSchema.parse({ ...profile, search: { ...profile.search, sites: ['workday'] } });
  assert.equal(parsed.search.workday.employers.length, 4);
  assert.deepEqual(
    parsed.search.workday.employers.map((e) => e.company),
    ['Snam', 'Banca Sella', 'Leonardo', 'Avio Aero'],
  );
  assert.equal(parsed.search.workday.maxPages, 10);
  assert.deepEqual(
    paths({
      ...profile,
      search: {
        ...profile.search,
        workday: { employers: [{ host: 'https://bad.org', tenant: 'bad/t', site: 'bad s', company: 'X' }] },
      },
    }),
    ['search.workday.employers.0.host', 'search.workday.employers.0.tenant', 'search.workday.employers.0.site'],
  );
});

void test('Synergie defaults and region validation', () => {
  const profile = inventedProfile();
  const parsed = profileSchema.parse({ ...profile, search: { ...profile.search, sites: ['synergie'] } });
  assert.deepEqual(parsed.search.synergie, { regions: ['Piemonte'], maxPages: 10 });
  assert.deepEqual(paths({ ...profile, search: { ...profile.search, synergie: { regions: ['Piemonte/1'] } } }), [
    'search.synergie.regions.0',
  ]);
});

void test('allowed provinces default empty and accept only two uppercase letters', () => {
  assert.deepEqual(profileSchema.parse(inventedProfile()).filter.allowedProvinces, []);
  for (const code of ['to', 'T', 'TOR', 'T1', ' TO']) {
    const input = inventedProfile();
    Reflect.set(input.filter, 'allowedProvinces', [code]);
    assert.ok(paths(input).includes('filter.allowedProvinces.0'), code);
  }
  const input = inventedProfile();
  Reflect.set(input.filter, 'allowedProvinces', ['TO']);
  assert.deepEqual(profileSchema.parse(input).filter.allowedProvinces, ['TO']);
});

void test('employer hosts and avature listUrl reject internal/local/IP hostnames', () => {
  const internalHosts = [
    'router.lan', // guard-private: allow Synthetic security test value
    'fritz.box', // guard-private: allow Synthetic security test value
    'myserver.fritz.box', // guard-private: allow Synthetic security test value
    'service.local', // guard-private: allow Synthetic security test value
    'box.home', // guard-private: allow Synthetic security test value
    'nas.home.arpa', // guard-private: allow Synthetic security test value
    'api.internal', // guard-private: allow Synthetic security test value
    'host.ts.net', // guard-private: allow Synthetic security test value
    'localhost',
    'intranet',
    '127.0.0.1',
  ];
  for (const host of internalHosts) {
    assert.deepEqual(
      paths({
        ...inventedProfile(),
        search: {
          ...inventedProfile().search,
          successfactors: { employers: [{ host, company: 'Example' }] },
        },
      }),
      ['search.successfactors.employers.0.host'],
      `successfactors should reject ${host}`,
    );
    assert.deepEqual(
      paths({
        ...inventedProfile(),
        search: {
          ...inventedProfile().search,
          oracle: { employers: [{ host, site: 'CX_1', company: 'Example' }] },
        },
      }),
      ['search.oracle.employers.0.host'],
      `oracle should reject ${host}`,
    );
    assert.deepEqual(
      paths({
        ...inventedProfile(),
        search: {
          ...inventedProfile().search,
          avature: { employers: [{ listUrl: `https://${host}/jobs`, company: 'Example', country: '' }] },
        },
      }),
      ['search.avature.employers.0.listUrl'],
      `avature should reject ${host}`,
    );
    assert.deepEqual(
      paths({
        ...inventedProfile(),
        search: {
          ...inventedProfile().search,
          workday: { employers: [{ host, tenant: 'example', site: 'Main', company: 'Example' }] },
        },
      }),
      ['search.workday.employers.0.host'],
      `workday should reject ${host}`,
    );
  }
});
