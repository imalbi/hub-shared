import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
import { chooseTheme } from '../../../apps/e2e/tests/themes.ts';

test('the desk scroller reaches the window edge, so its scrollbar is flush', async ({ page }) => {
  await page.goto('/desk/studio');
  await expect(page.getByRole('region', { name: 'Pomodoro' }).first()).toBeVisible();
  const edge = await page.evaluate(() => {
    const main = document.querySelector('main');
    const scroller = main?.querySelector(':scope > div');
    return { right: scroller?.getBoundingClientRect().right, width: window.innerWidth };
  });
  expect(edge.right).toBe(edge.width);
});

test('the tab bar of a long zone page stays in view while the content scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 400 });
  await page.goto('/desk/studio');
  const tabs = page.getByRole('tablist');
  await expect(tabs).toBeVisible();
  const panel = page.getByRole('tabpanel');
  const surface = page.locator('[data-page-scroller]');
  await expect(page.getByRole('region', { name: 'Pomodoro' }).first()).toBeVisible();
  await expect.poll(() => surface.evaluate((el) => (el.scrollTo(0, el.scrollHeight), el.scrollTop))).toBeGreaterThan(0);
  expect(await panel.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(tabs).toBeInViewport();
  const tabsBox = await tabs.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(panelBox!.y).toBeLessThan(tabsBox!.y + tabsBox!.height);
  // The surface leaves the desk's right gutter, like the rest of the desk content; the panel's scrollbar sits at its edge.
  const gutter = await page.locator('main').evaluate((main) => parseFloat(getComputedStyle(main).paddingTop));
  expect(
    await page.locator('[data-page-surface]').evaluate((el) => window.innerWidth - el.getBoundingClientRect().right),
  ).toBe(gutter);
});

test('the opaque surface band stays above content, marks scroll and resets on tab change', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 400 });
  await page.goto('/desk/studio');
  const surface = page.locator('[data-page-scroller]');
  const band = page.locator('[data-surface-band]');
  const tabs = page.getByRole('tablist');
  await expect(page.getByRole('region', { name: 'Pomodoro' }).first()).toBeVisible();
  await expect(band).toHaveAttribute('data-scrolled', 'false');
  const colors = await band.evaluate((element) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context || !element.parentElement) throw new Error('Missing canvas or surface');
    const pixel = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    return [
      pixel(getComputedStyle(element).backgroundColor),
      pixel(getComputedStyle(element.parentElement).backgroundColor),
    ];
  });
  expect(colors[0]).toEqual(colors[1]);
  expect(colors[0]?.[3]).toBe(255);
  const before = await tabs.boundingBox();
  await surface.evaluate((element) => element.scrollTo(0, 400));
  await expect(band).toHaveAttribute('data-scrolled', 'true');
  expect((await tabs.boundingBox())?.y).toBe(before?.y);
  expect(
    await surface.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element
        .querySelector('[data-surface-band]')
        ?.contains(document.elementFromPoint(rect.left + 40, rect.top + 2));
    }),
  ).toBe(true);
  expect(
    await band.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.right - 20, rect.top + rect.height / 2));
    }),
  ).toBe(true);
  await page.getByRole('tab', { name: 'Piano', exact: true }).click();
  await expect.poll(() => surface.evaluate((element) => element.scrollTop)).toBe(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight === document.documentElement.clientHeight),
  ).toBe(true);
});

test('the surface band is opaque in paper', async ({ page }) => {
  await page.goto('/desk/settings/appearance');
  await chooseTheme(page, 'Chiaro');
  await page.goto('/desk/studio');
  const colors = await page.locator('[data-surface-band]').evaluate((band) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context || !band.parentElement) throw new Error('Missing canvas or surface');
    return [band, band.parentElement].map((element) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    });
  });
  expect(colors[0]).toEqual(colors[1]);
  expect(colors[0]?.[3]).toBe(255);
});

test('keyboard focus scrolls a covered control below the surface band', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 400 });
  await page.goto('/desk/studio');
  const surface = page.locator('[data-page-scroller]');
  await expect(page.getByRole('region', { name: 'Pomodoro' }).first()).toBeVisible();
  await surface.evaluate((element) => {
    const controls = document.createElement('div');
    controls.innerHTML = '<button>Focus before</button><button>Focus target</button><div style="height:800px"></div>';
    element.lastElementChild?.append(controls);
  });
  await page.getByRole('button', { name: 'Focus before' }).focus();
  await surface.evaluate((element) => {
    const target = [...element.querySelectorAll('button')].find((button) => button.textContent === 'Focus target');
    if (!target) throw new Error('Missing focus target');
    element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - 5;
  });
  await page.keyboard.press('Tab');
  const target = page.getByRole('button', { name: 'Focus target' });
  await expect(target).toBeFocused();
  const band = await page.locator('[data-surface-band]').boundingBox();
  expect((await target.boundingBox())!.y).toBeGreaterThanOrEqual(band!.y + band!.height - 1);
});

test('the rounded frame clips a styled native scrollbar', async ({ page }) => {
  await page.goto('/desk/studio');
  const frame = page.locator('[data-page-surface]');
  const scroller = page.locator('[data-page-scroller]');
  await expect(scroller).toHaveCSS('scrollbar-width', 'auto');
  expect(await scroller.evaluate((element) => getComputedStyle(element).scrollbarColor)).toContain('rgba(0, 0, 0, 0)');
  await expect(frame).toHaveCSS('overflow', 'hidden');
  const radius = await frame.evaluate((element) => getComputedStyle(element).borderTopRightRadius);
  expect(parseFloat(radius)).toBeGreaterThan(0);
  // overflow hidden plus a radius left the child's scrollbar square over the corners in Chromium; clip-path cuts it.
  await expect(frame).toHaveCSS('clip-path', `inset(0px round ${radius})`);
});
