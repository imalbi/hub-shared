import { agencyEngineTests } from './agency-engine-test.ts';
import { createRandstadSource } from './randstad.ts';
import { listing, detail } from './fake-randstad.ts';

agencyEngineTests({
  site: 'randstad',
  source: createRandstadSource,
  settings: { regions: ['examplia'], cities: ['exampleville'], functions: ['ict'], maxPages: 3 },
  listing,
  detail,
  isDetail: (url) => url.includes('/esempio_'),
});
