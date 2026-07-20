import { UserContext, WorkspaceId } from '@/common/decorators/app.decorator';
import { WorkspaceAction } from '@/common/authorization/workspace-action.enum';
import { WorkspacePolicy } from '@/common/authorization/workspace-policy.decorator';
import {
  WORKSPACE_ACTION_DEFINITIONS,
  WorkspacePolicyService,
} from '@/common/authorization/workspace-policy.service';
import { Doc } from '@/common/doc/doc.decorator';
import { DefaultMessageResponseDto } from '@/common/dtos/default-message-response.dto';
import { IdQueryParamDto } from '@/common/dtos/id-query-param.dto';
import { UserContextPayload } from '@/common/interfaces/app.interface';
import { GetManyResponseDto } from '@/utils/getManyResponse';
import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { GetWorkspaceConfigsDto } from './dto/get-workspace-configs.dto';
import { UpdateWorkspaceConfigsDto } from './dto/update-workspace-configs.dto';
import {
  AddWorkspaceMemberDto,
  ArchiveWorkspaceDto,
  CreateWorkspaceDto,
  GetApiKeyResponseDto,
  GetManyWorkspacesDto,
  UpdateWorkspaceMemberRoleDto,
  UpdateWorkspaceDto,
  WorkspaceMemberParamsDto,
  WorkspaceMemberResponseDto,
  WorkspaceRolePermissionsResponseDto,
  WorkspaceResponseDto,
} from './dto/workspaces.dto';
import { Workspace } from './entities/workspace.entity';
import { WorkspacesService } from './workspaces.service';

@ApiTags('Workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspacesService: WorkspacesService,
    private readonly workspacePolicyService: WorkspacePolicyService,
  ) {}

  @Doc({
    summary: 'Create Workspace',
    description:
      'Establishes a new isolated security workspace for organizing and managing assets, targets, and vulnerabilities within a dedicated environment.',
    response: {
      serialization: Workspace,
    },
  })
  @Post()
  createWorkspace(
    @Body() dto: CreateWorkspaceDto,
    @UserContext() userContextPayload: UserContextPayload,
  ) {
    return this.workspacesService.createWorkspace(dto, userContextPayload);
  }

  @Doc({
    summary: 'Get workspace API key',
    description:
      'Retrieves the authentication API key for secure access to the specified workspace, enabling programmatic interactions with workspace resources.',
    response: {
      serialization: GetApiKeyResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Get('api-key')
  @WorkspacePolicy(WorkspaceAction.SECRET_MANAGE)
  getWorkspaceApiKey(
    @WorkspaceId() workspaceId: string,
    @UserContext() userContext: UserContextPayload,
  ) {
    return this.workspacesService.getWorkspaceApiKey(workspaceId, userContext);
  }

  @Doc({
    summary: 'Get workspace configs',
    description:
      'Retrieves the configuration settings for a specified workspace, including asset discovery and auto-enablement settings.',
    response: {
      serialization: GetWorkspaceConfigsDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Get('configs')
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  getWorkspaceConfigs(
    @WorkspaceId() workspaceId: string,
    @UserContext() userContext: UserContextPayload,
  ) {
    return this.workspacesService.getWorkspaceConfigs(workspaceId, userContext);
  }

  @Doc({
    summary: 'Update workspace configs',
    description:
      'Updates the configuration settings for a specified workspace, including asset discovery and auto-enablement options.',
    response: {
      serialization: DefaultMessageResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Patch('configs')
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_MANAGE)
  updateWorkspaceConfigs(
    @WorkspaceId() workspaceId: string,
    @Body() dto: UpdateWorkspaceConfigsDto,
    @UserContext() userContext: UserContextPayload,
  ) {
    return this.workspacesService.updateWorkspaceConfigs(
      workspaceId,
      dto,
      userContext,
    );
  }

  @Doc({
    summary: 'Get Workspaces',
    description:
      'Fetches a comprehensive list of security workspaces that the authenticated user has access to, providing multi-tenant organization capabilities.',
    response: {
      serialization: GetManyResponseDto(WorkspaceResponseDto),
    },
  })
  @Get()
  getWorkspaces(
    @Query() query: GetManyWorkspacesDto,
    @UserContext() userContextPayload: UserContextPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.workspacesService.getWorkspaces(
      query,
      userContextPayload,
      req,
      res,
    );
  }

  @Doc({
    summary: 'Get workspace role permissions',
    description:
      'Returns the canonical five-role permission matrix enforced by workspace authorization.',
    response: {
      serialization: WorkspaceRolePermissionsResponseDto,
    },
  })
  @Get('role-permissions')
  getWorkspaceRolePermissions(): WorkspaceRolePermissionsResponseDto {
    return {
      roles: this.workspacePolicyService.getRolePermissions(),
      actions: WORKSPACE_ACTION_DEFINITIONS.map((definition) => ({
        ...definition,
      })),
    };
  }

  @Doc({
    summary: 'Get workspace members',
    description: 'Lists members and their roles in the selected workspace.',
    response: {
      serialization: WorkspaceMemberResponseDto,
      isArray: true,
    },
  })
  @Get(':id/members')
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ, { workspaceParam: 'id' })
  getWorkspaceMembers(@Param() { id }: IdQueryParamDto) {
    return this.workspacesService.getWorkspaceMembers(id);
  }

  @Doc({
    summary: 'Add workspace member',
    description:
      'Adds an existing account to a workspace with an assignable workspace role.',
    response: {
      serialization: WorkspaceMemberResponseDto,
    },
  })
  @Post(':id/members')
  @WorkspacePolicy(WorkspaceAction.MEMBER_MANAGE, { workspaceParam: 'id' })
  addWorkspaceMember(
    @Param() { id }: IdQueryParamDto,
    @Body() dto: AddWorkspaceMemberDto,
  ) {
    return this.workspacesService.addWorkspaceMember(id, dto);
  }

  @Doc({
    summary: 'Update workspace member role',
    description: 'Changes an existing member role. Owner transfer is excluded.',
    response: {
      serialization: WorkspaceMemberResponseDto,
    },
  })
  @Patch(':id/members/:userId')
  @WorkspacePolicy(WorkspaceAction.MEMBER_MANAGE, { workspaceParam: 'id' })
  updateWorkspaceMemberRole(
    @Param() { id, userId }: WorkspaceMemberParamsDto,
    @Body() dto: UpdateWorkspaceMemberRoleDto,
  ) {
    return this.workspacesService.updateWorkspaceMemberRole(id, userId, dto);
  }

  @Doc({
    summary: 'Remove workspace member',
    description: 'Removes a non-owner member from the workspace.',
    response: {
      serialization: DefaultMessageResponseDto,
    },
  })
  @Delete(':id/members/:userId')
  @WorkspacePolicy(WorkspaceAction.MEMBER_MANAGE, { workspaceParam: 'id' })
  removeWorkspaceMember(@Param() { id, userId }: WorkspaceMemberParamsDto) {
    return this.workspacesService.removeWorkspaceMember(id, userId);
  }

  @Doc({
    summary: 'Get Workspace By ID',
    description:
      'Fetches detailed information about a specific security workspace using its unique identifier, including all associated metadata and configuration.',
    response: {
      serialization: Workspace,
    },
  })
  @Get(':id')
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ, { workspaceParam: 'id' })
  async getWorkspaceById(
    @Param() { id }: IdQueryParamDto,
    @UserContext() userContext: UserContextPayload,
  ) {
    const workspace = await this.workspacesService.getWorkspaceById(
      id,
      userContext,
    );

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return workspace;
  }

  @Doc({
    summary: 'Update Workspace',
    description:
      'Modifies the configuration and metadata of an existing security workspace, allowing for dynamic adjustments to workspace settings and properties.',
    response: {
      serialization: DefaultMessageResponseDto,
    },
  })
  @Patch(':id')
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_MANAGE, {
    workspaceParam: 'id',
  })
  updateWorkspace(
    @Param() { id }: IdQueryParamDto,
    @Body() dto: UpdateWorkspaceDto,
    @UserContext() userContext: UserContextPayload,
  ) {
    return this.workspacesService.updateWorkspace(id, dto, userContext);
  }

  @Doc({
    summary: 'Delete Workspace',
    description:
      'Permanently removes a security workspace and all its associated data, including assets, targets, vulnerabilities, and configurations.',
    response: {
      serialization: DefaultMessageResponseDto,
    },
  })
  @Delete(':id')
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_MANAGE, {
    workspaceParam: 'id',
  })
  deleteWorkspace(
    @Param() { id }: IdQueryParamDto,
    @UserContext() userContext: UserContextPayload,
  ) {
    return this.workspacesService.deleteWorkspace(id, userContext);
  }

  @Doc({
    summary: 'Rotate API key',
    description:
      'Generates a new API key for the specified workspace, invalidating the previous key to enhance security and maintain authorized access.',
    response: {
      serialization: GetApiKeyResponseDto,
    },
  })
  @Post(':id/api-key/rotate')
  @WorkspacePolicy(WorkspaceAction.SECRET_MANAGE, { workspaceParam: 'id' })
  rotateApiKey(
    @Param() { id }: IdQueryParamDto,
    @UserContext() userContext: UserContextPayload,
  ) {
    return this.workspacesService.rotateApiKey(id, userContext);
  }

  @Doc({
    summary: 'Archive/Unarchive Workspace',
    description:
      'Changes the archival status of a workspace, allowing for temporary deactivation or reactivation of workspace resources without permanent deletion.',
    response: {
      serialization: DefaultMessageResponseDto,
    },
  })
  @Patch(':id/archived')
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_MANAGE, {
    workspaceParam: 'id',
  })
  makeArchived(
    @Param() { id }: IdQueryParamDto,
    @Body() dto: ArchiveWorkspaceDto,
    @UserContext() userContext: UserContextPayload,
  ) {
    return this.workspacesService.makeArchived(id, dto.isArchived, userContext);
  }
}
