import { getWorkspaceIdFromRequest } from '@/common/decorators/workspace-id.decorator';
import type { RequestWithMetadata } from '@/common/interfaces/app.interface';
import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import {
  WORKSPACE_POLICY_METADATA,
  WorkspacePolicyMetadata,
} from './workspace-policy.decorator';
import { WorkspacePolicyService } from './workspace-policy.service';

@Injectable()
export class WorkspacePolicyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policyService: WorkspacePolicyService,
  ) {}

  /** Resolves the trusted workspace context and enforces route policy. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<WorkspacePolicyMetadata>(
      WORKSPACE_POLICY_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!policy) return true;

    const request = context.switchToHttp().getRequest<RequestWithMetadata>();
    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    const selectedWorkspaceId = getWorkspaceIdFromRequest(request);
    const explicitWorkspaceId = this.getExplicitWorkspaceId(request, policy);
    if (
      (selectedWorkspaceId && !isUUID(selectedWorkspaceId)) ||
      (explicitWorkspaceId && !isUUID(explicitWorkspaceId))
    ) {
      throw new BadRequestException('Workspace id null or invalid');
    }
    if (
      selectedWorkspaceId &&
      explicitWorkspaceId &&
      selectedWorkspaceId !== explicitWorkspaceId
    ) {
      throw new ForbiddenException('Workspace context mismatch');
    }

    const workspaceId = explicitWorkspaceId ?? selectedWorkspaceId;
    if (!workspaceId) {
      throw new BadRequestException('Workspace id null or invalid');
    }

    await this.policyService.assertAllowed(
      { id: userId, role: request.user.role },
      workspaceId,
      policy.action,
    );
    return true;
  }

  private getExplicitWorkspaceId(
    request: RequestWithMetadata,
    policy: WorkspacePolicyMetadata,
  ): string | undefined {
    if (policy.workspaceParam) {
      const value = request.params[policy.workspaceParam];
      return typeof value === 'string' ? value : undefined;
    }
    if (policy.workspaceBody) {
      const body: unknown = request.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return undefined;
      }
      const value = (body as Record<string, unknown>)[policy.workspaceBody];
      return typeof value === 'string' ? value : undefined;
    }
    if (policy.workspaceQuery) {
      const value = request.query[policy.workspaceQuery];
      return typeof value === 'string' ? value : undefined;
    }
    return undefined;
  }
}
