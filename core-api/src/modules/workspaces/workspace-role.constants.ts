import { WorkspaceRole } from '@/common/enums/enum';

export const PROTECTED_WORKSPACE_ROLE_IDS: Readonly<
  Record<WorkspaceRole, string>
> = {
  [WorkspaceRole.VIEWER]: '00000000-0000-4000-8000-000000000001',
  [WorkspaceRole.ANALYST]: '00000000-0000-4000-8000-000000000002',
  [WorkspaceRole.OPERATOR]: '00000000-0000-4000-8000-000000000003',
  [WorkspaceRole.SECURITY_ADMIN]: '00000000-0000-4000-8000-000000000004',
  [WorkspaceRole.OWNER]: '00000000-0000-4000-8000-000000000005',
};

export const NON_DELEGABLE_WORKSPACE_ACTIONS = [
  'role.manage',
] as const;
