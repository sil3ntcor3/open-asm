import Marketplace from '@/pages/tools/components/marketplace';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getManyTools: vi.fn(() => ({ data: undefined, isLoading: true })),
  checkForUpdates: vi.fn(),
}));

vi.mock('@/hooks/useWorkspaceSelector', () => ({
  useWorkspaceState: () => ({
    state: { selectedWorkspaceId: 'workspace-1' },
  }),
}));

vi.mock('@/services/apis/gen/queries', () => ({
  getToolsControllerGetManyToolsQueryKey: () => ['/api/tools', {}],
  useToolsControllerGetManyTools: mocks.getManyTools,
  useToolsControllerCheckForUpdates: () => ({
    mutate: mocks.checkForUpdates,
    isPending: false,
  }),
  UserRole: { admin: 'admin' },
}));

vi.mock('@/utils/authClient', () => ({
  useSession: () => ({ data: { user: { role: 'admin' } } }),
}));

vi.mock('@/pages/tools/tools-list', () => ({
  default: () => <div>Tools list</div>,
}));

vi.mock('@/pages/tools/components/tool-install-button', () => ({
  default: () => <button>Install</button>,
}));

describe('Tools marketplace query isolation', () => {
  beforeEach(() => {
    mocks.getManyTools.mockClear();
    mocks.checkForUpdates.mockClear();
  });

  it('uses an endpoint-specific cache key scoped to the selected workspace', async () => {
    renderWithProviders(<Marketplace />);

    await waitFor(() => {
      expect(mocks.getManyTools).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          query: expect.objectContaining({
            queryKey: ['/api/tools', {}, 'workspace-1'],
          }),
        }),
      );
    });
  });

  it('lets an administrator check release channels without installing updates', async () => {
    const { user } = renderWithProviders(<Marketplace />);

    await user.click(
      await screen.findByRole('button', { name: 'Check for updates' }),
    );

    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
