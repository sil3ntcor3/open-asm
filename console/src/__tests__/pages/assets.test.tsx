import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import Assets from '@/pages/assets/assets';
import userEvent from '@testing-library/user-event';

const mockWorkspaces = [{ id: 'ws-1', name: 'Test Workspace' }];
const mockExportAssets = vi.hoisted(() => vi.fn());
// The Assets page defaults to the Hosts tab, which lists every discovered host
// (including subdomains with no live service yet).
const mockHostAssets = [
  { host: 'example.com', assetCount: 2 },
  { host: 'api.example.com', assetCount: 0 },
];
const mockAssets = [
  {
    id: 'asset-1',
    value: 'https://example.com',
    targetId: 'target-1',
    isPrimary: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    tags: [],
    ipAddresses: ['93.184.216.34'],
    httpResponses: null,
    isEnabled: true,
  },
  {
    id: 'asset-2',
    value: 'https://api.example.com',
    targetId: 'target-1',
    isPrimary: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    tags: [],
    ipAddresses: ['93.184.216.34'],
    httpResponses: null,
    isEnabled: true,
  },
];

vi.mock('@/hooks/useWorkspaceSelector', () => ({
  useWorkspaceSelector: () => ({
    workspaces: mockWorkspaces,
    selectedWorkspace: 'ws-1',
    isLoading: false,
  }),
}));

vi.mock('@/services/apis/gen/queries', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/services/apis/gen/queries')>();
  return {
    ...actual,
    assetsControllerExportAssets: mockExportAssets,
    useAssetsControllerGetAssetsInWorkspace: () => ({
      data: { data: mockAssets, total: mockAssets.length },
      isLoading: false,
      refetch: vi.fn(),
    }),
    useAssetsControllerGetIpAssetsInfinite: () => ({
      data: [],
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetching: false,
    }),
    useAssetsControllerGetPortAssetsInfinite: () => ({
      data: [],
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetching: false,
    }),
    useAssetsControllerGetHostAssetsInfinite: () => ({
      data: [],
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetching: false,
    }),
    useAssetsControllerGetHostAssets: () => ({
      data: { data: mockHostAssets, total: mockHostAssets.length },
      isLoading: false,
      refetch: vi.fn(),
    }),
    useAssetsControllerGetTechnologyAssetsInfinite: () => ({
      data: [],
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetching: false,
    }),
    useAssetsControllerGetStatusCodeAssetsInfinite: () => ({
      data: [],
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetching: false,
    }),
    useAssetsControllerGetTlsAssetsInfinite: () => ({
      data: [],
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetching: false,
    }),
  };
});

describe('Assets Page', () => {
  beforeEach(() => {
    mockExportAssets.mockReset();
    mockExportAssets.mockResolvedValue(new Blob(['export']));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:asset-export');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      () => undefined,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders discovered hosts on the default Hosts tab', async () => {
    renderWithProviders(<Assets />);

    await waitFor(() => {
      expect(screen.getByText('Assets')).toBeInTheDocument();
      // api.example.com has assetCount 0 (no live service) yet must still be
      // listed — that visibility is the core of the discovery fix.
      expect(screen.getByText('example.com')).toBeInTheDocument();
      expect(screen.getByText('api.example.com')).toBeInTheDocument();
    });
  });

  it('offers CSV and Excel exports for the active assets view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Assets />);

    await user.click(await screen.findByRole('button', { name: /export/i }));

    expect(
      await screen.findByRole('menuitem', { name: /csv \(\.csv\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /excel \(\.xlsx\)/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: /csv \(\.csv\)/i }));

    await waitFor(() => {
      expect(mockExportAssets).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'csv', view: 'host' }),
      );
    });
  });
});
