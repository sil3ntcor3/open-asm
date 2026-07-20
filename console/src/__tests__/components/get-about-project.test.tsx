import { renderWithProviders, screen, waitFor } from '@/test/utils';
import GetAboutProject from '@/pages/settings/components/get-about-project';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkForUpdates } = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
}));

vi.mock('@/services/apis/gen/queries', () => ({
  useRootControllerGetLatestVersion: vi.fn(() => ({
    data: {
      currentVersion: '0.1.0-dev.42+abc123',
      currentCommit: 'abc123',
      channel: 'dev',
      latestVersion: '0.1.0',
      isLatest: true,
      releaseDate: '2026-07-03T15:37:06Z',
      releaseUrl: 'https://github.com/sil3ntcor3/open-asm/releases/tag/v0.1.0',
      lastCheckedAt: '2026-07-19T14:00:00.000Z',
      notes: 'Release notes',
    },
    isLoading: false,
    isError: false,
  })),
  useRootControllerCheckForUpdates: vi.fn(() => ({
    mutate: checkForUpdates,
    isPending: false,
  })),
  getRootControllerGetLatestVersionQueryKey: vi.fn(() => [
    '/api/version/latest',
  ]),
}));

describe('GetAboutProject', () => {
  beforeEach(() => {
    checkForUpdates.mockReset();
  });

  it('shows installed build identity and the latest stable release', async () => {
    renderWithProviders(<GetAboutProject />);

    expect(
      await screen.findByText('0.1.0-dev.42+abc123'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Development channel')).toBeInTheDocument();
    expect(
      await screen.findByText('Latest stable release'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View release' })).toHaveAttribute(
      'href',
      'https://github.com/sil3ntcor3/open-asm/releases/tag/v0.1.0',
    );
    expect(screen.getByRole('link', { name: /License/ })).toHaveAttribute(
      'href',
      'https://github.com/sil3ntcor3/open-asm/blob/main/LICENSE',
    );
  });

  it('allows an administrator to run a fresh update check', async () => {
    const { user } = renderWithProviders(<GetAboutProject />);

    await user.click(
      await screen.findByRole('button', { name: 'Check for updates' }),
    );

    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce());
  });
});
