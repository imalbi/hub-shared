import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { detail, employerJobs, employerSite, posting } from './fake-workday.ts';
import { detailUrl, listUrl, publicUrl, readDetail, readPage } from './workday.ts';

void test('W1 Workday URLs and readPage handle myworkdaysite vs myworkdayjobs and missing fields', () => {
  assert.equal(listUrl(employerSite), 'https://wd103.example.org/wday/cxs/example/Carriere/jobs');
  assert.equal(
    detailUrl(employerSite, '/job/Torino/Role_1'),
    'https://wd103.example.org/wday/cxs/example/Carriere/job/Torino/Role_1',
  );
  assert.equal(
    publicUrl({ ...employerSite, host: 'wd103.myworkdaysite.com' }, '/job/Torino/Role_1'),
    'https://wd103.myworkdaysite.com/recruiting/example/Carriere/job/Torino/Role_1',
  );
  assert.equal(
    publicUrl({ ...employerJobs, host: 'acme.wd3.myworkdayjobs.com' }, '/job/Torino/Role_1'),
    'https://acme.wd3.myworkdayjobs.com/MainSite/job/Torino/Role_1',
  );

  const page = readPage(
    {
      total: 3,
      jobPostings: [
        posting('JR1'),
        posting('NO_LOC', {
          externalPath: '/job/Multi/Evergreen-Role',
          locationsText: null,
          bulletFields: ['EVERGREEN_JOB_REQUISITION'],
        }),
        posting('NO_JR', {
          externalPath: '/job/Torino/No-Id-Role',
          locationsText: '2 Locations',
          bulletFields: [],
        }),
      ],
    },
    employerJobs,
  );
  assert.equal(page.total, 3);
  assert.equal(page.rows.length, 3);
  assert.equal(page.rows[1]?.card.location, '');
  assert.equal(page.rows[2]?.externalPath, '/job/Torino/No-Id-Role');
});

void test('W1 readDetail merges additionalLocations, keeps block separators and parses startDate', () => {
  const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;
  const parsed = readDetail(
    detail({
      text: 'Diploma tecnico</p><p>Tempo indeterminato',
      location: 'Torino',
      additionalLocations: ['Torino', 'Rivalta di Torino'],
      startDate: '2026-11-15',
      timeType: 'Full time',
    }),
    cleaner,
    '2 Locations',
  );
  assert.equal(parsed.location, 'Torino, Rivalta di Torino');
  assert.match(parsed.description ?? '', /^Orario: Full time\nDiploma tecnico\nTempo indeterminato/u);
  assert.doesNotMatch(parsed.description ?? '', /hidden/u);
  assert.equal(parsed.postedAt?.toISOString().slice(0, 10), '2026-11-15');
});
