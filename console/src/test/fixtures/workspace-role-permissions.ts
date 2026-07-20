import type { WorkspaceRolePermissionsResponseDto } from '@/services/apis/gen/queries';

export const workspaceRolePermissionsFixture: WorkspaceRolePermissionsResponseDto =
  {
    actions: [
      {
        action: 'workspace.read',
        label: 'View workspace',
        description: 'View workspace inventory, findings, reports, and status.',
        category: 'Workspace',
      },
      {
        action: 'workspace.manage',
        label: 'Manage workspace',
        description: 'Update, archive, or delete the workspace.',
        category: 'Workspace',
      },
      {
        action: 'member.manage',
        label: 'Manage members',
        description: 'Add, remove, and assign roles to workspace members.',
        category: 'Workspace',
      },
      {
        action: 'target.create',
        label: 'Create targets',
        description: 'Register domains, IP addresses, and CIDR targets.',
        category: 'Targets and scans',
      },
      {
        action: 'target.manage',
        label: 'Manage targets',
        description: 'Update or remove targets and change asset state.',
        category: 'Targets and scans',
      },
      {
        action: 'scan.execute',
        label: 'Run scans',
        description: 'Start, pause, resume, cancel, and rerun discovery jobs.',
        category: 'Targets and scans',
      },
      {
        action: 'finding.triage',
        label: 'Triage findings',
        description:
          'Analyze, dismiss, reopen, and annotate security findings.',
        category: 'Findings and reports',
      },
      {
        action: 'report.manage',
        label: 'Manage reports',
        description: 'Generate and delete workspace reports.',
        category: 'Findings and reports',
      },
      {
        action: 'secret.manage',
        label: 'Manage secrets',
        description: 'View or rotate workspace and integration credentials.',
        category: 'Security administration',
      },
      {
        action: 'agent.use',
        label: 'Use AI agent',
        description: 'Use workspace AI conversations and agent capabilities.',
        category: 'AI agent',
      },
      {
        action: 'agent.manage',
        label: 'Manage AI agent',
        description:
          'Configure models, MCP servers, skills, and agent settings.',
        category: 'AI agent',
      },
      {
        action: 'worker.read',
        label: 'View workers',
        description: 'View worker availability, capabilities, and health.',
        category: 'Workers and tools',
      },
      {
        action: 'worker.manage',
        label: 'Manage workers',
        description:
          'Change worker controls and manage internal worker networks.',
        category: 'Workers and tools',
      },
      {
        action: 'tool.manage',
        label: 'Manage tools',
        description: 'Create, install, uninstall, and update scanning tools.',
        category: 'Workers and tools',
      },
      {
        action: 'template.manage',
        label: 'Manage templates',
        description: 'Manage scan templates and workflow definitions.',
        category: 'Workers and tools',
      },
    ],
    roles: [
      {
        role: 'viewer',
        label: 'Viewer',
        description: 'Read-only access to workspace data and worker status.',
        permissions: ['workspace.read', 'worker.read'],
      },
      {
        role: 'analyst',
        label: 'Analyst',
        description: 'Creates targets, triages findings, and produces reports.',
        permissions: [
          'workspace.read',
          'target.create',
          'finding.triage',
          'report.manage',
          'agent.use',
          'worker.read',
        ],
      },
      {
        role: 'operator',
        label: 'Operator',
        description: 'Manages targets and operates approved discovery jobs.',
        permissions: [
          'workspace.read',
          'target.create',
          'target.manage',
          'scan.execute',
          'finding.triage',
          'report.manage',
          'agent.use',
          'worker.read',
        ],
      },
      {
        role: 'security_admin',
        label: 'Security Administrator',
        description: 'Controls scans, workers, tools, templates, and secrets.',
        permissions: [
          'workspace.read',
          'secret.manage',
          'scan.execute',
          'finding.triage',
          'report.manage',
          'agent.use',
          'agent.manage',
          'worker.read',
          'worker.manage',
          'tool.manage',
          'template.manage',
        ],
      },
      {
        role: 'owner',
        label: 'Owner',
        description:
          'Owns workspace lifecycle and membership and can maintain target scope, but does not implicitly receive scan or worker-control permission.',
        permissions: [
          'workspace.read',
          'workspace.manage',
          'member.manage',
          'target.create',
          'target.manage',
          'finding.triage',
          'report.manage',
          'agent.use',
          'agent.manage',
          'worker.read',
        ],
      },
    ],
  };
