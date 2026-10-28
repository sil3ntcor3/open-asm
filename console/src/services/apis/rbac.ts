import { orvalClient } from './axios-client';

export type PlatformRole = 'admin' | 'user';

export type WorkspaceAction =
  | 'workspace.read'
  | 'workspace.manage'
  | 'member.manage'
  | 'role.manage'
  | 'target.create'
  | 'target.manage'
  | 'scan.execute'
  | 'finding.triage'
  | 'report.manage'
  | 'secret.manage'
  | 'agent.use'
  | 'agent.manage'
  | 'worker.read'
  | 'worker.manage'
  | 'tool.manage'
  | 'template.manage';

export interface WorkspaceRole {
  id: string;
  key: 'viewer' | 'analyst' | 'operator' | 'security_admin' | 'owner' | null;
  name: string;
  description: string;
  protected: boolean;
  permissions: WorkspaceAction[];
}

export interface WorkspaceMember {
  id: string;
  name: string;
  image: string | null;
  roleId: string;
  roleKey: WorkspaceRole['key'];
  roleName: string;
  roleProtected: boolean;
}

export interface WorkspaceAssignment {
  workspaceId: string;
  roleId: string;
}

export interface ProvisionPlatformUser {
  name: string;
  email: string;
  password: string;
  platformRole: PlatformRole;
  workspaceAssignments: WorkspaceAssignment[];
}

export interface UserWorkspaceAccess {
  workspaceId: string;
  workspaceName: string;
  roleId: string | null;
  roleKey: WorkspaceRole['key'];
  roleName: string;
  roleProtected: boolean;
  accessSource: 'membership' | 'platform_admin';
}

export const rbacKeys = {
  roles: (workspaceId: string) => ['workspace-roles', workspaceId] as const,
  members: (workspaceId: string) => ['workspace-members', workspaceId] as const,
  userAccess: (userId: string) => ['user-workspace-access', userId] as const,
};

export const getWorkspaceRoles = (workspaceId: string) =>
  orvalClient<WorkspaceRole[]>({
    url: `/api/workspaces/${workspaceId}/roles`,
    method: 'GET',
  });

export const createWorkspaceRole = (
  workspaceId: string,
  data: Pick<WorkspaceRole, 'name' | 'description' | 'permissions'>,
) =>
  orvalClient<WorkspaceRole>({
    url: `/api/workspaces/${workspaceId}/roles`,
    method: 'POST',
    data,
  });

export const updateWorkspaceRole = (
  workspaceId: string,
  roleId: string,
  data: Partial<Pick<WorkspaceRole, 'name' | 'description' | 'permissions'>>,
) =>
  orvalClient<WorkspaceRole>({
    url: `/api/workspaces/${workspaceId}/roles/${roleId}`,
    method: 'PATCH',
    data,
  });

export const deleteWorkspaceRole = (workspaceId: string, roleId: string) =>
  orvalClient<{ message: string }>({
    url: `/api/workspaces/${workspaceId}/roles/${roleId}`,
    method: 'DELETE',
  });

export const getWorkspaceMembers = (workspaceId: string) =>
  orvalClient<WorkspaceMember[]>({
    url: `/api/workspaces/${workspaceId}/members`,
    method: 'GET',
  });

export const addWorkspaceMember = (
  workspaceId: string,
  data: { email: string; roleId: string },
) =>
  orvalClient<WorkspaceMember>({
    url: `/api/workspaces/${workspaceId}/members`,
    method: 'POST',
    data,
  });

export const updateWorkspaceMemberRole = (
  workspaceId: string,
  userId: string,
  roleId: string,
) =>
  orvalClient<WorkspaceMember>({
    url: `/api/workspaces/${workspaceId}/members/${userId}`,
    method: 'PATCH',
    data: { roleId },
  });

export const removeWorkspaceMember = (
  workspaceId: string,
  userId: string,
) =>
  orvalClient<{ message: string }>({
    url: `/api/workspaces/${workspaceId}/members/${userId}`,
    method: 'DELETE',
  });

export const provisionPlatformUser = (data: ProvisionPlatformUser) =>
  orvalClient<{ id: string; workspaceAssignments: number }>({
    url: '/api/users',
    method: 'POST',
    data,
  });

export const getUserWorkspaceAccess = (userId: string) =>
  orvalClient<UserWorkspaceAccess[]>({
    url: `/api/users/${userId}/workspace-access`,
    method: 'GET',
  });

export const setPlatformRole = (userId: string, role: PlatformRole) =>
  orvalClient<{ message: string }>({
    url: `/api/users/${userId}/platform-role`,
    method: 'PATCH',
    data: { role },
  });

export const setUserBanned = (userId: string, banned: boolean) =>
  orvalClient<{ message: string }>({
    url: `/api/users/${userId}/banned`,
    method: 'PATCH',
    data: { banned },
  });

export const removePlatformUser = (userId: string) =>
  orvalClient<{ message: string }>({
    url: `/api/users/${userId}`,
    method: 'DELETE',
  });
