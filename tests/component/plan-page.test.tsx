/**
 * @vitest-environment jsdom
 */
/** Component tests: PlanPage must never show a dead (permanently disabled) Confirm. */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '../../src/client/i18n';
import { PlanPage } from '../../src/client/pages/PlanPage';

vi.mock('../../src/client/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/lib/api')>();
  return {
    ...actual,
    api: vi
      .fn()
      .mockRejectedValue(
        new actual.ApiClientError(404, 'not_found', 'No plan yet. Generate one from onboarding.'),
      ),
  };
});

describe('PlanPage without a plan (fresh onboarding)', () => {
  it('shows an enabled Confirm button — no hidden checkbox gate', async () => {
    render(
      <I18nProvider>
        <PlanPage />
      </I18nProvider>,
    );
    const button = await screen.findByTestId('generate-plan');
    expect(button).toBeEnabled();
    expect(
      screen.getByText('Review and accept your plan to start training.'),
    ).toBeInTheDocument();
  });
});