import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { RUN_TMP } from '../../../apps/e2e/tests/hosts.ts';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';

for (const [status, label] of [
  ['account', 'Account di posta non raggiungibile'],
  ['missing', 'Mail non più presente nella casella'],
  ['timeout', 'La posta non ha risposto in tempo'],
] as const) {
  test(`the detail explains a ${status} thread failure`, async ({ page, pc }) => {
    const link = { key: 'fake-interview-key', account: 'work', messageId: 'missing@example.org' };
    await pc.post('/trpc/lavoro.links.add', { data: link });
    try {
      await page.route('**/trpc/mail.threads*', (route) =>
        route.fulfill({
          json: [{ result: { data: { threads: [{ ...link, status, thread: null }], truncated: false, after: '' } } }],
        }),
      );
      await page.goto('/desk/ricerca?tab=candidature&candidature=all');
      await page.getByRole('heading', { name: 'Principal Engineer' }).click();
      await expect(page.getByRole('dialog').getByText(label)).toBeVisible();
    } finally {
      await pc.post('/trpc/lavoro.links.remove', { data: { ...link, confirmed: true } });
    }
  });
}

test('an archived linked message opens from its new folder', async ({ page, pc }) => {
  const link = { key: 'fake-interview-key', account: 'work', messageId: 'offer@example.org' };
  await pc.post('/trpc/lavoro.links.add', { data: link });
  await pc.post('/trpc/mail.archive', { data: { account: 'work', id: '310', confirmed: true } });
  try {
    await page.goto('/desk/ricerca?tab=candidature&candidature=all');
    await page.getByRole('heading', { name: 'Principal Engineer' }).click();
    const detail = page.getByRole('dialog');
    await detail.getByRole('button', { name: 'Leggi: Offerta di colloquio' }).click();
    await expect(detail.getByText('Buongiorno, vorremmo proporle un colloquio.', { exact: false })).toBeVisible();
  } finally {
    await pc.post('/trpc/lavoro.links.remove', { data: { ...link, confirmed: true } });
    await pc.post('/trpc/mail.unarchive', {
      data: { account: 'work', messageId: link.messageId, subject: 'Offerta di colloquio' },
    });
  }
});

test('application addresses can be added and removed', async ({ page }) => {
  await page.goto('/desk/ricerca?tab=candidature&candidature=all');
  await page.getByRole('heading', { name: 'Principal Engineer' }).click();
  const detail = page.getByRole('dialog');
  await detail.getByRole('textbox', { name: 'Aggiungi indirizzo' }).fill('info@pedala.example'); // guard-private: allow Synthetic fixture address
  await detail.getByRole('button', { name: 'Aggiungi indirizzo' }).click();
  await expect(detail.getByText('info@pedala.example')).toBeVisible(); // guard-private: allow Synthetic fixture address
  await detail.getByRole('button', { name: 'Rimuovi indirizzo info@pedala.example' }).click(); // guard-private: allow Synthetic fixture address
  await expect(detail.getByText('info@pedala.example')).toHaveCount(0); // guard-private: allow Synthetic fixture address
});

test('a manually added address links the next received mail', async ({ page, pc }) => {
  const key = 'fake-interview-key';
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'lavoro.db'));
  db.exec(
    "CREATE TEMP TABLE saved_checked AS SELECT * FROM mail_checked WHERE account = 'work' AND message_id = 'offer@example.org'",
  );
  db.exec(
    "CREATE TEMP TABLE saved_proposals AS SELECT * FROM mail_proposals WHERE account = 'work' AND message_id = 'offer@example.org'",
  );
  db.exec("DELETE FROM mail_checked WHERE account = 'work' AND message_id = 'offer@example.org'");
  db.exec("DELETE FROM mail_proposals WHERE account = 'work' AND message_id = 'offer@example.org'");
  try {
    await page.goto('/desk/ricerca?tab=candidature&candidature=all');
    await page.getByRole('heading', { name: 'Principal Engineer' }).click();
    const detail = page.getByRole('dialog');
    await detail.getByRole('textbox', { name: 'Aggiungi indirizzo' }).fill('recruiter@example.org');
    await detail.getByRole('button', { name: 'Aggiungi indirizzo' }).click();
    await expect(detail.getByText('recruiter@example.org')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Controlla posta' }).click();
    await expect
      .poll(async () => {
        const input = encodeURIComponent(JSON.stringify({ key }));
        const data = await (await pc.get(`/trpc/lavoro.links.list?input=${input}`)).json();
        return data.result.data.some((row: { messageId: string }) => row.messageId === 'offer@example.org');
      })
      .toBe(true);
    await page.getByRole('heading', { name: 'Principal Engineer' }).click();
    await expect(page.getByRole('dialog').getByText('Offerta di colloquio', { exact: true })).toBeVisible();
  } finally {
    await pc.post('/trpc/lavoro.links.remove', {
      data: { key, account: 'work', messageId: 'offer@example.org', confirmed: true },
    });
    await pc.post('/trpc/lavoro.addresses.remove', { data: { key, address: 'recruiter@example.org' } });
    db.exec("DELETE FROM mail_checked WHERE account = 'work' AND message_id = 'offer@example.org'");
    db.exec('INSERT INTO mail_checked SELECT * FROM saved_checked');
    db.exec("DELETE FROM mail_proposals WHERE account = 'work' AND message_id = 'offer@example.org'");
    db.exec('INSERT INTO mail_proposals SELECT * FROM saved_proposals');
    db.close();
  }
});
