/**
 * @vitest-environment jsdom
 */
/** Component tests: UI state components (loading/empty/error) and offline badge. */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '../../src/client/i18n';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineBadge,
} from '../../src/client/components/ui-states';

function wrap(ui: React.ReactNode) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('ui-states', () => {
  it('renders loading state with status role', () => {
    wrap(<LoadingState />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders empty state with title and description', () => {
    wrap(<EmptyState title="No workouts yet" description="Start from Today" />);
    expect(screen.getByText('No workouts yet')).toBeInTheDocument();
    expect(screen.getByText('Start from Today')).toBeInTheDocument();
  });

  it('renders error state as an alert with message', () => {
    wrap(<ErrorState message="Network unreachable" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Network unreachable')).toBeInTheDocument();
  });

  it('renders sync status badge variants', () => {
    const { rerender } = wrap(<OfflineBadge status="local" />);
    expect(screen.getByTestId('sync-status-local')).toHaveTextContent('Saved locally');
    rerender(
      <I18nProvider>
        <OfflineBadge status="synced" />
      </I18nProvider>,
    );
    expect(screen.getByTestId('sync-status-synced')).toHaveTextContent('Synced');
    rerender(
      <I18nProvider>
        <OfflineBadge status="attention" />
      </I18nProvider>,
    );
    expect(screen.getByTestId('sync-status-attention')).toHaveTextContent('Sync needs attention');
  });
});

describe('i18n', () => {
  it('falls back to English for missing locale keys', () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>,
    );
    // English keys always resolve
    expect(screen.getByTestId('nav-today').textContent).toBe('Today');
  });
});

function TestConsumer() {
  const { t } = useI18nForTest();
  return <span data-testid="nav-today">{t('nav.today')}</span>;
}

import { useI18n as useI18nForTest } from '../../src/client/i18n';
