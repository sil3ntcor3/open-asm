import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/node';
import type { Target } from '@/services/apis/gen/queries';
import {
  getTargetsControllerGetTargetByIdQueryKey,
  useTargetsControllerGetTargetById,
} from '@/services/apis/gen/queries';
import SettingTarget from '@/pages/targets/setting-target';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

const baseTarget: Target = {
  id: 'target-1',
  value: 'example.com',
  type: 'DOMAIN',
  status: 'completed',
  totalAssetServices: 5,
  lastDiscoveredAt: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  scanSchedule: 'disabled',
  scanWindowStart: null,
  scanWindowEnd: null,
  scanWindowTimezone: null,
  scanWindowDays: null,
};

const savedTarget: Target = {
  ...baseTarget,
  scanWindowStart: '22:00',
  scanWindowEnd: '06:00',
  scanWindowTimezone: 'America/Chicago',
  scanWindowDays: null,
};

function TargetSettingsHarness() {
  const { data: target, refetch } = useTargetsControllerGetTargetById(
    baseTarget.id,
    {
      query: { enabled: true },
    },
  );

  if (!target) {
    return null;
  }

  return <SettingTarget target={target} refetch={refetch} />;
}

describe('Target settings', () => {
  it('uses the saved scan window result when settings reopen before the parent target refreshes', async () => {
    const user = userEvent.setup();

    server.use(
      http.patch('/api/targets/:id', () => {
        return HttpResponse.json(savedTarget);
      }),
    );

    renderWithProviders(
      <SettingTarget target={baseTarget} refetch={() => undefined} />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    await user.click(screen.getAllByRole('button')[0]);
    await user.click(
      screen.getByRole('switch', { name: /enable scan window/i }),
    );
    await user.click(screen.getByRole('button', { name: /save scan window/i }));

    await user.click(screen.getByRole('button', { name: /close/i }));
    await user.click(screen.getAllByRole('button')[0]);

    expect(
      screen.getByRole('switch', { name: /enable scan window/i }),
    ).toBeChecked();
  });

  it('keeps the scan window enabled after saving, closing, and reopening settings', async () => {
    const user = userEvent.setup();
    let patchedBody: unknown;

    server.use(
      http.get('/api/targets/:id', () => {
        return HttpResponse.json(baseTarget);
      }),
      http.patch('/api/targets/:id', async ({ request }) => {
        patchedBody = await request.json();
        return HttpResponse.json(savedTarget);
      }),
    );

    const { queryClient } = renderWithProviders(<TargetSettingsHarness />);

    await waitFor(() => {
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    await user.click(screen.getAllByRole('button')[0]);
    await user.click(
      screen.getByRole('switch', { name: /enable scan window/i }),
    );
    await user.click(screen.getByRole('button', { name: /save scan window/i }));

    await waitFor(() => {
      expect(patchedBody).toMatchObject({
        scanWindowStart: '22:00',
        scanWindowEnd: '06:00',
      });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData(
          getTargetsControllerGetTargetByIdQueryKey(baseTarget.id),
        ),
      ).toMatchObject({
        scanWindowStart: '22:00',
        scanWindowEnd: '06:00',
      });
    });

    await user.click(screen.getByRole('button', { name: /close/i }));
    await user.click(screen.getAllByRole('button')[0]);

    expect(
      screen.getByRole('switch', { name: /enable scan window/i }),
    ).toBeChecked();
  });

  it('disables the persisted scan window when the switch is turned off', async () => {
    const user = userEvent.setup();
    let patchedBody: unknown;

    server.use(
      http.patch('/api/targets/:id', async ({ request }) => {
        patchedBody = await request.json();
        return HttpResponse.json(baseTarget);
      }),
    );

    renderWithProviders(
      <SettingTarget target={savedTarget} refetch={() => undefined} />,
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    await user.click(screen.getAllByRole('button')[0]);

    const scanWindowSwitch = screen.getByRole('switch', {
      name: /enable scan window/i,
    });

    expect(scanWindowSwitch).toBeChecked();

    await user.click(scanWindowSwitch);

    await waitFor(() => {
      expect(patchedBody).toMatchObject({
        scanWindowStart: null,
        scanWindowEnd: null,
        scanWindowTimezone: null,
        scanWindowDays: null,
      });
    });

    expect(
      screen.queryByRole('button', { name: /disable scan window/i }),
    ).not.toBeInTheDocument();
  });
});
