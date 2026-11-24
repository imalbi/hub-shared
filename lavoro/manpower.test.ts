import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { listing } from './fake-manpower.ts';
import { readPage } from './manpower.ts';

void test('M1 card fields come from their classes', () => {
  const result = readPage(parseHTML(listing([{ id: 123, salary: '€ 25000 Annuale' }])).document, 1);
  assert.deepEqual(result.items, [
    {
      id: '123',
      title: 'Addetto esempio 123',
      location: 'Torino, Piemonte, TO',
      contract: 'Somministrazione',
      salary: '€ 25000 Annuale',
      postedAt: new Date(2026, 10, 1),
      url: 'https://www.manpower.it/it/annuncio-lavoro/ict/example/ruolo/123',
    },
  ]);
});
