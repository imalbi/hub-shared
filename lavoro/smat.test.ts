import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { listing, settings } from './fake-smat.ts';
import { readSmat } from './smat.ts';
void test('SMAT keeps open multi-profile notices incomplete and ignores closed notices and application login', () => {
  const read = (html: string) => readSmat(parseHTML(html).document, settings.baseUrl, settings.company);
  const [card] = read(listing());
  assert.equal(card?.url, 'https://water.example.org/notice.pdf');
  assert.equal(card?.location, 'Exampleville');
  assert.equal(card?.company, settings.company);
  assert.equal(card?.detailsMissing, true);
  assert.match(card?.description ?? '', /Profilo elettrico su diploma/u);
  assert.match(card?.description ?? '', /Profilo ingegnere su laurea/u);
  assert.deepEqual(read(listing(true)), []);
  assert.throws(
    () => read('<div class="page-text"><table><tbody><tr><td>Unrelated content</td></tr></tbody></table></div>'),
    /layout changed/u,
  );
});
