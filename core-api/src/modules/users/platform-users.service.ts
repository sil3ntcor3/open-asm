import { DefaultMessageResponseDto } from '@/common/dtos/default-message-response.dto';
import { Role } from '@/common/enums/enum';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, type EntityManager, type Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { User } from '../auth/entities/user.entity';
import { WorkspaceMembers } from '../workspaces/entities/workspace-members.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { WorkspaceRolesService } from '../workspaces/workspace-roles.service';
import type {
  ProvisionPlatformUserDto,
  ProvisionPlatformUserResponseDto,
  UserWorkspaceAccessResponseDto,
} from './dto/users.dto';

type AdminAuth = {
  api: {
    createUser(args: {
      body: {
        name: string;
        email: string;
        password: string;
        role: Role.USER | Role.ADMIN;
      };
    }): Promise<{ user: { id: string } }>;
  };
};

const ADMIN_GOVERNANCE_LOCK_ID = 725_019_001;

@Injectable()
export class PlatformUsersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(WorkspaceMembers)
    private readonly membersRepository: Repository<WorkspaceMembers>,
    @InjectRepository(Workspace)
    private readonly workspacesRepository: Repository<Workspace>,
    private readonly authService: AuthService<AdminAuth>,
    private readonly workspaceRolesService: WorkspaceRolesService,
  ) {}

  /** Creates a platform account with optional immediate workspace access. */
  async provisionUser(
    dto: ProvisionPlatformUserDto,
  ): Promise<ProvisionPlatformUserResponseDto> {
    if (
      dto.platformRole === Role.ADMIN &&
      dto.workspaceAssignments.length > 0
    ) {
      throw new BadRequestException(
        'Platform admins do not require workspace assignments',
      );
    }

    const workspaceIds = dto.workspaceAssignments.map(
      ({ workspaceId }) => workspaceId,
    );
    if (new Set(workspaceIds).size !== workspaceIds.length) {
      throw new BadRequestException(
        'Only one role may be assigned per workspace',
      );
    }
    if (workspaceIds.length > 0) {
      const workspaceCount = await this.workspacesRepository.count({
        where: { id: In(workspaceIds) },
      });
      if (workspaceCount !== workspaceIds.length) {
        throw new BadRequestException('Workspace assignment is invalid');
      }
    }

    const resolvedAssignments = await Promise.all(
      dto.workspaceAssignments.map(async ({ workspaceId, roleId }) => ({
        workspaceId,
        role: await this.workspaceRolesService.getAssignableRole(
          workspaceId,
          roleId,
        ),
      })),
    );

    const result = await this.authService.api.createUser({
      body: {
        name: dto.name.trim(),
        email: dto.email.trim().toLowerCase(),
        password: dto.password,
        role: dto.platformRole,
      },
    });
    const userId = result.user.id;

    try {
      if (resolvedAssignments.length > 0) {
        await this.membersRepository.save(
          resolvedAssignments.map(({ workspaceId, role }) => ({
            workspace: { id: workspaceId },
            user: { id: userId },
            roleId: role.id,
            accessRole: role,
          })),
        );
      }
    } catch (error) {
      await this.usersRepository.delete({ id: userId });
      throw error;
    }

    return {
      id: userId,
      workspaceAssignments: resolvedAssignments.length,
    };
  }

  /** Lists explicit or inherited workspace access for a platform account. */
  async getWorkspaceAccess(
    targetUserId: string,
  ): Promise<UserWorkspaceAccessResponseDto[]> {
    const user = await this.usersRepository.findOne({
      where: { id: targetUserId },
    });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === Role.ADMIN) {
      const workspaces = await this.workspacesRepository.find({
        select: { id: true, name: true },
        order: { name: 'ASC' },
      });
      return workspaces.map((workspace) => ({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        roleId: null,
        roleKey: null,
        roleName: 'Platform Administrator',
        roleProtected: true,
        accessSource: 'platform_admin',
      }));
    }

    const memberships = await this.membersRepository.find({
      where: { user: { id: targetUserId } },
      relations: ['workspace', 'accessRole'],
      order: { workspace: { name: 'ASC' } },
    });
    return memberships.map((membership) => ({
      workspaceId: membership.workspace.id,
      workspaceName: membership.workspace.name,
      roleId: membership.roleId,
      roleKey: membership.accessRole.key,
      roleName: membership.accessRole.name,
      roleProtected: membership.accessRole.protected,
      accessSource: 'membership',
    }));
  }

  /** Changes a platform role while preserving one active administrator. */
  setPlatformRole(
    _actorId: string,
    targetUserId: string,
    role: Role.USER | Role.ADMIN,
  ): Promise<DefaultMessageResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(User);
      const target = await this.getTarget(repository, targetUserId);
      if (target.role === Role.ADMIN && role !== Role.ADMIN) {
        await this.assertAnotherActiveAdmin(manager);
      }
      await repository.update({ id: targetUserId }, { role });
      return { message: 'Platform role updated successfully' };
    });
  }

  /** Bans or restores an account while preserving one active administrator. */
  setBanned(
    _actorId: string,
    targetUserId: string,
    banned: boolean,
  ): Promise<DefaultMessageResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(User);
      const target = await this.getTarget(repository, targetUserId);
      if (banned && target.role === Role.ADMIN && !target.banned) {
        await this.assertAnotherActiveAdmin(manager);
      }
      await repository.update({ id: targetUserId }, { banned });
      return {
        message: banned
          ? 'User banned successfully'
          : 'User restored successfully',
      };
    });
  }

  /** Deletes an account while preserving one active administrator. */
  removeUser(
    _actorId: string,
    targetUserId: string,
  ): Promise<DefaultMessageResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(User);
      const target = await this.getTarget(repository, targetUserId);
      if (target.role === Role.ADMIN && !target.banned) {
        await this.assertAnotherActiveAdmin(manager);
      }
      await repository.delete({ id: targetUserId });
      return { message: 'User deleted successfully' };
    });
  }

  private async getTarget(
    repository: Repository<User>,
    targetUserId: string,
  ): Promise<User> {
    const target = await repository.findOne({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');
    return target;
  }

  private async assertAnotherActiveAdmin(
    manager: EntityManager,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [
      ADMIN_GOVERNANCE_LOCK_ID,
    ]);
    const result = await manager.query<Array<{ count: number | string }>>(
      `SELECT COUNT(*)::int AS count FROM users WHERE role = $1 AND COALESCE(banned, false) = false`,
      [Role.ADMIN],
    );
    if (Number(result[0]?.count ?? 0) <= 1) {
      throw new BadRequestException(
        'At least one active platform admin is required',
      );
    }
  }
}
