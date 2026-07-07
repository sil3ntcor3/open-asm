import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';

import Reports from '@/pages/reports/reports';
import { server } from '@/test/mocks/node';
import { renderWithProviders, screen, waitFor } from '@/test/utils';

describe('Reports Page', () => {
  it('generates a summary report for all targets by default', async () => {
    const user = userEvent.setup();
    let requestBody: { targetIds?: string[] } | undefined;

    server.use(
      http.get('/api/reports', ({ request }) => {
        const url = new URL(request.url);
        return HttpResponse.json({
          data: [],
          total: 0,
          page: Number(url.searchParams.get('page') || '1'),
          totalPages: 0,
        });
      }),
      http.post('/api/reports/generate/summary', async ({ request }) => {
        requestBody = (await request.json()) as { targetIds?: string[] };
        return HttpResponse.json({
          message: 'Summary report generated successfully',
        });
      }),
    );

    renderWithProviders(<Reports />, {
      routePath: '/reports',
      initialEntries: ['/reports'],
    });

    await user.click(await screen.findByRole('tab', { name: /templates/i }));
    await user.click(screen.getByText('Summary Report'));

    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: /target/i }),
      ).toHaveTextContent('All targets');
    });

    await user.click(screen.getByRole('button', { name: /^generate$/i }));

    await waitFor(() => {
      expect(requestBody).toEqual({});
    });
  });

  it('generates a vulnerability report for the selected target', async () => {
    const user = userEvent.setup();
    let requestBody: { targetIds?: string[] } | undefined;

    server.use(
      http.get('/api/reports', ({ request }) => {
        const url = new URL(request.url);
        return HttpResponse.json({
          data: [],
          total: 0,
          page: Number(url.searchParams.get('page') || '1'),
          totalPages: 0,
        });
      }),
      http.post('/api/reports/generate/vulnerability', async ({ request }) => {
        requestBody = (await request.json()) as { targetIds?: string[] };
        return HttpResponse.json({
          message: 'Vulnerability report generated successfully',
        });
      }),
    );

    renderWithProviders(<Reports />, {
      routePath: '/reports',
      initialEntries: ['/reports'],
    });

    await user.click(await screen.findByRole('tab', { name: /templates/i }));
    await user.click(screen.getByText('Vulnerability Report'));
    await user.click(screen.getByRole('combobox', { name: /target/i }));
    await user.click(
      await screen.findByRole('option', { name: /192\.168\.1\.1/i }),
    );
    await user.click(screen.getByRole('button', { name: /^generate$/i }));

    await waitFor(() => {
      expect(requestBody).toEqual({ targetIds: ['target-2'] });
    });
  });
});
