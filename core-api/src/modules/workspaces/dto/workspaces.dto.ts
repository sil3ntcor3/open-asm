import { GetManyBaseQueryParams } from '@/common/dtos/get-many-base.dto';
import { WorkspaceRole } from '@/common/enums/enum';
import { WorkspaceAction } from '@/common/authorization/workspace-action.enum';
import { ApiProperty, PartialType, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsUUID } from 'class-validator';
import { Workspace } from '../entities/workspace.entity';

export class CreateWorkspaceDto extends PickType(Workspace, [
  'name',
  'description',
  'archivedAt',
] as const) {}

export class UpdateWorkspaceDto extends PartialType(CreateWorkspaceDto) {}

/**
 * Response DTO for workspace list items with target and member counts.
 * Used for getWorkspaces API to include targetCount and memberCount.
 */
export class WorkspaceResponseDto {
  @ApiProperty({ description: 'Workspace ID' })
  id: string;

  @ApiProperty({ description: 'Workspace name' })
  name: string;

  @ApiProperty({
    description: 'Workspace description',
    required: false,
    nullable: true,
  })
  description?: string | null;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiProperty({
    description: 'Archival timestamp',
    required: false,
    nullable: true,
  })
  archivedAt?: Date | null;

  @ApiProperty({ description: 'Whether asset discovery is enabled' })
  isAssetsDiscovery: boolean;

  @ApiProperty({
    description: 'Whether assets are auto-enabled after discovery',
  })
  isAutoEnableAssetAfterDiscovered: boolean;

  @ApiProperty({ description: 'Owner user ID' })
  ownerId: string;

  @ApiProperty({
    description: 'Number of targets in the workspace',
    example: 10,
  })
  targetCount: number;

  @ApiProperty({
    description: 'Number of members in the workspace',
    example: 5,
  })
  memberCount: number;

  @ApiProperty({
    description: 'Role of the current user in the workspace',
    enum: WorkspaceRole,
    example: 'owner',
  })
  role: WorkspaceRole;
}

export class WorkspaceStatisticsResponseDto {
  totalTargets: number;
  totalAssets: number;
  technologies: string[];
  cnameRecords: string[];
  statusCodes: number[];
}

export class GetApiKeyResponseDto {
  @ApiProperty()
  apiKey: string;
}

export class ArchiveWorkspaceDto {
  @ApiProperty({
    example: true,
    description: 'Whether to archive (true) or unarchive (false) the workspace',
  })
  @IsBoolean()
  isArchived: boolean;
}

export class GetManyWorkspacesDto extends GetManyBaseQueryParams {
  @ApiProperty({
    example: true,
    required: false,
    description: 'Whether to archive (true) or unarchive (false) the workspace',
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  isArchived?: boolean;
}

export const ASSIGNABLE_WORKSPACE_ROLES = [
  WorkspaceRole.VIEWER,
  WorkspaceRole.ANALYST,
  WorkspaceRole.OPERATOR,
  WorkspaceRole.SECURITY_ADMIN,
] as const;

export type AssignableWorkspaceRole =
  (typeof ASSIGNABLE_WORKSPACE_ROLES)[number];

export class AddWorkspaceMemberDto {
  @ApiProperty({ description: 'Existing user email address' })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Role to grant in this workspace',
    enum: ASSIGNABLE_WORKSPACE_ROLES,
  })
  @IsIn(ASSIGNABLE_WORKSPACE_ROLES)
  role: AssignableWorkspaceRole;
}

export class UpdateWorkspaceMemberRoleDto {
  @ApiProperty({
    description: 'New role in this workspace',
    enum: ASSIGNABLE_WORKSPACE_ROLES,
  })
  @IsIn(ASSIGNABLE_WORKSPACE_ROLES)
  role: AssignableWorkspaceRole;
}

export class WorkspaceMemberParamsDto {
  @ApiProperty({ description: 'Workspace ID' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'User ID' })
  @IsUUID()
  userId: string;
}

export class WorkspaceMemberResponseDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiProperty({ description: 'Display name' })
  name: string;

  @ApiProperty({ description: 'Profile image', type: String, nullable: true })
  image: string | null;

  @ApiProperty({ enum: WorkspaceRole })
  role: WorkspaceRole;
}

export class WorkspaceActionDefinitionDto {
  @ApiProperty({ enum: WorkspaceAction })
  action: WorkspaceAction;

  @ApiProperty()
  label: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  category: string;
}

export class WorkspaceRoleDefinitionDto {
  @ApiProperty({ enum: WorkspaceRole })
  role: WorkspaceRole;

  @ApiProperty()
  label: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ enum: WorkspaceAction, isArray: true })
  permissions: readonly WorkspaceAction[];
}

export class WorkspaceRolePermissionsResponseDto {
  @ApiProperty({ type: [WorkspaceRoleDefinitionDto] })
  roles: WorkspaceRoleDefinitionDto[];

  @ApiProperty({ type: [WorkspaceActionDefinitionDto] })
  actions: WorkspaceActionDefinitionDto[];
}
