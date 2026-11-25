import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeSuggestions, matchArtist, normalizeArtistName } from './suggestions.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

void test('M1: Riascolta picks never-played favorites first, then oldest past 14 days, capped at 6', () => {
  const favorites = [
    { id: 'AAAAAAAAAAA', title: 'Song A', artist: 'Artist A', addedAt: NOW - 30 * DAY_MS },
    { id: 'BBBBBBBBBBB', title: 'Song B', artist: 'Artist B', addedAt: NOW - 25 * DAY_MS },
    { id: 'CCCCCCCCCCC', title: 'Song C', artist: 'Artist C', addedAt: NOW - 10 * DAY_MS },
  ];
  const history = [
    {
      id: 'AAAAAAAAAAA',
      title: 'Song A',
      artist: 'Artist A',
      cover: 'https://i.ytimg.com/cover-a',
      playedAt: NOW - 20 * DAY_MS,
    },
    {
      id: 'BBBBBBBBBBB',
      title: 'Song B',
      artist: 'Artist B',
      cover: 'https://i.ytimg.com/cover-b',
      playedAt: NOW - 1 * DAY_MS,
    },
  ];
  const { again } = computeSuggestions(favorites, history, NOW);
  assert.deepEqual(
    again.map((song) => song.id),
    ['CCCCCCCCCCC', 'AAAAAAAAAAA'],
  );
  assert.equal(
    again.some((song) => song.id === 'BBBBBBBBBBB'),
    false,
  );
  assert.equal(again[0]?.cover, null);
  assert.equal(again[1]?.cover, 'https://i.ytimg.com/cover-a');

  const eight = Array.from({ length: 8 }, (_, index) => ({
    id: `FAV0000000${index}`,
    title: `Fav ${index}`,
    artist: 'Artist',
    addedAt: NOW - (100 - index) * DAY_MS,
  }));
  const olderHistory = [
    { id: 'FAV00000000', title: 'Fav 0', artist: 'Artist', cover: null, playedAt: NOW - 16 * DAY_MS },
    { id: 'FAV00000001', title: 'Fav 1', artist: 'Artist', cover: null, playedAt: NOW - 25 * DAY_MS },
    { id: 'FAV00000002', title: 'Fav 2', artist: 'Artist', cover: null, playedAt: NOW - 19 * DAY_MS },
  ];
  assert.deepEqual(
    computeSuggestions(eight, olderHistory, NOW).again.map((song) => song.id),
    ['FAV00000003', 'FAV00000004', 'FAV00000005', 'FAV00000006', 'FAV00000007', 'FAV00000001'],
  );
});

void test('empty history yields empty suggestions even when favorites exist', () => {
  const result = computeSuggestions(
    [{ id: 'AAAAAAAAAAA', title: 'Song A', artist: 'Artist A', addedAt: NOW }],
    [],
    NOW,
  );
  assert.deepEqual(result, { again: [], radios: [], topArtist: null });
});

void test('M2: Radio da ranks top 3 artists of the last 30 days and uses each artist top song as seed', () => {
  const play = (id: string, title: string, artist: string, daysAgo: number, hoursAgo = 0) => ({
    id,
    title,
    artist,
    cover: null,
    playedAt: NOW - daysAgo * DAY_MS - hoursAgo * 60 * 60 * 1000,
  });
  const history = [
    ...Array.from({ length: 3 }, (_, i) => play('X1000000001', 'X Song 1', 'X', 2 + i)),
    ...Array.from({ length: 2 }, (_, i) => play('X2000000002', 'X Song 2', 'X', 5 + i)),
    ...Array.from({ length: 2 }, (_, i) => play('Y1000000001', 'Y Song 1', 'Y', 1, i + 1)),
    play('Y2000000002', 'Y Song 2', 'Y', 10),
    ...Array.from({ length: 2 }, (_, i) => play('Z1000000001', 'Z Song 1', 'Z', 3 + i)),
    play('Z2000000002', 'Z Song 2', 'Z', 12),
    play('W1000000001', 'W Song 1', 'W', 4),
    ...Array.from({ length: 10 }, (_, i) => play('V1000000001', 'V Song 1', 'V', 40 + i)),
    ...Array.from({ length: 8 }, (_, i) => play('BL000000001', 'Blank Artist', '   ', 1 + i)),
  ];
  const result = computeSuggestions([], history, NOW);
  assert.deepEqual(
    result.radios.map((radio) => radio.artist),
    ['X', 'Y', 'Z'],
  );
  assert.deepEqual(
    result.radios.map((radio) => radio.seed.id),
    ['X1000000001', 'Y1000000001', 'Z1000000001'],
  );
  assert.equal(result.topArtist, 'X');
  assert.equal(
    result.radios.some((radio) => radio.artist === 'W' || radio.artist === 'V'),
    false,
  );
});

void test('M3: tie counts for artists and songs break by most recent play regardless of row order', () => {
  const chronological = [
    { id: 'OLD00000001', title: 'Old Hit', artist: 'Earlier Artist', cover: null, playedAt: NOW - 10 * DAY_MS },
    { id: 'OLD00000001', title: 'Old Hit', artist: 'Earlier Artist', cover: null, playedAt: NOW - 9 * DAY_MS },
    { id: 'NEW00000001', title: 'Song One', artist: 'Newer Artist', cover: null, playedAt: NOW - 8 * DAY_MS },
    { id: 'NEW00000002', title: 'Song Two', artist: 'Newer Artist', cover: null, playedAt: NOW - 2 * DAY_MS },
  ];
  for (const rows of [chronological, chronological.toReversed()]) {
    const result = computeSuggestions([], rows, NOW);
    assert.deepEqual(
      result.radios.map((radio) => radio.artist),
      ['Newer Artist', 'Earlier Artist'],
    );
    assert.equal(result.radios[0]?.seed.id, 'NEW00000002');
  }
});

void test('normalizeArtistName and matchArtist ignore case, accents and extra whitespace', () => {
  assert.equal(normalizeArtistName('  Café   Tacvba '), 'cafe tacvba');
  const candidates = [
    { id: 'UC0000000000000000000001', name: 'Artista Live' },
    { id: 'UC0000000000000000000002', name: 'Café' },
    { id: 'UC0000000000000000000003', name: 'Niccolò Fabi' },
  ];
  assert.equal(matchArtist(candidates, 'cafe')?.id, 'UC0000000000000000000002');
  assert.equal(matchArtist(candidates, '  niccolo   fabi ')?.id, 'UC0000000000000000000003');
  assert.equal(matchArtist(candidates, 'Artista'), undefined);
  assert.equal(matchArtist(candidates, '   '), undefined);
});
