import { AddUserDialog } from '@/pages/admin/add-user-dialog';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { workspaceRolePermissionsFixture } from '@/test/fixtures/workspace-role-permissions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createUser, addWorkspaceMember } = vi.hoisted(() => ({
  createUser: vi.fn(),
  addWorkspaceMember: vi.fn(),
}));

vi.mock('@/utils/authClient', () => ({
  authClient: {
    admin: {
      createUser,
    },
  },
}));

vi.mock('@/hooks/useWorkspaceSelector', () => ({
  useWorkspaceSelector: vi.fn(() => ({
    selectedWorkspace: '93db9a95-c409-4db4-8ce4-10070eced20c',
    workspaces: [
      {
        id: '93db9a95-c409-4db4-8ce4-10070eced20c',
        name: 'default',
        role: 'owner',
      },
    ],
  })),
}));

vi.mock('@/services/apis/gen/queries', () => ({
  workspacesControllerAddWorkspaceMember: addWorkspaceMember,
  useWorkspacesControllerGetWorkspaceRolePermissions: vi.fn(() => ({
    data: workspaceRolePermissionsFixture,
    isLoading: false,
    isError: false,
  })),
}));

describe('AddUserDialog', () => {
  beforeEach(() => {
    createUser.mockReset();
    addWorkspaceMember.mockReset();
    createUser.mockResolvedValue({
      data: {
        user: {
          id: '499f52b4-3e69-4d4d-bc84-02948e6fc76f',
          name: 'New User',
          email: 'new-user@example.com',
        },
      },
      error: null,
    });
    addWorkspaceMember.mockResolvedValue({
      id: '499f52b4-3e69-4d4d-bc84-02948e6fc76f',
      name: 'New User',
      image: null,
      role: 'viewer',
    });
  });

  it('separates platform access from the five-role workspace model', async () => {
    const { user } = renderWithProviders(<AddUserDialog />);

    await user.click(await screen.findByRole('button', { name: 'Add' }));

    expect(screen.getByText('Platform role')).toBeInTheDocument();
    expect(screen.getByText('Workspace role')).toBeInTheDocument();
    expect(screen.getAllByText('Viewer').length).toBeGreaterThan(0);
  });

  it('adds the newly-created account to the selected workspace', async () => {
    const { user } = renderWithProviders(<AddUserDialog />);

    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'New User');
    await user.type(
      screen.getByRole('textbox', { name: 'Email' }),
      'new-user@example.com',
    );
    await user.type(screen.getByLabelText('Password'), 'a-secure-password');
    await user.click(screen.getByRole('button', { name: 'Create User' }));

    await waitFor(() => {
      expect(addWorkspaceMember).toHaveBeenCalledWith(
        '93db9a95-c409-4db4-8ce4-10070eced20c',
        {
          email: 'new-user@example.com',
          role: 'viewer',
        },
      );
    });
  });
});
