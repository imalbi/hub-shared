/** Invented credentials: the real ones live only in the local config. */
export const inventedIndeed = {
  apiKey: 'invented-key',
  userAgent: 'Invented/1.0 (Test)',
  appInfo: 'appv=1.0; os=test',
};

// An invented profile with every key of the real draft's shape and none of its values: shared by the tests.
export function inventedProfile() {
  return {
    search: {
      sites: ['indeed', 'reteinformaticalavoro', 'linkedin'],
      location: 'Examplia',
      hoursOld: 72,
      maxResultsPerQuery: 50,
      knownPagesToStop: 2,
      knownDays: 5,
      workersPerSite: 2,
      pauseSeconds: 3,
      workersBySite: { linkedin: 1, indeed: 2, reteinformaticalavoro: 1 },
      linkedin: {
        geoId: '100000001',
        sortBy: 'DD',
        experience: [2, 3],
        workTypes: [],
        minIntervalSeconds: 5,
        maxRequests: 90,
        backoffSeconds: 20,
        maxBackoffSeconds: 100,
        maxAttempts: 2,
        maxConsecutive429: 2,
        retryBudgetSeconds: 200,
      },
      queries: [
        { name: 'Web', keywords: '"web developer" OR frontend', indeedTerms: ['web developer', 'frontend developer'] },
        { name: 'Data', keywords: '"data analyst"', indeedTerms: ['data analyst'], sortBy: 'R', maxResults: 20 },
      ],
    },
    sources: { indeed: { ...inventedIndeed } },
    filter: {
      minScore: 5,
      minTitleScore: 2,
      maxYearsExperience: 3,
      allowedLocations: ['exampleville', 'examplia north'],
      keepRemote: true,
      keepGenericItaly: true,
      blockedCompanies: ['Blocked Co'],
    },
    weights: {
      title: { developer: 2, frontend: 3, rag: 5, senior: -4, contabile: -8 },
      description: { typescript: 2, docker: 1, trasferte: -1 },
      location: { exampleville: 3, examplia: 1 },
      workMode: { remote: 2, hybrid: 1, onsite: 0 },
    },
  };
}

/** Explicit source scopes for fixture collectors, never production defaults. */
export const inventedSourceSettings = {
  inpa: { regionId: 1 },
  iren: { regions: ['02'] },
  successfactors: { employers: [{ host: 'careers.example.org', company: 'Example' }], places: ['Exampleville'] },
  oracle: { employers: [{ host: 'oracle.example.org', site: 'CX_1', company: 'Example' }] },
  avature: { employers: [{ listUrl: 'https://avature.example.org/jobs', company: 'Example', country: '' }] },
  manpower: { city: 'exampleville', functions: ['ict'] },
  workday: { employers: [{ host: 'workday.example.org', tenant: 'example', site: 'Main', company: 'Example' }] },
  synergie: { regions: ['Example Region'] },
};
