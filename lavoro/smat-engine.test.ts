import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listing } from './fake-smat.ts';
import { context, input } from './list-source-test.ts';
import { createSmatSource } from './smat.ts';
void test('SMAT closed archive is complete with zero cards and never fetches PDFs or login', async () => {
  let calls = 0;
  const result = await createSmatSource().search(
    input,
    context(async () => {
      calls++;
      return new Response(listing(true));
    }),
  );
  assert.equal(calls, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(result.cards, []);
});
