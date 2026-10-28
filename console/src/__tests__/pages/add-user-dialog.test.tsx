import { AddUserDialog } from '@/pages/admin/add-user-dialog';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { provisionPlatformUser, getWorkspaceRoles } = vi.hoisted(() => ({
  provisionPlatformUser: vi.fn(),
  getWorkspaceRoles: vi.fn(),
}));

vi.mock('@/hooks/useWorkspaceSelector', () => ({
  useWorkspaceSelector: vi.fn(() => ({
    selectedWorkspace: '93db9a95-c409-4db4-8ce4-10070eced20c',
    workspaces: [
      {
        id: '93db9a95-c409-4db4-8ce4-10070eced20c',
        name: 'default',
        roleId: 'owner-role',
        roleKey: 'owner',
        accessSource: 'membership',
      },
    ],
  })),
}));

vi.mock('@/services/apis/rbac', async () => {
  const actual = await vi.importActual('@/services/apis/rbac');
  return {
    ...actual,
    provisionPlatformUser,
    getWorkspaceRoles,
  };
});

describe('AddUserDialog', () => {
  beforeEach(() => {
    provisionPlatformUser.mockReset();
    getWorkspaceRoles.mockReset();
    provisionPlatformUser.mockResolvedValue({
      id: '499f52b4-3e69-4d4d-bc84-02948e6fc76f',
      workspaceAssignments: 1,
    });
    getWorkspaceRoles.mockResolvedValue([
      {
        id: 'viewer-role',
        key: 'viewer',
        name: 'Viewer',
        description: 'Read-only access.',
        protected: true,
        permissions: ['workspace.read'],
      },
    ]);
  });

  it('guides admins through identity, workspace access, and review', async () => {
    const { user } = renderWithProviders(<AddUserDialog />);

    await user.click(await screen.findByRole('button', { name: 'Add' }));
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('Platform role')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'New User');
    await user.type(
      screen.getByRole('textbox', { name: 'Email' }),
      'new-user@example.com',
    );
    await user.type(screen.getByLabelText('Temporary password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Create without workspace access')).toBeVisible();
  });

  it('creates the account and membership in one protected request', async () => {
    const { user } = renderWithProviders(<AddUserDialog />);

    await user.click(await screen.findByRole('button', { name: 'Add' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'New User');
    await user.type(
      screen.getByRole('textbox', { name: 'Email' }),
      'new-user@example.com',
    );
    await user.type(screen.getByLabelText('Temporary password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(
      screen.getByRole('radio', { name: /^Assign workspace access now/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Create user' }));

    await waitFor(() => {
      expect(provisionPlatformUser).toHaveBeenCalledWith({
        name: 'New User',
        email: 'new-user@example.com',
        password: 'password123',
        platformRole: 'user',
        workspaceAssignments: [
          {
            workspaceId: '93db9a95-c409-4db4-8ce4-10070eced20c',
            roleId: 'viewer-role',
          },
        ],
      });
    });
  });
});
