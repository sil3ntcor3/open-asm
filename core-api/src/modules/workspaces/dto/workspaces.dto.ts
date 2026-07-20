import { GetManyBaseQueryParams } from '@/common/dtos/get-many-base.dto';
import { WorkspaceRole } from '@/common/enums/enum';
import { WorkspaceAction } from '@/common/authorization/workspace-action.enum';
import { ApiProperty, PartialType, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
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

  @ApiProperty({ type: String, nullable: true })
  roleId: string | null;

  @ApiProperty({ enum: WorkspaceRole, nullable: true })
  roleKey: WorkspaceRole | null;

  @ApiProperty()
  roleName: string;

  @ApiProperty({ enum: ['membership', 'platform_admin'] })
  accessSource: 'membership' | 'platform_admin';
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

export class AddWorkspaceMemberDto {
  @ApiProperty({ description: 'Existing user email address' })
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'Protected or workspace-local custom role ID',
  })
  @IsUUID()
  roleId: string;
}

export class UpdateWorkspaceMemberRoleDto {
  @ApiProperty({
    description: 'Protected or workspace-local custom role ID',
  })
  @IsUUID()
  roleId: string;
}

export class WorkspaceMemberParamsDto {
  @ApiProperty({ description: 'Workspace ID' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'User ID' })
  @IsUUID()
  userId: string;
}

export class WorkspaceRoleParamsDto {
  @ApiProperty({ description: 'Workspace ID' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Workspace role ID' })
  @IsUUID()
  roleId: string;
}

export class WorkspaceMemberResponseDto {
  @ApiProperty({ description: 'User ID' })
  id: string;

  @ApiProperty({ description: 'Display name' })
  name: string;

  @ApiProperty({ description: 'Profile image', type: String, nullable: true })
  image: string | null;

  @ApiProperty()
  roleId: string;

  @ApiProperty({ enum: WorkspaceRole, nullable: true })
  roleKey: WorkspaceRole | null;

  @ApiProperty()
  roleName: string;

  @ApiProperty()
  roleProtected: boolean;
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

export class CreateWorkspaceRoleDto {
  @ApiProperty({ minLength: 2, maxLength: 50 })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @ApiProperty({ required: false, default: '' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @ApiProperty({ enum: WorkspaceAction, isArray: true })
  @IsArray()
  @IsEnum(WorkspaceAction, { each: true })
  permissions: WorkspaceAction[];
}

export class UpdateWorkspaceRoleDto extends PartialType(
  CreateWorkspaceRoleDto,
) {}

export class WorkspaceRoleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: WorkspaceRole, nullable: true })
  key: WorkspaceRole | null;

  @ApiProperty()
  name: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  protected: boolean;

  @ApiProperty({ enum: WorkspaceAction, isArray: true })
  permissions: WorkspaceAction[];
}
