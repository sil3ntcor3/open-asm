import { WorkspaceRole } from '@/common/enums/enum';
import { WorkspaceMembers } from '@/modules/workspaces/entities/workspace-members.entity';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceAction } from './workspace-action.enum';

const ACTION_ROLES: Readonly<
  Record<WorkspaceAction, readonly WorkspaceRole[]>
> = {
  [WorkspaceAction.WORKSPACE_READ]: [
    WorkspaceRole.VIEWER,
    WorkspaceRole.ANALYST,
    WorkspaceRole.OPERATOR,
    WorkspaceRole.SECURITY_ADMIN,
    WorkspaceRole.OWNER,
  ],
  [WorkspaceAction.WORKSPACE_MANAGE]: [WorkspaceRole.OWNER],
  [WorkspaceAction.SECRET_MANAGE]: [
    WorkspaceRole.SECURITY_ADMIN,
    WorkspaceRole.OWNER,
  ],
  [WorkspaceAction.TARGET_CREATE]: [
    WorkspaceRole.ANALYST,
    WorkspaceRole.OPERATOR,
  ],
  [WorkspaceAction.TARGET_MANAGE]: [WorkspaceRole.OPERATOR],
  [WorkspaceAction.SCAN_EXECUTE]: [
    WorkspaceRole.OPERATOR,
    WorkspaceRole.SECURITY_ADMIN,
  ],
  [WorkspaceAction.FINDING_TRIAGE]: [
    WorkspaceRole.ANALYST,
    WorkspaceRole.OPERATOR,
    WorkspaceRole.SECURITY_ADMIN,
  ],
  [WorkspaceAction.REPORT_MANAGE]: [
    WorkspaceRole.ANALYST,
    WorkspaceRole.OPERATOR,
    WorkspaceRole.SECURITY_ADMIN,
    WorkspaceRole.OWNER,
  ],
  [WorkspaceAction.AGENT_USE]: [
    WorkspaceRole.ANALYST,
    WorkspaceRole.OPERATOR,
    WorkspaceRole.SECURITY_ADMIN,
    WorkspaceRole.OWNER,
  ],
  [WorkspaceAction.AGENT_MANAGE]: [
    WorkspaceRole.SECURITY_ADMIN,
    WorkspaceRole.OWNER,
  ],
  [WorkspaceAction.MEMBER_MANAGE]: [WorkspaceRole.OWNER],
  [WorkspaceAction.WORKER_READ]: [
    WorkspaceRole.VIEWER,
    WorkspaceRole.ANALYST,
    WorkspaceRole.OPERATOR,
    WorkspaceRole.SECURITY_ADMIN,
    WorkspaceRole.OWNER,
  ],
  [WorkspaceAction.WORKER_MANAGE]: [WorkspaceRole.SECURITY_ADMIN],
  [WorkspaceAction.TOOL_MANAGE]: [WorkspaceRole.SECURITY_ADMIN],
  [WorkspaceAction.TEMPLATE_MANAGE]: [WorkspaceRole.SECURITY_ADMIN],
};

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

    if (!membership || !ACTION_ROLES[action].includes(membership.role)) {
      throw new ForbiddenException('Workspace action denied');
    }
  }
}
