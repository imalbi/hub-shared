import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createFocusHistory } from '../../apps/server/src/core/focus-history.ts';
import { createCapabilityRegistry, type NewMailEvent } from '../../apps/server/src/core/module.ts';
import { openDatabase, openDb } from '../../apps/server/src/db/index.ts';
import { createFakeDesktop } from '../../apps/server/src/testing/fake-desktop.ts';
import { silentLog, testProfile } from './harness.ts';
import { createLavoroModule } from './server.ts';

function setup(t: TestContext, auto = true) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const db = openDatabase(':memory:', fileURLToPath(new URL('./drizzle', import.meta.url)));
  const coreDb = openDb(':memory:');
  const capabilities = createCapabilityRegistry();
  const listeners = new Set<(event: NewMailEvent) => void>();
  const checks: string[] = [];
  let active = 0;
  let maxActive = 0;
  let hold: Promise<void> | undefined;
  capabilities.register('mail', {
    accounts: () => [{ account: 'work', label: 'Work' }],
    onNewMail(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async listThreadEntries(account) {
      checks.push(account);
      maxActive = Math.max(maxActive, ++active);
      await hold;
      active--;
      return { entries: [], truncated: false };
    },
    readMessageText: () => Promise.resolve(null),
    threadOf: () => null,
  });
  const profile = testProfile();
  profile.mailCheck = { ...profile.mailCheck, auto, accounts: ['work'] };
  const instance = createLavoroModule({ mailEventDebounceMs: 50 }).create({
    config: profile,
    db,
    capabilities,
    run: createFakeDesktop(),
    fetch: () => {
      throw new Error('No network expected');
    },
    log: silentLog,
    zones: new Set(),
    focusHistory: createFocusHistory(coreDb),
  });
  t.after(async () => {
    await instance.close?.();
    db.$client.close();
    coreDb.$client.close();
  });
  const emit = (account = 'work') => {
    for (const listener of listeners) listener({ account, messageIds: ['new'] });
  };
  async function tick(ms: number) {
    t.mock.timers.tick(ms);
    await flush();
  }
  return {
    checks,
    listeners,
    emit,
    tick,
    close: instance.close,
    maxActive: () => maxActive,
    hold: (pending: Promise<void> | undefined) => {
      hold = pending;
    },
  };
}

void test('configured account bursts trigger one trailing debounced check; other accounts do nothing', async (t) => {
  const s = setup(t);
  s.emit('other');
  await s.tick(50);
  assert.deepEqual(s.checks, []);
  s.emit();
  await s.tick(30);
  s.emit();
  await s.tick(30);
  s.emit();
  await s.tick(49);
  assert.deepEqual(s.checks, []);
  await s.tick(1);
  assert.deepEqual(s.checks, ['work']);
});

void test('events during a running check schedule exactly one follow-up without concurrency', async (t) => {
  const s = setup(t);
  let release = () => {};
  s.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  s.emit();
  await s.tick(50);
  assert.equal(s.checks.length, 1);
  s.emit();
  s.emit();
  s.emit();
  await s.tick(50);
  assert.equal(s.checks.length, 1);
  s.hold(undefined);
  release();
  await flush();
  await s.tick(50);
  assert.equal(s.checks.length, 2);
  assert.equal(s.maxActive(), 1);
  await s.tick(100);
  assert.equal(s.checks.length, 2);
});

void test('close unsubscribes, clears debounce and fallback timers, and suppresses pending rechecks', async (t) => {
  const s = setup(t);
  let release = () => {};
  s.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  s.emit();
  await s.tick(50);
  s.emit();
  await s.tick(50);
  s.emit();
  const closing = s.close?.();
  release();
  await closing;
  assert.equal(s.listeners.size, 0);
  s.emit();
  await s.tick(1_800_000);
  assert.equal(s.checks.length, 1);
});

void test('automatic mail checks retain the startup and 30-minute fallback timers', async (t) => {
  const s = setup(t);
  await s.tick(29_999);
  assert.equal(s.checks.length, 0);
  await s.tick(1);
  assert.equal(s.checks.length, 1);
  await s.tick(1_770_000);
  assert.equal(s.checks.length, 2);
});

void test('automatic checks disabled means no event subscription or fallback timer', async (t) => {
  const s = setup(t, false);
  assert.equal(s.listeners.size, 0);
  s.emit();
  await s.tick(1_800_000);
  assert.deepEqual(s.checks, []);
});
