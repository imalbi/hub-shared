import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyQueue, queueReducer } from './queue.ts';

const song = (id: string) => ({ id, title: id, artists: [] });

void test('refill excludes the seed and played songs; advance and skip move forward', () => {
  let state = queueReducer(emptyQueue, { type: 'play', song: song('a') });
  state = queueReducer(state, { type: 'refill', songs: [song('a'), song('b'), song('b'), song('c')] });
  assert.deepEqual(
    state.upcoming.map((item) => item.id),
    ['b', 'c'],
  );
  state = queueReducer(state, { type: 'advance', error: false });
  assert.equal(state.current?.id, 'b');
  assert.deepEqual(state.played, ['a']);
  state = queueReducer(state, { type: 'advance', error: false });
  assert.equal(state.current?.id, 'c');
});

void test('three consecutive playback errors stop the queue', () => {
  let state = queueReducer(emptyQueue, { type: 'play', song: song('a') });
  state = queueReducer(state, { type: 'refill', songs: ['b', 'c', 'd'].map(song) });
  for (let i = 0; i < 3; i++) state = queueReducer(state, { type: 'advance', error: true });
  assert.equal(state.current, null);
  assert.equal(state.errors, 3);
});

void test('loading a playlist preserves its order and lets radio follow its last song', () => {
  let state = queueReducer(emptyQueue, { type: 'load', songs: ['a', 'b', 'a'].map(song) });
  assert.equal(state.current?.id, 'a');
  assert.deepEqual(
    state.upcoming.map((item) => item.id),
    ['b', 'a'],
  );
  state = queueReducer(state, { type: 'refill', songs: [song('a'), song('c')] });
  assert.deepEqual(
    state.upcoming.map((item) => item.id),
    ['b', 'a', 'c'],
  );
  state = queueReducer(state, { type: 'advance', error: false });
  state = queueReducer(state, { type: 'advance', error: false });
  state = queueReducer(state, { type: 'advance', error: false });
  assert.equal(state.current?.id, 'c');
});

void test('a single played song seeds the radio; a playlist, the end and errors clear the seed', () => {
  let state = queueReducer(emptyQueue, { type: 'play', song: song('a') });
  assert.equal(state.seed?.id, 'a');
  state = queueReducer(state, { type: 'refill', songs: [song('b'), song('c')] });
  state = queueReducer(state, { type: 'advance', error: false });
  assert.equal(state.seed?.id, 'a');
  state = queueReducer(state, { type: 'advance', error: false });
  state = queueReducer(state, { type: 'advance', error: false });
  assert.equal(state.current, null);
  assert.equal(state.seed, null);
  assert.equal(queueReducer(emptyQueue, { type: 'load', songs: ['a', 'b'].map(song) }).seed, null);
});

void test('stop clears the radio history so another radio starts fresh', () => {
  let state = queueReducer(emptyQueue, { type: 'play', song: song('a') });
  state = queueReducer(state, { type: 'refill', songs: ['b', 'c'].map(song) });
  state = queueReducer(state, { type: 'stop' });
  assert.equal(state.current, null);
  assert.equal(state.seed, null);
  assert.deepEqual(state.upcoming, []);
  assert.deepEqual(state.played, []);
});

void test('radio history stays bounded and new playback resets it', () => {
  let state = queueReducer(emptyQueue, { type: 'play', song: song('0') });
  for (let i = 1; i <= 300; i++) {
    state = queueReducer(state, { type: 'refill', songs: [song(String(i))] });
    state = queueReducer(state, { type: 'advance', error: false });
  }
  assert.equal(state.played.length, 200);
  assert.equal(state.played[0], '100');
  assert.deepEqual(queueReducer(state, { type: 'play', song: song('new') }).played, []);
  assert.deepEqual(queueReducer(state, { type: 'load', songs: [song('new')] }).played, []);
});
