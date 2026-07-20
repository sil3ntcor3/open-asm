export const workspaceRoleOptions = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'operator', label: 'Operator' },
  { value: 'security_admin', label: 'Security Administrator' },
] as const;

export type AssignableWorkspaceRole =
  (typeof workspaceRoleOptions)[number]['value'];

export const workspaceRoleLabels: Record<string, string> = {
  viewer: 'Viewer',
  analyst: 'Analyst',
  operator: 'Operator',
  security_admin: 'Security Administrator',
  owner: 'Owner',
};
