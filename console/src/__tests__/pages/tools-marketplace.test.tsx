import Marketplace from '@/pages/tools/components/marketplace';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getManyTools: vi.fn(() => ({ data: undefined, isLoading: true })),
}));

vi.mock('@/hooks/useWorkspaceSelector', () => ({
  useWorkspaceState: () => ({
    state: { selectedWorkspaceId: 'workspace-1' },
  }),
}));

vi.mock('@/services/apis/gen/queries', () => ({
  getToolsControllerGetManyToolsQueryKey: () => ['/api/tools', {}],
  useToolsControllerGetManyTools: mocks.getManyTools,
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
  });

  it('uses an endpoint-specific cache key scoped to the selected workspace', () => {
    render(<Marketplace />);

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
