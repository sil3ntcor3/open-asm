import { WorkspaceRole } from '@/common/enums/enum';
import { WorkspaceMembers } from '@/modules/workspaces/entities/workspace-members.entity';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceAction } from './workspace-action.enum';

export type WorkspaceActionDefinition = {
  action: WorkspaceAction;
  label: string;
  description: string;
  category: string;
};

export type WorkspaceRoleDefinition = {
  role: WorkspaceRole;
  label: string;
  description: string;
  permissions: readonly WorkspaceAction[];
};

export const WORKSPACE_ACTION_DEFINITIONS: readonly WorkspaceActionDefinition[] =
  [
    {
      action: WorkspaceAction.WORKSPACE_READ,
      label: 'View workspace',
      description: 'View workspace inventory, findings, reports, and status.',
      category: 'Workspace',
    },
    {
      action: WorkspaceAction.WORKSPACE_MANAGE,
      label: 'Manage workspace',
      description: 'Update, archive, or delete the workspace.',
      category: 'Workspace',
    },
    {
      action: WorkspaceAction.MEMBER_MANAGE,
      label: 'Manage members',
      description: 'Add, remove, and assign roles to workspace members.',
      category: 'Workspace',
    },
    {
      action: WorkspaceAction.TARGET_CREATE,
      label: 'Create targets',
      description: 'Register domains, IP addresses, and CIDR targets.',
      category: 'Targets and scans',
    },
    {
      action: WorkspaceAction.TARGET_MANAGE,
      label: 'Manage targets',
      description: 'Update or remove targets and change asset state.',
      category: 'Targets and scans',
    },
    {
      action: WorkspaceAction.SCAN_EXECUTE,
      label: 'Run scans',
      description: 'Start, pause, resume, cancel, and rerun discovery jobs.',
      category: 'Targets and scans',
    },
    {
      action: WorkspaceAction.FINDING_TRIAGE,
      label: 'Triage findings',
      description: 'Analyze, dismiss, reopen, and annotate security findings.',
      category: 'Findings and reports',
    },
    {
      action: WorkspaceAction.REPORT_MANAGE,
      label: 'Manage reports',
      description: 'Generate and delete workspace reports.',
      category: 'Findings and reports',
    },
    {
      action: WorkspaceAction.SECRET_MANAGE,
      label: 'Manage secrets',
      description: 'View or rotate workspace and integration credentials.',
      category: 'Security administration',
    },
    {
      action: WorkspaceAction.AGENT_USE,
      label: 'Use AI agent',
      description: 'Use workspace AI conversations and agent capabilities.',
      category: 'AI agent',
    },
    {
      action: WorkspaceAction.AGENT_MANAGE,
      label: 'Manage AI agent',
      description: 'Configure models, MCP servers, skills, and agent settings.',
      category: 'AI agent',
    },
    {
      action: WorkspaceAction.WORKER_READ,
      label: 'View workers',
      description: 'View worker availability, capabilities, and health.',
      category: 'Workers and tools',
    },
    {
      action: WorkspaceAction.WORKER_MANAGE,
      label: 'Manage workers',
      description:
        'Change worker controls and manage internal worker networks.',
      category: 'Workers and tools',
    },
    {
      action: WorkspaceAction.TOOL_MANAGE,
      label: 'Manage tools',
      description: 'Create, install, uninstall, and update scanning tools.',
      category: 'Workers and tools',
    },
    {
      action: WorkspaceAction.TEMPLATE_MANAGE,
      label: 'Manage templates',
      description: 'Manage scan templates and workflow definitions.',
      category: 'Workers and tools',
    },
  ] as const;

export const WORKSPACE_ROLE_PERMISSIONS: Readonly<
  Record<WorkspaceRole, readonly WorkspaceAction[]>
> = {
  [WorkspaceRole.VIEWER]: [
    WorkspaceAction.WORKSPACE_READ,
    WorkspaceAction.WORKER_READ,
  ],
  [WorkspaceRole.ANALYST]: [
    WorkspaceAction.WORKSPACE_READ,
    WorkspaceAction.TARGET_CREATE,
    WorkspaceAction.FINDING_TRIAGE,
    WorkspaceAction.REPORT_MANAGE,
    WorkspaceAction.AGENT_USE,
    WorkspaceAction.WORKER_READ,
  ],
  [WorkspaceRole.OPERATOR]: [
    WorkspaceAction.WORKSPACE_READ,
    WorkspaceAction.TARGET_CREATE,
    WorkspaceAction.TARGET_MANAGE,
    WorkspaceAction.SCAN_EXECUTE,
    WorkspaceAction.FINDING_TRIAGE,
    WorkspaceAction.REPORT_MANAGE,
    WorkspaceAction.AGENT_USE,
    WorkspaceAction.WORKER_READ,
  ],
  [WorkspaceRole.SECURITY_ADMIN]: [
    WorkspaceAction.WORKSPACE_READ,
    WorkspaceAction.SECRET_MANAGE,
    WorkspaceAction.SCAN_EXECUTE,
    WorkspaceAction.FINDING_TRIAGE,
    WorkspaceAction.REPORT_MANAGE,
    WorkspaceAction.AGENT_USE,
    WorkspaceAction.AGENT_MANAGE,
    WorkspaceAction.WORKER_READ,
    WorkspaceAction.WORKER_MANAGE,
    WorkspaceAction.TOOL_MANAGE,
    WorkspaceAction.TEMPLATE_MANAGE,
  ],
  [WorkspaceRole.OWNER]: [
    WorkspaceAction.WORKSPACE_READ,
    WorkspaceAction.WORKSPACE_MANAGE,
    WorkspaceAction.MEMBER_MANAGE,
    WorkspaceAction.TARGET_CREATE,
    WorkspaceAction.TARGET_MANAGE,
    WorkspaceAction.FINDING_TRIAGE,
    WorkspaceAction.REPORT_MANAGE,
    WorkspaceAction.AGENT_USE,
    WorkspaceAction.AGENT_MANAGE,
    WorkspaceAction.WORKER_READ,
  ],
};

export const WORKSPACE_ROLE_DEFINITIONS: readonly WorkspaceRoleDefinition[] = [
  {
    role: WorkspaceRole.VIEWER,
    label: 'Viewer',
    description: 'Read-only access to workspace data and worker status.',
    permissions: WORKSPACE_ROLE_PERMISSIONS[WorkspaceRole.VIEWER],
  },
  {
    role: WorkspaceRole.ANALYST,
    label: 'Analyst',
    description: 'Creates targets, triages findings, and produces reports.',
    permissions: WORKSPACE_ROLE_PERMISSIONS[WorkspaceRole.ANALYST],
  },
  {
    role: WorkspaceRole.OPERATOR,
    label: 'Operator',
    description: 'Manages targets and operates approved discovery jobs.',
    permissions: WORKSPACE_ROLE_PERMISSIONS[WorkspaceRole.OPERATOR],
  },
  {
    role: WorkspaceRole.SECURITY_ADMIN,
    label: 'Security Administrator',
    description: 'Controls scans, workers, tools, templates, and secrets.',
    permissions: WORKSPACE_ROLE_PERMISSIONS[WorkspaceRole.SECURITY_ADMIN],
  },
  {
    role: WorkspaceRole.OWNER,
    label: 'Owner',
    description:
      'Owns workspace lifecycle and membership and can maintain target scope, but does not implicitly receive scan or worker-control permission.',
    permissions: WORKSPACE_ROLE_PERMISSIONS[WorkspaceRole.OWNER],
  },
] as const;

@Injectable()
export class WorkspacePolicyService {
  constructor(
    @InjectRepository(WorkspaceMembers)
    private readonly workspaceMembersRepository: Repository<WorkspaceMembers>,
  ) {}

  /**
   * Enforces one workspace action against the actor's persisted membership.
   */
  async assertAllowed(
    userId: string,
    workspaceId: string,
    action: WorkspaceAction,
  ): Promise<void> {
    const membership = await this.workspaceMembersRepository.findOne({
      where: {
        workspace: { id: workspaceId },
        user: { id: userId },
      },
    });

    if (
      !membership ||
      !WORKSPACE_ROLE_PERMISSIONS[membership.role].includes(action)
    ) {
      throw new ForbiddenException('Workspace action denied');
    }
  }

  /** Returns the canonical role matrix used by authorization checks. */
  getRolePermissions(): WorkspaceRoleDefinition[] {
    return WORKSPACE_ROLE_DEFINITIONS.map((definition) => ({
      ...definition,
      permissions: [...definition.permissions],
    }));
  }
}
