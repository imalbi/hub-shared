import { agencyEngineTests } from './agency-engine-test.ts';
import { createUmanaSource } from './umana.ts';
import { listing, detail } from './fake-umana.ts';

agencyEngineTests({
  site: 'umana',
  source: createUmanaSource,
  settings: { regions: ['examplia'], provinces: ['ex'], functions: ['ict'], maxPages: 3 },
  listing,
  detail,
  isDetail: (url) => url.includes('/esempio/'),
});
