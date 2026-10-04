// e2e/screens.spec.ts
//
// Screenshots of every main screen, per device size (playwright.config.ts).
// Read-only: it navigates and looks; it never creates or changes data.
// Output: e2e/screens/<device>/<screen>.png (git-ignored).
//
// Run: npx playwright test e2e/screens.spec.ts

import { test, expect, type Page } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

// Every page must fit the screen it's on: no sideways scrolling (§75).
// Phone overflow was the first real bug these screenshots found, so it's
// checked on every shot, and the culprit's ancestor chain is reported.
const overflows: string[] = [];

async function shot(page: Page, name: string) {
  // Let fonts, images and the first data load settle.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);
  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= vw + 1) return null;
    let worst: Element | null = null;
    let max = 0;
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > max) [max, worst] = [r.right, el];
    });
    const chain: string[] = [];
    for (let el = worst as Element | null; el && chain.length < 6; el = el.parentElement)
      chain.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').slice(0, 4).join('.')}`);
    return `${Math.round(max)}px on a ${vw}px screen: ${chain.join(' < ')}`;
  });
  if (report) overflows.push(`${test.info().project.name}/${name}: ${report}`);
  await page.screenshot({ path: `e2e/screens/${test.info().project.name}/${name}.png`, fullPage: true });
}

async function go(page: Page, label: string) {
  const isPhone = test.info().project.name === 'phone';
  const inPhoneBar = ['Home', 'Customers', 'Production', 'Catalogue'].includes(label);
  if (isPhone && !inPhoneBar) {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('dialog', { name: 'More' }).getByRole('button', { name: label }).click();
  } else {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
  }
}

test('sign-in screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await shot(page, '00-sign-in');
});

test('main screens', async ({ page }) => {
  test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD in .env.e2e.local');
  await page.goto('/');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  await shot(page, '01-home');

  for (const [label, file] of [
    ['Customers', '02-customers'],
    ['Production', '03-production'],
    ['Catalogue', '04-catalogue'],
    ['Rate card', '05-rate-card'],
    ['Workshop', '06-workshop'],
    ['Settings', '07-settings'],
  ] as const) {
    await go(page, label);
    await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible({ timeout: 20_000 });
    await shot(page, file);
    if (label === 'Catalogue') {
      // The first screenful, and a cabinet's edit panel opened and then
      // closed with Cancel: still read-only.
      await page.screenshot({ path: `e2e/screens/${test.info().project.name}/04a-catalogue-top.png` });
      await page.getByRole('region', { name: 'Cabinets' }).getByRole('button').filter({ hasText: '×' }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/screens/${test.info().project.name}/04b-catalogue-edit.png` });
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      // The duplicates review, opened and closed without merging.
      const review = page.getByRole('button', { name: 'Review' });
      if (await review.count()) {
        await review.click();
        await expect(page.getByRole('dialog', { name: 'Possible duplicates' })).toBeVisible();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `e2e/screens/${test.info().project.name}/04c-duplicates.png` });
        await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
      }
      // Each section on its own, for review (laptop only — the long list
      // makes the full-page shot hard to read).
      if (test.info().project.name === 'laptop') {
        for (const id of ['appliances', 'finishes', 'handles', 'fixtures', 'obstacles']) {
          await page.locator(`#catalogue-${id}`).screenshot({ path: `e2e/screens/laptop/04-section-${id}.png` });
        }
      }
    }
  }
  expect(overflows, 'Pages wider than the screen').toEqual([]);
});

test('design editor', async ({ page }) => {
  test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD in .env.e2e.local');
  await page.goto('/');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  await go(page, 'Customers');
  await expect(page.getByRole('heading', { level: 1, name: 'Customers' })).toBeVisible();
  // Open the first customer's design (opens; nothing is edited or saved).
  // Prefer a design that has a price (so it has cabinets to show).
  await page.locator('main article:visible').first().waitFor();
  const priced = page.locator('main article:visible', { hasText: '₹' }).first().locator('button').first();
  await (await priced.count() ? priced : page.locator('main article button:visible').first()).click();
  await expect(page.getByRole('button', { name: /Finalise/ })).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  const dir = `e2e/screens/${test.info().project.name}`;
  await page.screenshot({ path: `${dir}/08-editor.png` });
  // The cabinet inspector (laptop): click the first cabinet on the plan.
  if (test.info().project.name === 'laptop') {
    await page.mouse.click(700, 250);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/08-inspector.png`, fullPage: false });
    const aside = page.getByRole('complementary').last();
    await aside.evaluate((el) => el.scrollTo(0, 700));
    await page.screenshot({ path: `${dir}/08-inspector-2.png` });
    await page.keyboard.press('Escape');
  }
  // Every tool panel (laptop), for review.
  if (test.info().project.name === 'laptop') {
    for (const tool of ['Cabinets', 'Appliances', 'Pillars', 'Doors', 'Lights', 'Cameras', 'Surfaces']) {
      const btn = page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: tool });
      if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
      await page.waitForTimeout(300);
      await page.getByRole('complementary', { name: tool }).screenshot({ path: `${dir}/08-tool-${tool.toLowerCase()}.png` });
    }
  }
  await page.getByRole('tab', { name: '3D' }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/08b-editor-3d.png` });
  await page.getByRole('tab', { name: 'Elevation' }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/08d-editor-wall3d.png` });
  await page.getByRole('tab', { name: 'Plan' }).click();
  // The plan's own Show menu (§88), separate from the checks.
  await page.getByRole('button', { name: /Show|Layers/ }).first().click();
  await page.screenshot({ path: `${dir}/08g-editor-show.png` });
  await page.getByRole('button', { name: /Show|Layers/ }).first().click();
  await page.getByRole('button', { name: /^\S+ checks?$|No issues/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/08c-editor-checks.png` });
  await page.getByRole('button', { name: 'Close checks' }).click();
  // The job's cutting list, its three views (read-only).
  // Phone: the tool sheet, then the cutting list from the More menu (§87).
  if (test.info().project.name === 'phone') {
    await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: 'Cabinets' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/08e-editor-tool-sheet.png` });
    await page.getByRole('button', { name: 'Close panel' }).click();
    await page.getByRole('button', { name: 'More' }).click();
    await page.screenshot({ path: `${dir}/08f-editor-more.png` });
    await page.getByRole('menuitem', { name: /Cutting list/ }).click();
  } else {
    await page.getByRole('button', { name: /Cutting list/ }).locator('visible=true').first().click();
  }
  await expect(page.getByText(/Cutting list/).first()).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${dir}/09-cutlist.png`, fullPage: true });
  for (const [tab, file] of [['By cabinet', '09b-cutlist-cabinet'], ['Sheets & waste', '09c-cutlist-sheets']] as const) {
    const t = page.getByRole('button', { name: tab });
    if (await t.count()) {
      await t.first().click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${dir}/${file}.png`, fullPage: true });
    }
  }
});
