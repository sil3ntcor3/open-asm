import { Roles, UserContext } from '@/common/decorators/app.decorator';
import { Doc } from '@/common/doc/doc.decorator';
import { DefaultMessageResponseDto } from '@/common/dtos/default-message-response.dto';
import { IdQueryParamDto } from '@/common/dtos/id-query-param.dto';
import { Role } from '@/common/enums/enum';
import type { UserContextPayload } from '@/common/interfaces/app.interface';
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ProvisionPlatformUserDto,
  ProvisionPlatformUserResponseDto,
  SetPlatformRoleDto,
  SetUserBannedDto,
  UserWorkspaceAccessResponseDto,
} from './dto/users.dto';
import { PlatformUsersService } from './platform-users.service';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
@Roles(Role.ADMIN)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly platformUsersService: PlatformUsersService,
  ) {}

  @Post()
  @Doc<ProvisionPlatformUserResponseDto>({
    summary: 'Create platform user',
    description:
      'Creates a platform account with optional immediate workspace access.',
    response: { serialization: ProvisionPlatformUserResponseDto },
  })
  provisionUser(
    @Body() dto: ProvisionPlatformUserDto,
  ): Promise<ProvisionPlatformUserResponseDto> {
    return this.platformUsersService.provisionUser(dto);
  }

  @Get(':id/workspace-access')
  @Doc<UserWorkspaceAccessResponseDto>({
    summary: 'Get user workspace access',
    description:
      'Lists explicit workspace memberships or inherited platform administrator access.',
    response: {
      serialization: UserWorkspaceAccessResponseDto,
      isArray: true,
    },
  })
  getWorkspaceAccess(
    @Param() { id }: IdQueryParamDto,
  ): Promise<UserWorkspaceAccessResponseDto[]> {
    return this.platformUsersService.getWorkspaceAccess(id);
  }

  @Patch(':id/platform-role')
  @Doc<DefaultMessageResponseDto>({
    summary: 'Set platform role',
    description:
      'Promotes or demotes a platform account while retaining an active administrator.',
    response: { serialization: DefaultMessageResponseDto },
  })
  setPlatformRole(
    @Param() { id }: IdQueryParamDto,
    @Body() dto: SetPlatformRoleDto,
    @UserContext() actor: UserContextPayload,
  ): Promise<DefaultMessageResponseDto> {
    return this.platformUsersService.setPlatformRole(actor.id, id, dto.role);
  }

  @Patch(':id/banned')
  @Doc<DefaultMessageResponseDto>({
    summary: 'Ban or restore platform user',
    description:
      'Changes account availability while retaining an active administrator.',
    response: { serialization: DefaultMessageResponseDto },
  })
  setBanned(
    @Param() { id }: IdQueryParamDto,
    @Body() dto: SetUserBannedDto,
    @UserContext() actor: UserContextPayload,
  ): Promise<DefaultMessageResponseDto> {
    return this.platformUsersService.setBanned(actor.id, id, dto.banned);
  }

  @Delete(':id')
  @Doc<DefaultMessageResponseDto>({
    summary: 'Delete platform user',
    description:
      'Deletes a platform account while retaining an active administrator.',
    response: { serialization: DefaultMessageResponseDto },
  })
  removeUser(
    @Param() { id }: IdQueryParamDto,
    @UserContext() actor: UserContextPayload,
  ): Promise<DefaultMessageResponseDto> {
    return this.platformUsersService.removeUser(actor.id, id);
  }
}
