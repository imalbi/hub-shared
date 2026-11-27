import { agencyEngineTests } from './agency-engine-test.ts';
import { createGigroupSource } from './gigroup.ts';
import { listing, detail } from './fake-gigroup.ts';

agencyEngineTests({
  site: 'gigroup',
  source: createGigroupSource,
  settings: { cities: ['exampleville'], functions: ['ict'], maxPages: 3 },
  listing,
  detail,
  isDetail: (url) => url.includes('/offerte-lavoro-dettaglio/'),
});
