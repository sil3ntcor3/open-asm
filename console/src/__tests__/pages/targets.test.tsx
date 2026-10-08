import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/node';
import Targets from '@/pages/targets/targets';

describe('Targets Page', () => {
  it('renders targets table with data', async () => {
    renderWithProviders(<Targets />, {
      routePath: '/_authed/targets/',
      initialEntries: ['/_authed/targets/'],
    });

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
      expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
    });

    expect(await screen.findByText('Target')).toBeInTheDocument();
    expect(await screen.findByText('Type')).toBeInTheDocument();
    expect(await screen.findByText('Services')).toBeInTheDocument();
    expect(await screen.findByText('DOMAIN')).toBeInTheDocument();
    expect(await screen.findByText('IP')).toBeInTheDocument();
  });

  it('shows empty state when no targets', async () => {
    server.use(
      http.get('/api/targets', () => {
        return HttpResponse.json({
          data: [],
          total: 0,
          page: 1,
          totalPages: 0,
        });
      }),
    );

    renderWithProviders(<Targets />, {
      routePath: '/_authed/targets/',
      initialEntries: ['/_authed/targets/'],
    });

    await waitFor(() => {
      expect(screen.getByText('No data')).toBeInTheDocument();
    });
  });

  it('handles search/filter', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Targets />, {
      routePath: '/_authed/targets/',
      initialEntries: ['/_authed/targets/'],
    });

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Search');
    await user.type(searchInput, 'example');

    await waitFor(() => {
      expect(searchInput).toHaveValue('example');
    });
  });

  it('starts discovery for selected targets', async () => {
    const user = userEvent.setup();
    let requestedTargetIds: string[] = [];

    server.use(
      http.post('/api/targets/discover', async ({ request }) => {
        const body = (await request.json()) as { targetIds: string[] };
        requestedTargetIds = body.targetIds;

        return HttpResponse.json({
          totalStarted: body.targetIds.length,
          totalSkipped: 0,
          skipped: [],
        });
      }),
    );

    renderWithProviders(<Targets />, {
      routePath: '/_authed/targets/',
      initialEntries: ['/_authed/targets/'],
    });

    await waitFor(() => {
      expect(screen.getByText('example.com')).toBeInTheDocument();
    });

    const startDiscoveryButton = await screen.findByRole('button', {
      name: /start discovery/i,
    });
    expect(startDiscoveryButton).toBeDisabled();

    const rowCheckboxes = await screen.findAllByLabelText('Select row');
    await user.click(rowCheckboxes[0]);
    await user.click(rowCheckboxes[1]);
    await user.click(startDiscoveryButton);

    await waitFor(() => {
      expect(requestedTargetIds).toEqual(['target-1', 'target-2']);
    });
  });
});
