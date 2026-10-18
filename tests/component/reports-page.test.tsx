/**
 * @vitest-environment jsdom
 */
/** Component tests: ReportsPage pickers default locale, validate, poll, download. */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nProvider } from '../../src/client/i18n';
import { ReportsPage } from '../../src/client/pages/ReportsPage';
import { api } from '../../src/client/lib/api';

vi.mock('../../src/client/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/lib/api')>();
  return { ...actual, api: vi.fn() };
});

const mockedApi = vi.mocked(api);

function renderPage() {
  return render(
    <I18nProvider>
      <ReportsPage />
    </I18nProvider>,
  );
}

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.mockImplementation(async (path: string, _opts?: unknown) => {
      if (path === '/reports') return { exports: [] } as unknown as never;
      throw new Error('unexpected ' + path);
    });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('renders period pickers, detail levels, locale defaulting to app locale', async () => {
    renderPage();
    expect(await screen.findByTestId('reports-page')).toBeInTheDocument();
    expect(screen.getByTestId('reports-start')).toBeInTheDocument();
    expect(screen.getByTestId('reports-end')).toBeInTheDocument();
    expect(screen.getByTestId('reports-detail')).toHaveValue('standard');
    expect(screen.getByTestId('reports-locale')).toHaveValue('en');
    expect(screen.getByText('No reports yet')).toBeInTheDocument();
  });

  it('blocks empty dates with a validation error and no POST', async () => {
    renderPage();
    await screen.findByTestId('reports-page');
    const starts = screen.getAllByTestId('reports-start');
    fireEvent.change(starts[0], { target: { value: '' } });
    fireEvent.click(screen.getAllByTestId('reports-generate')[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a start and end date.');
    expect(mockedApi).not.toHaveBeenCalledWith('/reports', expect.objectContaining({ method: 'POST' }));
  });

  it('202 -> polls status -> shows download link', async () => {
    let statusCalls = 0;
    mockedApi.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/reports' && (opts as { method?: string } | undefined)?.method === 'POST') return { exportId: 'rpt_1', status: 'pending' } as unknown as never;
      if (path === '/reports') return { exports: [] } as unknown as never;
      if (path === '/reports/rpt_1/status') {
        statusCalls += 1;
        if (statusCalls === 1) return { id: 'rpt_1', status: 'pending', file_size: null, error_message: null, attempts: 0, completed_at: null } as unknown as never;
        return { id: 'rpt_1', status: 'ready', file_size: 2048, error_message: null, attempts: 1, completed_at: '2026-03-01T00:00:00Z' } as unknown as never;
      }
      throw new Error('unexpected ' + path);
    });
    renderPage();
    await screen.findByTestId('reports-page');
    fireEvent.click(screen.getAllByTestId('reports-generate')[0]);
    await waitFor(() => expect(screen.getByTestId('reports-status')).toBeInTheDocument(), { timeout: 4000 });
    await waitFor(() => expect(screen.getByTestId('reports-download')).toBeInTheDocument(), { timeout: 8000 });
    expect(screen.getByTestId('reports-download')).toHaveAttribute('href', '/api/v1/reports/rpt_1/download');
  }, 15000);

  it('surfaces failed status with error text', async () => {
    mockedApi.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/reports' && (opts as { method?: string } | undefined)?.method === 'POST') return { exportId: 'rpt_9', status: 'pending' } as unknown as never;
      if (path === '/reports') return { exports: [] } as unknown as never;
      if (path === '/reports/rpt_9/status') return { id: 'rpt_9', status: 'failed', file_size: null, error_message: 'boom', attempts: 1, completed_at: null } as unknown as never;
      throw new Error('unexpected ' + path);
    });
    renderPage();
    await screen.findByTestId('reports-page');
    fireEvent.click(screen.getAllByTestId('reports-generate')[0]);
    await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument(), { timeout: 8000 });
  }, 15000);
});
