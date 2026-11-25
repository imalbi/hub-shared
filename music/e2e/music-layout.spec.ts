import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
import { answerQueries } from '../../../apps/e2e/tests/desktop.ts';
import { PC_URL } from '../../../apps/e2e/tests/hosts.ts';
const mediaSuggestions = {
  again: [
    { id: '00000000000', title: 'Brano preferito 1', artist: 'Artista A', cover: '/m/music/cover/00000000000' },
    { id: '00000000001', title: 'Brano preferito 2', artist: 'Artista B', cover: '/m/music/cover/00000000000' },
    { id: '00000000002', title: 'Brano preferito 3', artist: 'Artista C', cover: '/m/music/cover/00000000000' },
    { id: '00000000003', title: 'Brano senza cover', artist: 'Artista D', cover: null },
    { id: '00000000004', title: 'Brano preferito 5', artist: 'Artista E', cover: '/m/music/cover/00000000000' },
    { id: '00000000005', title: 'Brano preferito 6', artist: 'Artista F', cover: '/m/music/cover/00000000000' },
  ],
  radios: [
    {
      artist: 'Artista',
      seed: { id: '00000000000', title: 'Brano 1', artist: 'Artista', cover: '/m/music/cover/00000000000' },
    },
    {
      artist: 'Artista Due',
      seed: { id: '00000000001', title: 'Brano 2', artist: 'Artista Due', cover: '/m/music/cover/00000000000' },
    },
    {
      artist: 'Artista Tre',
      seed: { id: '00000000002', title: 'Brano 3', artist: 'Artista Tre', cover: '/m/music/cover/00000000000' },
    },
  ],
  similar: {
    of: 'Artista',
    artists: [
      { id: 'UCabcdefghijklmnopqrstuv', name: 'Simile 1', cover: '/m/music/cover/00000000000' },
      { id: 'UC0000000000000000000002', name: 'Simile 2', cover: '/m/music/cover/00000000000' },
      { id: 'UC0000000000000000000003', name: 'Simile 3', cover: '/m/music/cover/00000000000' },
      { id: 'UC0000000000000000000004', name: 'Simile 4', cover: '/m/music/cover/00000000000' },
      { id: 'UC0000000000000000000005', name: 'Simile 5', cover: '/m/music/cover/00000000000' },
      { id: 'UC0000000000000000000006', name: 'Simile 6', cover: '/m/music/cover/00000000000' },
    ],
  },
};

async function waitForSuggestionsCovers(page: Parameters<typeof answerQueries>[0]) {
  const region = page.getByRole('region', { name: 'Per te' });
  await expect(region).toBeVisible();
  await expect
    .poll(() =>
      region.locator('[data-fade-image]').evaluateAll((elements) => {
        if (elements.length === 0) return false;
        return elements.every((element) => {
          const image = element.querySelector('img');
          return (
            image instanceof HTMLImageElement &&
            image.getAttribute('data-image-loaded') === 'true' &&
            image.naturalWidth > 0 &&
            getComputedStyle(element).opacity === '1'
          );
        });
      }),
    )
    .toBe(true);
}

test('Media Ascolta with Per te at 1920 matches the baseline', async ({ page }) => {
  await answerQueries(page, { 'music.suggestions': mediaSuggestions });
  await page.goto('/desk/media');
  await expect(page.getByRole('img', { name: 'Copertina di Title' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Per te' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Simili a Artista' })).toBeVisible();
  await waitForSuggestionsCovers(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('desk-media-suggestions.png', { animations: 'disabled' });
});

test('Media Ascolta with Per te at 4K matches the baseline', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await answerQueries(page, { 'music.suggestions': mediaSuggestions });
  await page.goto('/desk/media');
  await expect(page.getByRole('img', { name: 'Copertina di Title' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Per te' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Simili a Artista' })).toBeVisible();
  await waitForSuggestionsCovers(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('desk-media-suggestions-4k.png', { animations: 'disabled' });
});

test('Media search at 4K matches the baseline', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/media');
  await page.getByRole('searchbox', { name: 'Cerca musica' }).fill('canzone');
  await expect(page.getByRole('button', { name: 'Riproduci Brano 1', exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('desk-media-search-4k.png', { animations: 'disabled' });
});

test('Media artist at 4K matches the baseline', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/media');
  await page.getByRole('searchbox', { name: 'Cerca musica' }).fill('canzone');
  await page.getByRole('button', { name: 'Artista', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Artista', exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot('desk-music-artist-4k.png', { animations: 'disabled' });
});

test('Media playlist at 4K matches the baseline', async ({ page, request }) => {
  const created = await request.post(`${PC_URL}/trpc/music.createPlaylist`, { data: { name: 'Mix esempio' } });
  const id = (await created.json()).result.data.id;
  try {
    await request.post(`${PC_URL}/trpc/music.addToPlaylist`, {
      data: { playlistId: id, id: 'playlist001', title: 'Brano esempio', artist: 'Artista' },
    });
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.goto('/desk/media');
    await page
      .getByRole('region', { name: 'Playlist', exact: true })
      .getByRole('button', { name: /^Mix esempio/ })
      .click();
    await expect(page.getByText('Brano esempio')).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot('desk-music-playlist-4k.png', { animations: 'disabled' });
  } finally {
    await request.post(`${PC_URL}/trpc/music.deletePlaylist`, { data: { id, confirmed: true } });
  }
});
