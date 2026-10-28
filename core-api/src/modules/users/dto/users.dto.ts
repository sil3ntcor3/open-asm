import { Role, WorkspaceRole } from '@/common/enums/enum';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class WorkspaceAssignmentDto {
  @ApiProperty()
  @IsUUID()
  workspaceId: string;

  @ApiProperty()
  @IsUUID()
  roleId: string;
}

export class ProvisionPlatformUserDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: [Role.USER, Role.ADMIN] })
  @IsIn([Role.USER, Role.ADMIN])
  platformRole: Role.USER | Role.ADMIN;

  @ApiProperty({ type: [WorkspaceAssignmentDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WorkspaceAssignmentDto)
  workspaceAssignments: WorkspaceAssignmentDto[];
}

export class ProvisionPlatformUserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  workspaceAssignments: number;
}

export class SetPlatformRoleDto {
  @ApiProperty({ enum: [Role.USER, Role.ADMIN] })
  @IsIn([Role.USER, Role.ADMIN])
  role: Role.USER | Role.ADMIN;
}

export class SetUserBannedDto {
  @ApiProperty()
  @IsBoolean()
  banned: boolean;
}

export class UserWorkspaceAccessResponseDto {
  @ApiProperty()
  workspaceId: string;

  @ApiProperty()
  workspaceName: string;

  @ApiProperty({ nullable: true })
  roleId: string | null;

  @ApiProperty({ enum: WorkspaceRole, nullable: true })
  roleKey: WorkspaceRole | null;

  @ApiProperty()
  roleName: string;

  @ApiProperty()
  roleProtected: boolean;

  @ApiProperty({ enum: ['membership', 'platform_admin'] })
  accessSource: 'membership' | 'platform_admin';
}
