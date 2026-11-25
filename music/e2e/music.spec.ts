import { chooseTheme } from '../../../apps/e2e/tests/themes.ts';
import type { Page } from '../../../apps/e2e/tests/fixtures.ts';
import { contrastRatio } from '../../../apps/e2e/tests/contrast.ts';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
import { answerQueries, restoreDesktop } from '../../../apps/e2e/tests/desktop.ts';
import { SERVER_URL } from '../../../apps/e2e/tests/hosts.ts';
import { ballOf, underBall } from '../../../apps/e2e/tests/ball.ts';

test.afterEach(async ({ pc }) => {
  await restoreDesktop(pc);
  await pc.post('/trpc/music.setVolume', { data: { volume: 100 }, headers: { 'content-type': 'application/json' } });
});

const search = (page: Page, text = 'canzone') => page.getByRole('searchbox', { name: 'Cerca musica' }).fill(text);
// The player has the same "Aggiungi <title> a playlist" button for the song that plays; a radio left by an earlier test
// can be playing Mix 1, and the search is debounced, so an unscoped click hit the player's and its popover went away
// when the radio moved on.
const results = (page: Page) => page.getByRole('region', { name: 'Risultati' });
const library = (page: Page) => page.getByRole('region', { name: 'Playlist', exact: true });
/** A playlist row's name also says its song count ("Mix 2 brani"). */
const listRow = (page: Page, name: string) =>
  library(page).getByRole('button', { name: new RegExp(`^${name} \\d+ bran[io]$`) });
const played = (page: Page) =>
  page.waitForResponse((response) => response.url().includes('music.play') && response.request().method() === 'POST');

test('empty music search results show their title', async ({ page }) => {
  await answerQueries(page, { 'music.search': [], 'music.searchPlaylists': [] });
  await page.goto('/desk/media');
  await search(page, 'nessuna corrispondenza');
  await expect(results(page).getByRole('heading', { name: 'Nessun risultato' })).toBeVisible();
  await page.getByRole('button', { name: 'Playlist pubbliche' }).click();
  await expect(results(page).getByRole('heading', { name: 'Nessun risultato' })).toBeVisible();
});

test('empty favorites and playlists show their titles', async ({ page }) => {
  await answerQueries(page, { 'music.favorites': [], 'music.playlists': [] });
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/media');
  await expect(library(page).getByRole('heading', { name: 'Nessuna playlist' })).toBeVisible();
  await expect(library(page).locator('[data-empty-variant="compact"]')).toBeVisible();
  await page.getByRole('button', { name: 'Preferiti', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nessun preferito' })).toBeVisible();
  await expect(page.locator('[data-empty-scene="music"]')).toBeVisible();
  await search(page);
  await results(page).getByRole('button', { name: 'Aggiungi Brano 1 a playlist' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Nessuna playlist' })).toBeVisible();
  await expect(page.getByRole('dialog').locator('[data-empty-variant="compact"]')).toBeVisible();
});

async function holdDelete(page: Page) {
  await page.getByRole('button', { name: 'Tieni premuto per eliminare playlist' }).focus();
  await page.keyboard.down('Space');
  await page.waitForTimeout(900);
  await page.keyboard.up('Space');
}

test('artist opens from a row, plays a top song and returns to its source', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/media');
  await search(page);
  await page.getByRole('button', { name: 'Artista', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Artista', exact: true })).toBeVisible();
  await expect(page.getByText('Disco esempio', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Artista' }).locator('img')).toHaveCount(2);
  const done = played(page);
  await page.getByRole('button', { name: 'Riproduci Brano artista' }).click();
  await done;
  await page.getByRole('button', { name: 'Torna indietro' }).click();
  await expect(page.getByRole('button', { name: 'Riproduci Brano 1', exact: true })).toBeVisible();
});

test('artist content keeps its position while loading', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/trpc/*music.artist*', async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto('/desk/media');
  await search(page);
  await page.getByRole('button', { name: 'Artista', exact: true }).first().click();
  const skeleton = page.getByRole('status', { name: 'Caricamento artista' });
  await expect(skeleton).toBeVisible();
  const before = await skeleton.boundingBox();
  release();
  const songs = page.getByRole('heading', { name: 'Brani più ascoltati' });
  await expect(songs).toBeVisible();
  const after = await songs.locator('../..').boundingBox();
  if (!before || !after) throw new Error('Artist content must be laid out');
  expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(8);
});

test('artist opened from radio returns to radio, and from the player', async ({ page }) => {
  await page.goto('/desk/media');
  await search(page);
  await page.getByRole('button', { name: 'Riproduci Brano 1', exact: true }).click();
  await page.getByRole('button', { name: 'Ascolta', exact: true }).click();
  await page
    .getByRole('region', { name: 'Prossimi' })
    .getByRole('button', { name: 'Artista', exact: true })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Artista', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Torna indietro' }).click();
  await expect(page.getByRole('region', { name: 'Prossimi' })).toBeVisible();
});

test('search, play, skip in the queue and a fixed search while results scroll', async ({ page }) => {
  // 4K, the desk's real size: the lists must really scroll here, or the check on the search box proves nothing.
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/media');
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Player musicale' })).toBeVisible();
  await search(page);
  await expect(page.getByRole('button', { name: 'Riproduci Brano 1', exact: true })).toBeVisible();
  const request = page.waitForRequest((r) => r.url().includes('music.play') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Riproduci Brano 1', exact: true }).click();
  expect((await request).postData()).toContain('00000000000');
  // Prossimi (the radio's suggestions) is the Ascolta view, never above the results.
  await expect(page.getByRole('region', { name: 'Prossimi' })).toHaveCount(0);
  const box = page.getByRole('searchbox', { name: 'Cerca musica' });
  const top = (await box.boundingBox())?.y;
  const list = page.getByRole('button', { name: 'Riproduci Brano 1', exact: true }).locator('xpath=ancestor::ul[1]');
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.getByRole('button', { name: 'Riproduci Brano 30' }).scrollIntoViewIfNeeded();
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect((await box.boundingBox())?.y).toBe(top);
  await page.getByRole('button', { name: 'Ascolta', exact: true }).click();
  await expect(box).toHaveValue('');
  const upcoming = page.getByRole('region', { name: 'Prossimi' });
  await expect(upcoming.getByText('Brano 2', { exact: true })).toBeVisible();
  // Each queue row shows its duration, as the search results do.
  await expect(upcoming.getByRole('listitem').first()).toContainText('2:03');
  await upcoming.getByRole('button', { name: 'Salta' }).click();
  await expect(upcoming.getByText('Brano 2', { exact: true })).toHaveCount(0);
  await expect(upcoming.getByText('Brano 3', { exact: true })).toBeVisible();
});

for (const size of [
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
]) {
  test(`the page fits ${size.width}x${size.height}: no page scroll, player and Ctrl K in view, lists scroll inside`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/desk/media');
    await search(page);
    await expect(page.getByRole('button', { name: 'Riproduci Brano 30' })).toHaveCount(1);
    const player = page.getByRole('region', { name: 'Player musicale' });
    await expect(player).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('navigation', { name: 'Zone' }).getByText('Ctrl K', { exact: true })).toBeInViewport();
    const fit = await page.evaluate(() => {
      const surface = document.querySelector('[data-page-surface]');
      const bar = document.querySelector('section[aria-label="Player musicale"]');
      const results = document.querySelector('section[aria-label="Risultati"] ul');
      return {
        page: document.documentElement.scrollHeight <= window.innerHeight,
        // The player hangs over the bottom edge (step 47b): it ends below the surface, inside the window.
        barHangs:
          !!surface &&
          !!bar &&
          bar.getBoundingClientRect().bottom > surface.getBoundingClientRect().bottom &&
          bar.getBoundingClientRect().bottom <= window.innerHeight,
        listScrolls: !!results && results.scrollHeight > results.clientHeight,
      };
    });
    expect(fit).toEqual({ page: true, barHangs: true, listScrolls: true });
  });
}

test('the audio popup holds the output switch and the music volume, the page header no output button', async ({
  page,
}) => {
  await page.goto('/desk/media');
  await expect(page.getByRole('button', { name: 'Cambia uscita audio' })).toHaveCount(0);
  const open = page.getByRole('button', { name: 'Audio: Cuffie, volume musica 100%' });
  await expect(open).toContainText('Cuffie');
  await open.click();
  const popup = page.getByRole('dialog', { name: 'Audio' });
  const outputs = popup.getByRole('toolbar', { name: 'Uscite configurate' });
  await expect(outputs.getByRole('button', { name: 'Cuffie' })).toHaveAttribute('aria-pressed', 'true');
  await outputs.getByRole('button', { name: 'Casse' }).click();
  await expect(outputs.getByRole('button', { name: 'Casse' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Audio: Casse, volume musica 100%' })).toBeVisible();
  await expect(popup.getByText('Solo la musica di Hub, non il volume del sistema')).toBeVisible();
});

test('the music volume slider changes the music volume only, not the system volume', async ({ page, pc }) => {
  const volumes = async () => ({
    music: (await (await pc.get('/trpc/music.state')).json()).result.data.volume,
    system: (await (await pc.get('/trpc/audio.state')).json()).result.data.volume,
  });
  const before = await volumes();
  expect(before.music).toBe(100);
  await page.goto('/desk/media');
  await page.getByRole('button', { name: /^Audio: Cuffie, volume musica/ }).click();
  const slider = page.getByRole('dialog', { name: 'Audio' }).getByRole('slider', { name: 'Volume musica' });
  await expect(slider).toHaveValue('100');
  await slider.focus();
  const request = page.waitForRequest((r) => r.url().includes('music.setVolume') && r.method() === 'POST');
  await slider.press('Home');
  expect((await request).postData()).toContain('"volume":0');
  await expect(page.getByRole('button', { name: 'Audio: Cuffie, volume musica 0%' })).toBeVisible();
  expect(await volumes()).toEqual({ music: 0, system: before.system });
  await page.goto('/desk/system');
  await expect(page.getByRole('slider', { name: 'Volume', exact: true })).toHaveValue(
    String(Math.round(before.system * 100)),
  );
});

test('the music volume comes back when a song starts from outside the page after mpv was down', async ({
  page,
  pc,
}) => {
  // The page's first read finds mpv down (no volume): the slider is disabled and the button shows no percent.
  let first = true;
  await page.route('**/trpc/*music.state*', async (route) => {
    if (!first) return route.fallback();
    first = false;
    const names = decodeURIComponent(new URL(route.request().url()).pathname.replace('/trpc/', '')).split(',');
    const real: unknown = await (await route.fetch()).json();
    const results = Array.isArray(real) ? real : [];
    return route.fulfill({
      json: names.map((name, i) =>
        name === 'music.state' ? { result: { data: { available: true, volume: null, playing: null } } } : results[i],
      ),
    });
  });
  await page.goto('/desk/media');
  await expect(page.getByRole('button', { name: /^Audio: \w+$/ })).toBeVisible();
  // A song started from the palette, the deck or an agent, not from this page.
  // A song other than the current one: only a change of song makes the page read the volume again.
  const queue = (await (await pc.get('/trpc/music.queue')).json()).result.data;
  const id = queue.current?.id === '00000000006' ? '00000000007' : '00000000006';
  const played = await pc.post('/trpc/music.play', {
    data: { id },
    headers: { 'content-type': 'application/json' },
  });
  expect(played.ok()).toBe(true);
  await expect(page.getByRole('button', { name: /^Audio: \w+, volume musica \d+%$/ })).toBeVisible({ timeout: 15_000 });
});

test('favorites are available as a view and can seed the radio', async ({ page }) => {
  await page.goto('/desk/media');
  await search(page);
  const heart = page.getByRole('button', { name: 'Preferito Brano 1', exact: true });
  await expect(heart).toHaveAttribute('aria-pressed', 'false');
  await heart.click();
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Preferiti', exact: true }).click();
  const done = played(page);
  await page.getByRole('button', { name: 'Riproduci Brano 1', exact: true }).click();
  await done;
  await page.getByRole('button', { name: 'Ascolta', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Prossimi' })).toContainText('Brano 3');
  await page.getByRole('button', { name: 'Cronologia', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nessun brano ascoltato' })).toBeVisible();
});

test('Ascolta shows the recent songs with their covers and a tile plays', async ({ page }) => {
  const cover = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  await answerQueries(page, {
    'music.recent': [
      { id: 'recent00001', title: 'Vecchio brano', artist: 'Artista', cover },
      { id: 'recent00002', title: 'Senza copertina', artist: 'Artista', cover: null },
    ],
  });
  await page.goto('/desk/media');
  const recent = page.getByRole('region', { name: 'Ascoltati di recente' });
  await expect(recent.getByRole('listitem')).toHaveCount(2);
  await expect(recent.getByRole('listitem').first().locator('img')).toHaveAttribute('src', cover);
  await expect(recent.getByRole('listitem').nth(1).locator('img')).toHaveCount(0);
  const request = page.waitForRequest((r) => r.url().includes('music.play') && r.method() === 'POST');
  await recent.getByRole('button', { name: 'Riproduci Vecchio brano' }).click();
  expect((await request).postData()).toContain('recent00001');
});

test('cover artwork fades in after load and keeps the broken-image fallback', async ({ page }) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/delayed-cover.gif', async (route) => {
    await pending;
    await route.fulfill({
      status: 200,
      contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64'),
    });
  });
  await page.route('**/broken-cover.gif', (route) => route.fulfill({ status: 404, body: '' }));
  await answerQueries(page, {
    'music.recent': [
      {
        id: 'recent00003',
        title: 'Copertina lenta',
        artist: 'Artista',
        cover: 'http://fake.invalid/delayed-cover.gif',
      },
      {
        id: 'recent00004',
        title: 'Copertina assente',
        artist: 'Artista',
        cover: 'http://fake.invalid/broken-cover.gif',
      },
    ],
  });
  await page.goto('/desk/media');
  const recent = page.getByRole('region', { name: 'Ascoltati di recente' });
  const loaded = recent.getByRole('listitem').first().locator('[data-fade-image]');
  const loadedImage = loaded.locator('img');
  const broken = recent.getByRole('listitem').nth(1).locator('img');
  await expect(loadedImage).toHaveAttribute('src', 'http://fake.invalid/delayed-cover.gif');
  await expect.poll(() => loaded.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
  release();
  await expect(loadedImage).toHaveAttribute('data-image-loaded', 'true');
  await expect.poll(() => loaded.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  await expect(broken).toHaveAttribute('data-image-loaded', 'true');
  expect(await broken.evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : -1))).toBe(0);
});

test('changing the artist keeps the new banner transparent until its image loads', async ({ page }) => {
  const releases = new Map<string, () => void>();
  for (const name of ['first', 'second']) {
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    releases.set(name, release);
    await page.route(`**/${name}-banner.gif`, async (route) => {
      await pending;
      await route.fulfill({
        status: 200,
        contentType: 'image/gif',
        body: Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64'),
      });
    });
  }
  const answers: Record<string, unknown> = {
    'music.search': [
      {
        id: 'artist-song-1',
        title: 'Brano Primo',
        artists: [{ name: 'Artista Primo', id: 'UCaaaaaaaaaaaaaaaaaaaaaa' }],
      },
      {
        id: 'artist-song-2',
        title: 'Brano Secondo',
        artists: [{ name: 'Artista Secondo', id: 'UCbbbbbbbbbbbbbbbbbbbbbb' }],
      },
    ],
    'music.artist': {
      name: 'Artista Primo',
      banner: 'http://fake.invalid/first-banner.gif',
      songs: [],
      albums: [],
    },
  };
  await answerQueries(page, answers);
  await page.goto('/desk/media');
  await search(page);
  await page.getByRole('button', { name: 'Artista Primo', exact: true }).first().click();
  const first = page.getByRole('region', { name: 'Artista Primo' }).locator('[data-fade-image]');
  const firstImage = first.locator('img');
  await expect(firstImage).toHaveAttribute('src', 'http://fake.invalid/first-banner.gif');
  releases.get('first')?.();
  await expect(firstImage).toHaveAttribute('data-image-loaded', 'true');

  answers['music.artist'] = {
    name: 'Artista Secondo',
    banner: 'http://fake.invalid/second-banner.gif',
    songs: [],
    albums: [],
  };
  await page.getByRole('button', { name: 'Torna indietro' }).click();
  await page.getByRole('button', { name: 'Artista Secondo', exact: true }).first().click();
  const second = page.getByRole('region', { name: 'Artista Secondo' }).locator('[data-fade-image]');
  const secondImage = second.locator('img');
  await expect(secondImage).toHaveAttribute('src', 'http://fake.invalid/second-banner.gif');
  await expect.poll(() => second.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');
  releases.get('second')?.();
  await expect(secondImage).toHaveAttribute('data-image-loaded', 'true');
  await expect.poll(() => second.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
});

test('playlist can be created, populated, reordered, played and deleted with a hold', async ({ page }) => {
  await page.goto('/desk/media');
  await page.getByRole('button', { name: 'Crea playlist' }).click();
  await page
    .getByRole('dialog', { name: 'Nuova playlist' })
    .getByRole('textbox', { name: 'Nome playlist' })
    .fill('Mix test');
  await page.getByRole('dialog', { name: 'Nuova playlist' }).getByRole('button', { name: 'Crea', exact: true }).click();
  await expect(listRow(page, 'Mix test')).toBeVisible();
  await search(page, 'playlist-test');
  for (const title of ['Mix 1', 'Mix 2']) {
    await results(page)
      .getByRole('button', { name: `Aggiungi ${title} a playlist` })
      .click();
    await page.getByRole('dialog', { name: 'Aggiungi a playlist' }).getByRole('button', { name: 'Mix test' }).click();
    await expect(page.getByRole('dialog', { name: 'Aggiungi a playlist' })).toHaveCount(0);
  }
  await listRow(page, 'Mix test').click();
  await expect(page.getByRole('searchbox', { name: 'Cerca musica' })).toHaveValue('');
  await page.getByRole('button', { name: 'Sposta su Mix 2' }).click();
  await expect(page.getByRole('region', { name: 'Mix test' }).getByRole('listitem').first()).toContainText('Mix 2');
  await page.getByRole('button', { name: 'Riproduci playlist' }).click();
  await page.getByRole('button', { name: 'Ascolta', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Prossimi' }).getByRole('listitem').first()).toContainText('Mix 1');
  await listRow(page, 'Mix test').click();
  await holdDelete(page);
  await expect(listRow(page, 'Mix test')).toHaveCount(0);
});

test('a playlist is created from the add popover with the song in it, renamed and deleted', async ({ page }) => {
  await page.goto('/desk/media');
  await search(page, 'playlist-test');
  await results(page).getByRole('button', { name: 'Aggiungi Mix 1 a playlist' }).click();
  const popover = page.getByRole('dialog', { name: 'Aggiungi a playlist' });
  await popover.getByRole('textbox', { name: 'Nome playlist' }).fill('Dal popover');
  await popover.getByRole('button', { name: 'Crea', exact: true }).click();
  await expect(popover).toHaveCount(0);
  await listRow(page, 'Dal popover').click();
  await expect(page.getByRole('region', { name: 'Dal popover' })).toContainText('Mix 1');
  await page.getByRole('button', { name: 'Rinomina', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome playlist' }).fill('Rinominata');
  await page.getByRole('button', { name: 'Rinomina', exact: true }).click();
  await expect(listRow(page, 'Rinominata')).toBeVisible();
  await expect(listRow(page, 'Dal popover')).toHaveCount(0);
  await holdDelete(page);
  await expect(listRow(page, 'Rinominata')).toHaveCount(0);
});

test('an empty public playlist shows its empty state', async ({ page }) => {
  await answerQueries(page, { 'music.publicPlaylist': { title: 'Playlist pubblica', songs: [] } });
  await page.goto('/desk/media');
  await search(page, 'mix');
  await page.getByRole('button', { name: 'Playlist pubbliche' }).click();
  await page.getByRole('button', { name: 'Playlist pubblica', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nessun brano nella playlist' })).toBeVisible();
});

test('public playlist can be found, played and saved locally', async ({ page }) => {
  await page.goto('/desk/media');
  await search(page, 'mix');
  await page.getByRole('button', { name: 'Playlist pubbliche' }).click();
  await page.getByRole('button', { name: 'Playlist pubblica', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Playlist pubblica' })).toContainText('Brano 1');
  const play = page.waitForResponse((response) => response.url().includes('music.playPublicPlaylist'));
  await page.getByRole('button', { name: 'Riproduci playlist' }).click();
  expect((await play).ok()).toBeTruthy();
  const save = page.waitForResponse((response) => response.url().includes('music.savePublicPlaylist'));
  await page.getByRole('button', { name: 'Salva', exact: true }).click();
  expect((await save).ok()).toBeTruthy();
  await listRow(page, 'Playlist pubblica').click();
  await holdDelete(page);
  await expect(listRow(page, 'Playlist pubblica')).toHaveCount(0);
});

test('the player floats centred over the bottom edge of the surface, narrower than it, unclipped and clickable', async ({
  page,
}) => {
  await page.goto('/desk/media');
  const player = page.getByRole('region', { name: 'Player musicale' });
  await expect(player).toBeVisible();
  const surface = await page.locator('[data-page-surface]').boundingBox();
  const box = await player.boundingBox();
  expect(surface && box).toBeTruthy();
  if (!surface || !box) return;
  expect(box.width).toBeLessThan(surface.width);
  expect(Math.abs(box.width / surface.width - 5 / 6)).toBeLessThan(0.03);
  expect(Math.abs(box.x + box.width / 2 - (surface.x + surface.width / 2))).toBeLessThan(2);
  // Hangs over the edge: its bottom is below the surface's, its top above it, and it stays inside the window.
  expect(box.y + box.height).toBeGreaterThan(surface.y + surface.height);
  expect(box.y).toBeLessThan(surface.y + surface.height);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  // Nothing clips it: the part below the surface is hit-testable as the player's own.
  const below = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[aria-label="Player musicale"]') !== null,
    [box.x + box.width / 2, surface.y + surface.height + (box.y + box.height - surface.y - surface.height) / 2],
  );
  expect(below).toBe(true);
  await player.getByRole('button', { name: 'Metti in pausa la musica' }).click();
  await expect(player.getByRole('button', { name: 'Riproduci musica' })).toBeVisible();
});

test('Ascolta lays the recent songs in five columns and Prossimi in two', async ({ page }) => {
  const rows = [1, 2, 3, 4, 5].map((n) => ({
    id: `recent0000${n}`,
    title: `Vecchio ${n}`,
    artist: 'Artista',
    cover: null,
  }));
  await answerQueries(page, { 'music.recent': rows });
  await page.goto('/desk/media');
  const recent = page.getByRole('region', { name: 'Ascoltati di recente' });
  await expect(recent.getByRole('listitem')).toHaveCount(5);
  const xs = await recent.getByRole('listitem').evaluateAll((items) => items.map((li) => li.getBoundingClientRect().x));
  expect(new Set(xs.map(Math.round)).size).toBe(5);
  await search(page);
  await page.getByRole('button', { name: 'Riproduci Brano 1', exact: true }).click();
  await page.getByRole('button', { name: 'Ascolta', exact: true }).click();
  const next = page.getByRole('region', { name: 'Prossimi' });
  await expect(next).toContainText('Brano 3');
  const columns = await next.locator('ul').evaluate((ul) => getComputedStyle(ul).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(2);
});

/** Paints the worst a cover can do under its text (a white one for light ink, a black one for dark ink) in the surface itself. */
async function paintWorstCover(page: Page) {
  await page.evaluate(() => {
    const img = document.querySelector<HTMLElement>('[data-music-backdrop] img');
    const surface = document.querySelector<HTMLElement>('[data-page-surface]');
    if (!img || !surface) throw new Error('no backdrop');
    const fade = img.closest<HTMLElement>('[data-fade-image]');
    const alpha = Number(getComputedStyle(img).opacity) * Number(fade ? getComputedStyle(fade).opacity : 1);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    context.fillStyle = getComputedStyle(surface).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
    const worst = red + green + blue < 384 ? 255 : 0;
    context.fillStyle = `rgba(${worst}, ${worst}, ${worst}, ${alpha})`;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    surface.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
    img.style.display = 'none';
  });
}

async function playRadio(page: Page) {
  await page.goto('/desk/media');
  await search(page);
  const done = played(page);
  await page.getByRole('button', { name: 'Riproduci Brano 1', exact: true }).click();
  await done;
  await page.getByRole('button', { name: 'Ascolta', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Prossimi' })).toContainText('Brano 3');
}

for (const theme of ['Scuro', 'Chiaro']) {
  test(`the cover backdrop keeps text at 4.5:1 even under the worst cover, ${theme}`, async ({ page }) => {
    if (theme === 'Chiaro') {
      await page.goto('/desk/settings/appearance');
      await chooseTheme(page, theme);
    }
    await playRadio(page);
    const cover = page.locator('[data-music-backdrop] img');
    const fade = cover.locator('xpath=..');
    await expect(cover).toBeVisible();
    await expect.poll(() => fade.evaluate((element) => getComputedStyle(element).opacity)).toBe('0.1');
    await page.mouse.move(0, 0);
    const next = page.getByRole('region', { name: 'Prossimi' });
    const texts = [
      next.getByRole('heading', { name: 'Prossimi' }),
      next.getByText('Radio da Brano 1'),
      // Radio skips what earlier tests played, so the first row's title varies.
      next.getByRole('listitem').first().getByRole('button').first(),
      next.getByText('Artista').first(),
      page.getByRole('button', { name: 'Ascolta', exact: true }),
      page.getByText('Nessuna playlist'),
    ];
    await paintWorstCover(page);
    for (const text of texts) expect(await contrastRatio(text), await text.innerText()).toBeGreaterThanOrEqual(4.5);
  });
}

test('the backdrop shows while a song plays, never animates under reduced motion and is gone when idle', async ({
  page,
  request,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/desk/media');
  const backdrop = page.locator('[data-music-backdrop]');
  await expect(backdrop).toBeVisible();
  await expect(backdrop.locator('img')).toHaveCSS('transition-duration', '0s');
  await expect(backdrop.locator('img')).toHaveCSS('animation-name', 'none');
  await request.post(`${SERVER_URL}/__fake/player`, { data: { gone: true } });
  await expect(backdrop).toHaveCount(0);
});

test('Space plays or pauses on the page, but not in a field or on a button', async ({ page }) => {
  await page.goto('/desk/media');
  await expect(page.getByRole('region', { name: 'Player musicale' })).toBeVisible();
  const toggles: string[] = [];
  await page.getByRole('slider', { name: 'Posizione del brano' }).focus();
  page.on('request', (r) => r.url().includes('media.playPause') && toggles.push(r.url()));
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect(toggles).toHaveLength(0);
  const first = page.waitForRequest((r) => r.url().includes('media.playPause'));
  await page.evaluate(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined,
  );
  await page.keyboard.press('Space');
  await first;
  const player = page.getByRole('region', { name: 'Player musicale' });
  await expect(player.getByRole('button', { name: 'Riproduci musica' })).toBeVisible();
  const box = page.getByRole('searchbox', { name: 'Cerca musica' });
  await box.focus();
  await page.keyboard.type('a b');
  await expect(box).toHaveValue('a b');
  await page.getByRole('button', { name: 'Preferiti', exact: true }).focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  expect(toggles).toHaveLength(1);
});

test('Radio da names the seed song while a radio runs, and not after a playlist', async ({ page, pc }) => {
  await pc.post('/trpc/music.playPublicPlaylist', { data: { id: 'PLexample' } });
  await page.goto('/desk/media');
  const next = page.getByRole('region', { name: 'Prossimi' });
  await expect(next.getByRole('button', { name: 'Salta' })).toBeVisible();
  await expect(next.getByText(/^Radio da /)).toHaveCount(0);
  await playRadio(page);
  await expect(next.getByText('Radio da Brano 1')).toBeVisible();
});

test('playlist rows show the count and the cover mosaic, the empty one a note tile', async ({ page, pc }) => {
  const create = async (name: string, songs: number) => {
    const id = (await (await pc.post('/trpc/music.createPlaylist', { data: { name } })).json()).result.data.id;
    for (let i = 0; i < songs; i++)
      await pc.post('/trpc/music.addToPlaylist', {
        data: { playlistId: id, id: `mosaic0000${i}`, title: `Brano ${i}`, artist: 'Artista' },
      });
    return id;
  };
  const ids = [await create('Vuota', 0), await create('Sola', 1), await create('Mosaico', 5)];
  try {
    await page.goto('/desk/media');
    const row = (name: string) => library(page).getByRole('button', { name: new RegExp(`^${name}`) });
    await expect(row('Vuota')).toContainText('0 brani');
    await expect(row('Sola')).toContainText('1 brano');
    await expect(row('Mosaico')).toContainText('5 brani');
    await expect(row('Mosaico').locator('img')).toHaveCount(4);
    await expect(row('Sola').locator('img')).toHaveCount(1);
    await expect(row('Vuota').locator('img')).toHaveCount(0);
    await row('Vuota').click();
    await expect(page.getByRole('heading', { name: 'Nessun brano nella playlist' })).toBeVisible();
    // Adding from the page updates the row without a reload (the count once stayed stale).
    await search(page, 'playlist-test');
    await results(page).getByRole('button', { name: 'Aggiungi Mix 1 a playlist' }).click();
    await page.getByRole('dialog', { name: 'Aggiungi a playlist' }).getByRole('button', { name: 'Vuota' }).click();
    await expect(row('Vuota')).toContainText('1 brano');
  } finally {
    for (const id of ids) await pc.post('/trpc/music.deletePlaylist', { data: { id, confirmed: true } });
  }
});

test('the compact player is about 117px tall at 1920, with thin seek bar, inline times and ghost skip buttons', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/desk/media');
  const player = page.getByRole('region', { name: 'Player musicale' });
  // The slider's hidden value bubble says 0:12 too; the inline time comes first.
  const elapsed = player.getByText('0:12', { exact: true }).first();
  await expect(elapsed).toBeVisible();
  const box = await player.boundingBox();
  expect(Math.abs((box?.height ?? 0) - 117)).toBeLessThanOrEqual(8);
  // Both times and the seek bar share one row.
  const row = await Promise.all(
    [
      elapsed,
      player.getByRole('slider', { name: 'Posizione del brano' }),
      player.getByText('3:33', { exact: true }),
    ].map(async (item) => {
      const b = await item.boundingBox();
      return b ? b.y + b.height / 2 : -1;
    }),
  );
  expect(Math.max(...row) - Math.min(...row)).toBeLessThan(4);
  const track = await player.locator('div.rounded-full.bg-muted').first().boundingBox();
  expect(track?.height).toBeLessThanOrEqual(7);
  for (const name of ['Brano precedente', 'Brano successivo'])
    await expect(player.getByRole('button', { name })).toHaveCSS('border-top-width', '0px');
});

// Here, not in activity.spec.ts: the radio it starts cannot be stopped and would leak into the specs after it.
test('the ball covers no control on Musica with a radio running', async ({ page, pc }) => {
  for (const view of [
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
  ]) {
    await page.setViewportSize(view);
    await pc.post('/trpc/music.play', { data: { id: '00000000000' } });
    await page.goto('/desk/media');
    await expect(page.getByRole('region', { name: 'Prossimi' }).getByRole('button', { name: 'Salta' })).toBeVisible();
    const ball = ballOf(page);
    await expect(ball).toBeVisible();
    expect(await underBall(page, ball), `${view.width}`).toEqual([]);
  }
});

test('Ferma stops the radio and empties the queue', async ({ page, pc }) => {
  await page.goto('/desk/media');
  await search(page);
  await page.getByRole('button', { name: 'Riproduci Brano 1', exact: true }).click();
  await page.getByRole('button', { name: 'Ascolta', exact: true }).click();
  const upcoming = page.getByRole('region', { name: 'Prossimi' });
  await expect(upcoming.getByRole('button', { name: 'Salta' })).toBeVisible();
  const stopped = page.waitForResponse((r) => r.url().includes('music.stop') && r.ok());
  await upcoming.getByRole('button', { name: 'Ferma' }).click();
  await stopped;
  await expect(upcoming.getByRole('heading', { name: 'Nessuna radio attiva: fai partire un brano' })).toBeVisible();
  await expect(upcoming.getByRole('button', { name: 'Ferma' })).toHaveCount(0);
  const queue = (await (await pc.get('/trpc/music.queue')).json()).result.data;
  expect(queue.current).toBeNull();
});

test('Preferiti and Cronologia load covers lazily via /m/music/cover/:id and fall back on 404', async ({ page }) => {
  await page.route('**/m/music/cover/missing0001', (route) => route.fulfill({ status: 404, body: '' }));
  await answerQueries(page, {
    'music.favorites': [
      { id: '00000000000', title: 'Preferito con copertina', artist: 'Artista', addedAt: 1000 },
      { id: 'missing0001', title: 'Preferito senza copertina', artist: 'Artista', addedAt: 900 },
    ],
    'music.history': [
      { id: '00000000000', title: 'Ascoltato con copertina', artist: 'Artista', cover: null, playedAt: 2000 },
    ],
  });
  await page.goto('/desk/media');

  await page.getByRole('button', { name: 'Preferiti', exact: true }).click();
  const favoritesRegion = page.getByRole('region', { name: 'Preferiti' });
  const favImage = favoritesRegion.getByRole('listitem').first().locator('img');
  await expect(favImage).toHaveAttribute('loading', 'lazy');
  await expect(favImage).toHaveAttribute('src', '/m/music/cover/00000000000');
  await expect(favImage).toHaveAttribute('data-image-loaded', 'true');
  expect(
    await favImage.evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : 0)),
  ).toBeGreaterThan(0);
  await expect(favoritesRegion.getByRole('listitem').nth(1).locator('img')).toHaveCount(0);

  await page.getByRole('button', { name: 'Cronologia', exact: true }).click();
  const historyRegion = page.getByRole('region', { name: 'Cronologia' });
  const histImage = historyRegion.getByRole('listitem').first().locator('img');
  await expect(histImage).toHaveAttribute('loading', 'lazy');
  await expect(histImage).toHaveAttribute('src', '/m/music/cover/00000000000');
  await expect(histImage).toHaveAttribute('data-image-loaded', 'true');
  expect(
    await histImage.evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : 0)),
  ).toBeGreaterThan(0);
});

test('Ascolta shows Per te with its three rows and a radio tile starts the radio', async ({ page, pc }) => {
  const cover = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  await answerQueries(page, {
    'music.suggestions': {
      again: [
        { id: 'again000001', title: 'Riascolto 1', artist: 'Artista', cover },
        { id: 'again000002', title: 'Riascolto 2', artist: 'Secondo artista', cover: null },
      ],
      radios: [
        {
          artist: 'Artista',
          seed: { id: '00000000000', title: 'Brano 1', artist: 'Artista', cover },
        },
        {
          artist: 'Secondo artista',
          seed: { id: '00000000004', title: 'Brano 5', artist: 'Secondo artista', cover: null },
        },
      ],
      similar: {
        of: 'Artista',
        artists: [
          { id: 'UCabcdefghijklmnopqrstuv', name: 'Artista simile 1', cover },
          { id: 'UC0000000000000000000002', name: 'Artista simile 2', cover: null },
        ],
      },
    },
  });
  try {
    await page.goto('/desk/media');
    const forYou = page.getByRole('region', { name: 'Per te' });
    await expect(forYou).toBeVisible();
    const again = forYou.getByRole('region', { name: 'Riascolta' });
    const radios = forYou.getByRole('region', { name: 'Radio da' });
    const similar = forYou.getByRole('region', { name: 'Simili a Artista' });
    await expect(again.getByRole('listitem')).toHaveCount(2);
    await expect(radios.getByRole('listitem')).toHaveCount(2);
    await expect(similar.getByRole('listitem')).toHaveCount(2);
    await expect(radios.getByText('Radio da Artista', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);

    const started = played(page);
    await radios.getByRole('button', { name: 'Avvia radio da Artista' }).click();
    await started;

    const queue = (await (await pc.get('/trpc/music.queue')).json()).result.data;
    expect(queue.current?.id).toBe('00000000000');
    expect(queue.upcoming.length).toBeGreaterThan(0);
    const upcoming = page.getByRole('region', { name: 'Prossimi' });
    await expect(upcoming.getByRole('button', { name: 'Salta' })).toBeVisible();
    expect(await upcoming.getByRole('listitem').count()).toBeGreaterThan(0);

    await similar.getByRole('button', { name: 'Artista simile 1' }).click();
    await expect(page.getByRole('heading', { name: 'Artista', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Torna indietro' }).click();
    await expect(forYou).toBeVisible();
  } finally {
    await pc.post('/trpc/music.stop', { data: {}, headers: { 'content-type': 'application/json' } });
  }
});

test('Ascolta hides Per te on empty history and omits empty suggestion rows', async ({ page }) => {
  const loaded = page.waitForResponse((response) => response.url().includes('music.suggestions') && response.ok());
  await page.goto('/desk/media');
  await loaded;
  const upcoming = page.getByRole('region', { name: 'Prossimi' });
  await expect(upcoming.getByRole('heading', { name: 'Prossimi' })).toBeVisible();
  await expect(upcoming.locator('[data-empty-scene="music"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Per te' })).toHaveCount(0);

  await answerQueries(page, {
    'music.suggestions': {
      again: [],
      radios: [
        {
          artist: 'Artista',
          seed: { id: '00000000000', title: 'Brano 1', artist: 'Artista', cover: null },
        },
      ],
      similar: null,
    },
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Per te' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Radio da' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Riascolta' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /^Simili a / })).toHaveCount(0);
  await expect(upcoming.locator('[data-empty-variant="inline"]')).toBeVisible();
});
