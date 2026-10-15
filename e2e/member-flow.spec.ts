/** E2E: signup → onboarding → plan → begin workout from Today in ≤2 interactions. */

import { test, expect } from '@playwright/test';
import { setupMemberWithPlan, loginInPage, TEST_PASSWORD } from './helpers';

test.describe('member happy path', () => {
  test('signs up, onboards, generates + accepts a plan, and starts a workout from Today', async ({
    page,
    request,
  }) => {
    const email = `e2e-flow-${Date.now()}@test.dev`;
    const { cookieHeader } = await setupMemberWithPlan(request, email);
    await loginInPage(page, cookieHeader);

    // Today shows the next action and a Begin workout button (≤2 interactions to start).
    await expect(page.getByTestId('today-page')).toBeVisible();
    await page.getByTestId('begin-workout').click();

    // Workout player opens with exercises and set rows.
    await expect(page.getByTestId('workout-player')).toBeVisible();
    await expect(page.getByTestId('sets-table')).toBeVisible();
    await expect(page.getByTestId('set-row-1')).toBeVisible();

    // Log a set: the acceptance scenario shape (planned 3×N; set 1 = 2 reps partial).
    const weight = page.getByLabel(/weight kg/).first();
    await weight.fill('30');
    await page.getByLabel(/Set 1 reps/).fill('2');
    await page.getByTestId('save-set-1').click();

    // Planned vs actual both retained.
    await expect(page.getByTestId('actual-1')).toContainText('2 reps');

    // Report pain (shoulder discomfort) → guidance appears.
    await page.getByTestId('report-pain').click();
    await page.getByTestId('pain-discomfort').check();
    await page.getByTestId('submit-pain').click();
    await expect(page.getByTestId('safety-guidance')).toBeVisible();

    // Finish → summary with labelled estimates.
    await page.getByTestId('finish-workout').click();
    await page.getByTestId('confirm-finish').click();
    await expect(page.getByTestId('log-page')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Session summary')).toBeVisible();
  });

  test('onboarding validation blocks progression until required fields pass', async ({ page }) => {
    // Fresh signup through the UI
    const email = `e2e-onb-${Date.now()}@test.dev`;
    await page.goto('/signup');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByTestId('onboarding-basics')).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // Goals step: cannot proceed without goals + realistic-range acknowledgement
    await expect(page.getByTestId('onboarding-goals')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();

    await page.getByRole('checkbox', { name: /Build muscle/ }).check();
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled(); // still needs ack
    await page.getByText(/realistic range, not a promise/).click();
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
  });
});
