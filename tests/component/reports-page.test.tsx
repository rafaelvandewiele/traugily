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

  it('202 -> polls status -> downloads PDF via fetch blob (no navigation)', async () => {
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
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const fetchMock = vi.fn(async () =>
      new Response(new Blob([pdfBytes], { type: 'application/pdf' }), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const createUrl = vi.fn(() => 'blob:fake');
    const revokeUrl = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', { value: createUrl, configurable: true });
    Object.defineProperty(window.URL, 'revokeObjectURL', { value: revokeUrl, configurable: true });
    try {
      renderPage();
      await screen.findByTestId('reports-page');
      fireEvent.click(screen.getAllByTestId('reports-generate')[0]);
      await waitFor(() => expect(screen.getByTestId('reports-download')).toBeInTheDocument(), { timeout: 8000 });
      const button = screen.getByTestId('reports-download');
      expect(button.tagName).toBe('BUTTON');
      fireEvent.click(button);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/reports/rpt_1/download',
        expect.objectContaining({ credentials: 'same-origin' }),
      ), { timeout: 4000 });
      expect(createUrl).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  }, 15000);

  it('shows an inline error when the download response is not a PDF', async () => {
    mockedApi.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/reports' && (opts as { method?: string } | undefined)?.method === 'POST') return { exportId: 'rpt_2', status: 'pending' } as unknown as never;
      if (path === '/reports') return { exports: [] } as unknown as never;
      if (path === '/reports/rpt_2/status') return { id: 'rpt_2', status: 'ready', file_size: 2048, error_message: null, attempts: 1, completed_at: '2026-03-01T00:00:00Z' } as unknown as never;
      throw new Error('unexpected ' + path);
    });
    // Server returns the SPA shell HTML instead of a file.
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('<html>shell</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    ));
    try {
      renderPage();
      await screen.findByTestId('reports-page');
      fireEvent.click(screen.getAllByTestId('reports-generate')[0]);
      await waitFor(() => expect(screen.getByTestId('reports-download')).toBeInTheDocument(), { timeout: 8000 });
      fireEvent.click(screen.getByTestId('reports-download'));
      await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not available yet/i), { timeout: 4000 });
    } finally {
      vi.unstubAllGlobals();
    }
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
