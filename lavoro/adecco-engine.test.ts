import { agencyEngineTests } from './agency-engine-test.ts';
import { createAdeccoSource } from './adecco.ts';
import { listing, detail } from './fake-adecco.ts';

agencyEngineTests({
  site: 'adecco',
  source: createAdeccoSource,
  settings: { cities: ['exampleville'], functions: ['ict'], maxPages: 3 },
  listing,
  detail,
  isDetail: (url) => url.includes('/job-description-details/'),
});
