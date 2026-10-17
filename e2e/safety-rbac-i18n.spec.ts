/** E2E: safety flow — urgent pain signals get stop-training guidance; RBAC; locale. */

import { test, expect } from '@playwright/test';
import { setupMemberWithPlan, loginInPage } from './helpers';

test.describe('safety flow', () => {
  test('urgent pain report stops training with safe copy and no medical claims', async ({
    page,
    request,
  }) => {
    const email = `e2e-pain-${Date.now()}@test.dev`;
    const { cookieHeader } = await setupMemberWithPlan(request, email);
    await loginInPage(page, cookieHeader);

    await page.getByTestId('begin-workout').click();
    await expect(page.getByTestId('workout-player')).toBeVisible();

    await page.getByTestId('report-pain').click();
    await page.getByTestId('pain-urgent').check();
    await page
      .getByLabel('Anything else you want to add? (optional)')
      .fill('chest pain and dizziness during the set');
    await page.getByTestId('submit-pain').click();

    const guidance = page.getByTestId('safety-guidance');
    await expect(guidance).toBeVisible();
    await expect(guidance).toContainText('Stop training now');
    await expect(guidance).toContainText('seek urgent medical help');
    // No medical interpretation or forced alternative
    await expect(guidance).not.toContainText('instead');
  });
});

test.describe('RBAC', () => {
  test('normal members cannot access admin routes', async ({ page, request }) => {
    const email = `e2e-rbac-${Date.now()}@test.dev`;
    const { cookieHeader } = await setupMemberWithPlan(request, email);

    // API-level enforcement
    const res = await request.get('/api/v1/admin/health', {
      headers: { cookie: cookieHeader },
    });
    expect(res.status()).toBe(403);

    // UI-level: admin link hidden, direct navigation shows denial
    await loginInPage(page, cookieHeader);
    await expect(page.getByRole('button', { name: 'Admin' })).toHaveCount(0);
    await page.goto('/admin');
    await expect(page.getByText('You do not have access to this area.')).toBeVisible();
  });
});

test.describe('locale switching', () => {
  test('locale switching renders en/nl/fr/de but keeps stored values', async ({
    page,
    request,
  }) => {
    const email = `e2e-i18n-${Date.now()}@test.dev`;
    const { cookieHeader } = await setupMemberWithPlan(request, email);
    await loginInPage(page, cookieHeader);

    // English default
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();

    // Switch to Dutch
    await page.locator('#locale-select').selectOption('nl');
    await expect(page.getByRole('heading', { name: 'Vandaag', exact: true })).toBeVisible();

    // Navigation translated
    await expect(page.getByRole('link', { name: 'Vooruitgang' }).first()).toBeVisible();

    // Stored data unchanged: weight value semantics preserved (display only)
    await page.goto('/progress');
    await page.getByTestId('weight-input').fill('80.5');
    await page.getByTestId('save-weighin').click();
    await expect(page.getByTestId('weight-latest')).toContainText('80,5'); // nl decimal separator

    // French renders from the same stored session
    await page.locator('#locale-select').selectOption('fr');
    await expect(page.getByRole('heading', { name: 'Progrès', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Progrès' }).first()).toBeVisible();
    await expect(page.getByTestId('weight-latest')).toContainText('80,5'); // fr decimal separator

    // German renders from the same stored session
    await page.locator('#locale-select').selectOption('de');
    await expect(page.getByRole('heading', { name: 'Fortschritt', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fortschritt' }).first()).toBeVisible();
    await expect(page.getByTestId('weight-latest')).toContainText('80,5'); // de decimal separator

    // Back to English: same stored weight, display convention restored
    await page.locator('#locale-select').selectOption('en');
    await expect(page.getByRole('heading', { name: 'Progress', exact: true })).toBeVisible();
    await expect(page.getByTestId('weight-latest')).toContainText('80.5'); // en decimal point
  });
});
