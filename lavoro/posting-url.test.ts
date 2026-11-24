import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postingUrl } from './posting-url.ts';

void test('a LinkedIn posting link becomes the URL the collector stores, whatever the host, slug, slash or query', () => {
  for (const link of [
    'https://www.linkedin.com/jobs/view/4242/',
    'https://www.linkedin.com/jobs/view/4242',
    'https://it.linkedin.com/jobs/view/full-stack-engineer-at-invented-corp-4242?trk=public',
    'https://www.linkedin.com/jobs/search/?currentJobId=4242&keywords=react',
  ])
    assert.equal(postingUrl(link), 'https://www.linkedin.com/jobs/view/4242');
});

void test('any other link is only trimmed', () => {
  assert.equal(postingUrl(' https://example.com/jobs/1/ '), 'https://example.com/jobs/1/');
  assert.equal(postingUrl('https://www.linkedin.com/company/invented'), 'https://www.linkedin.com/company/invented');
  assert.equal(postingUrl('not a url'), 'not a url');
});
