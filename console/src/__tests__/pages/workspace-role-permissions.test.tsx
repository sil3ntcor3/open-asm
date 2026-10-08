import WorkspaceRolePermissions from '@/pages/settings/components/workspace-role-permissions';
import { renderWithProviders, screen } from '@/test/utils';
import { workspaceRolePermissionsFixture } from '@/test/fixtures/workspace-role-permissions';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useWorkspaceSelector', () => ({
  useWorkspaceSelector: () => ({ selectedWorkspace: 'workspace-1' }),
}));

vi.mock('@/hooks/useWorkspacePermissions', () => ({
  useWorkspacePermissions: () => ({ can: () => true }),
}));

vi.mock('@/services/apis/gen/queries', () => ({
  useWorkspacesControllerGetWorkspaceRolePermissions: () => ({
    data: workspaceRolePermissionsFixture,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/services/apis/rbac', async () => {
  const actual = await vi.importActual('@/services/apis/rbac');
  return {
    ...actual,
    getWorkspaceRoles: vi.fn().mockResolvedValue([
      {
        id: 'viewer',
        key: 'viewer',
        name: 'Viewer',
        description: 'Read only',
        protected: true,
        permissions: ['workspace.read'],
      },
      {
        id: 'custom',
        key: null,
        name: 'Discovery Lead',
        description: 'Runs approved discovery',
        protected: false,
        permissions: ['workspace.read', 'scan.execute'],
      },
    ]),
  };
});

describe('WorkspaceRolePermissions', () => {
  it('distinguishes protected defaults from editable custom roles', async () => {
    renderWithProviders(<WorkspaceRolePermissions />);

    expect((await screen.findAllByText('Discovery Lead')).length).toBeGreaterThan(0);
    expect(screen.getByText('Protected default')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create custom role' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Edit Discovery Lead' }),
    ).toBeInTheDocument();
  });

  it('explains that Platform Admin access includes every workspace', async () => {
    renderWithProviders(<WorkspaceRolePermissions />);
    expect(
      await screen.findByText(/full access to every workspace/i),
    ).toBeInTheDocument();
  });
});
