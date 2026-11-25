import { expect, test, type Page, type APIRequestContext } from '../../../apps/e2e/tests/fixtures.ts';
const RESTARTED = { timeout: 30_000 };
type ModuleState = { name: string; status: string };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The `result.data` of a tRPC answer, checked as far as these specs read it. */
function data(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.result)) throw new Error('not a tRPC result');
  return body.result.data;
}

async function moduleStates(pc: APIRequestContext) {
  const res = await pc.get('/trpc/settings.modules');
  const list = data(await res.json());
  if (!Array.isArray(list)) throw new Error('settings.modules is not a list');
  return list.flatMap((entry): ModuleState[] =>
    isRecord(entry) && typeof entry.name === 'string' && typeof entry.status === 'string'
      ? [{ name: entry.name, status: entry.status }]
      : [],
  );
}

/** Flip a module's switch on its page and save; resolves once Hub answered again, without a reload. */
async function saveSwitch(page: Page, name: string) {
  await page.goto(`/desk/settings/${name}`);
  const toggle = page.getByRole('switch', { name: 'Modulo attivo' });
  await expect(toggle).toBeVisible();
  // A marker that a reload would wipe: the page must come back by itself.
  await page.evaluate(() => Object.assign(window, { restartMarker: 1 }));
  await toggle.click();
  await page.getByRole('button', { name: 'Salva e riavvia' }).click();
  await expect(page.getByText('Riavvio in corso')).toBeVisible();
  await expect(page.getByText('Impostazioni salvate, Hub è di nuovo attivo')).toBeVisible(RESTARTED);
  expect(await page.evaluate(() => 'restartMarker' in window)).toBe(true);
}

/** Puts a module back on through the API and waits for the restart to finish, for a test that died halfway. */
async function ensureOn(pc: APIRequestContext, name: string) {
  const states = await moduleStates(pc);
  if (states.find((entry) => entry.name === name)?.status !== 'off') return;
  await pc.post('/trpc/settings.save', { data: { module: name, enabled: true } });
  await expect
    .poll(async () => (await moduleStates(pc).catch(() => [])).find((entry) => entry.name === name)?.status, RESTARTED)
    .toBe('on');
}

test('with Musica off, Media keeps the player and the audio button but has no music search or volume', async ({
  page,
  pc,
}) => {
  try {
    await saveSwitch(page, 'music');
    await page.goto('/desk/media');
    await expect(page.getByRole('region', { name: 'Player musicale' })).toBeVisible(RESTARTED);
    await expect(page.getByRole('button', { name: 'Audio: Cuffie', exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Cerca musica' })).toHaveCount(0);
  } finally {
    await ensureOn(pc, 'music');
  }
});
