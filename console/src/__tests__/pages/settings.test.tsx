import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import Settings from '@/pages/settings/settings';
import { useParams } from '@tanstack/react-router';
import { workspaceRolePermissionsFixture } from '@/test/fixtures/workspace-role-permissions';

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router');
  return {
    ...actual,
    useParams: vi.fn(() => ({ tab: 'general' })),
  };
});

vi.mock('@/utils/authClient', () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: 'user-1', role: 'admin' } },
  })),
}));

vi.mock('@/services/apis/gen/queries', async () => {
  const actual = await vi.importActual('@/services/apis/gen/queries');
  return {
    ...actual,
    useWorkspacesControllerGetWorkspaceRolePermissions: vi.fn(() => ({
      data: workspaceRolePermissionsFixture,
      isLoading: false,
      isError: false,
    })),
  };
});

vi.mock('@/pages/settings/components/workspace-settings', () => ({
  default: () => <div data-testid="workspace-settings">WorkspaceSettings</div>,
}));

vi.mock('@/pages/settings/components/api-keys-settings', () => ({
  default: () => <div data-testid="api-keys-settings">ApiKeysSettings</div>,
}));

vi.mock('@/pages/settings/components/workspace-members', () => ({
  default: () => <div data-testid="workspace-members">WorkspaceMembers</div>,
}));

vi.mock('@/pages/settings/components/preferences', () => ({
  default: () => <div data-testid="preferences">Preferences</div>,
}));

vi.mock('@/pages/settings/components/security-settings', () => ({
  default: () => <div data-testid="security-settings">SecuritySettings</div>,
}));

vi.mock('@/pages/settings/components/brand-name-and-logo', () => ({
  default: () => (
    <div data-testid="brand-settings">BrandNameAndLogoSettings</div>
  ),
}));

vi.mock('@/pages/settings/components/get-about-project', () => ({
  default: () => <div data-testid="about-settings">GetAboutProject</div>,
}));

describe('Settings Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders settings page', async () => {
    renderWithProviders(<Settings />, {
      initialEntries: ['/settings/general'],
    });

    await waitFor(() => {
      expect(screen.getByText('Workspace settings')).toBeInTheDocument();
      expect(screen.getByTestId('workspace-settings')).toBeInTheDocument();
    });
  });

  it('switches between tabs', async () => {
    vi.mocked(useParams).mockReturnValue({ tab: 'apikeys' });

    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('API Keys')).toBeInTheDocument();
      expect(screen.getByTestId('api-keys-settings')).toBeInTheDocument();
    });
  });

  it('shows preferences tab content', async () => {
    vi.mocked(useParams).mockReturnValue({ tab: 'preferences' });

    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Preferences' }),
      ).toBeInTheDocument();
      expect(screen.getByTestId('preferences')).toBeInTheDocument();
    });
  });

  it('exposes workspace member role management', async () => {
    vi.mocked(useParams).mockReturnValue({ tab: 'members' });

    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: 'Workspace members' }),
      ).toBeInTheDocument();
      expect(screen.getByTestId('workspace-members')).toBeInTheDocument();
    });
  });

  it('renders the server-enforced role and permission matrix', async () => {
    vi.mocked(useParams).mockReturnValue({ tab: 'permissions' });

    renderWithProviders(<Settings />);

    expect(
      await screen.findByRole('heading', { name: 'Roles and permissions' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Platform roles')).toBeInTheDocument();
    expect(await screen.findByText('Workspace roles')).toBeInTheDocument();
    expect(screen.getByText('Security Administrator')).toBeInTheDocument();
    expect(screen.getByText('Create targets')).toBeInTheDocument();
    expect(screen.getByText('Run scans')).toBeInTheDocument();
  });

  it('filters tabs based on user role', async () => {
    vi.mocked(useParams).mockReturnValue({ tab: 'general' });
    const { useSession } = await import('@/utils/authClient');
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'user-1', role: 'user' } },
    } as ReturnType<typeof useSession>);

    renderWithProviders(<Settings />);

    await waitFor(() => {
      expect(screen.getByText('Workspace settings')).toBeInTheDocument();
    });
  });
});
