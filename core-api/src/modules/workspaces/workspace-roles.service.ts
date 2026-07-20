import { WorkspaceAction } from '@/common/authorization/workspace-action.enum';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  CreateWorkspaceRoleDto,
  UpdateWorkspaceRoleDto,
  WorkspaceRoleResponseDto,
} from './dto/workspaces.dto';
import { WorkspaceAccessRole } from './entities/workspace-access-role.entity';
import { WorkspaceMembers } from './entities/workspace-members.entity';
import { NON_DELEGABLE_WORKSPACE_ACTIONS } from './workspace-role.constants';
import { WorkspaceRole } from '@/common/enums/enum';

@Injectable()
export class WorkspaceRolesService {
  constructor(
    @InjectRepository(WorkspaceAccessRole)
    private readonly rolesRepository: Repository<WorkspaceAccessRole>,
    @InjectRepository(WorkspaceMembers)
    private readonly membersRepository: Repository<WorkspaceMembers>,
  ) {}

  /** Lists protected defaults and custom roles available in one workspace. */
  async getRoles(workspaceId: string): Promise<WorkspaceRoleResponseDto[]> {
    const roles = await this.rolesRepository.find({
      where: [
        { protected: true },
        { protected: false, workspaceId },
      ],
      relations: ['permissionEntries'],
      order: { protected: 'DESC', name: 'ASC' },
    });

    return roles.map((role) => this.toResponse(role));
  }

  /** Creates a role whose permissions apply only inside the selected workspace. */
  async createRole(
    workspaceId: string,
    dto: CreateWorkspaceRoleDto,
  ): Promise<WorkspaceRoleResponseDto> {
    const permissions = this.validateDelegablePermissions(dto.permissions);
    await this.assertNameAvailable(workspaceId, dto.name);

    const role = this.rolesRepository.create({
      key: null,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? '',
      protected: false,
      workspaceId,
      permissionEntries: permissions.map((action) => ({ action })),
    });
    const saved = await this.rolesRepository.save(role);
    return this.toResponse(saved);
  }

  /** Updates a custom role while protected defaults remain immutable. */
  async updateRole(
    workspaceId: string,
    roleId: string,
    dto: UpdateWorkspaceRoleDto,
  ): Promise<WorkspaceRoleResponseDto> {
    const role = await this.getRole(roleId);
    this.assertRoleInWorkspace(role, workspaceId);
    if (role.protected) {
      throw new BadRequestException(
        'Protected workspace roles cannot be changed',
      );
    }
    if (dto.name && dto.name.trim() !== role.name) {
      await this.assertNameAvailable(workspaceId, dto.name, role.id);
      role.name = dto.name.trim();
    }
    if (dto.description !== undefined) {
      role.description = dto.description.trim();
    }
    if (dto.permissions) {
      role.permissionEntries = this.validateDelegablePermissions(
        dto.permissions,
      ).map((action) => ({ action, roleId: role.id, role }));
    }
    return this.toResponse(await this.rolesRepository.save(role));
  }

  /** Deletes an unassigned custom role. */
  async deleteRole(workspaceId: string, roleId: string): Promise<void> {
    const role = await this.getRole(roleId);
    this.assertRoleInWorkspace(role, workspaceId);
    if (role.protected) {
      throw new BadRequestException(
        'Protected workspace roles cannot be changed',
      );
    }
    const assignedMembers = await this.membersRepository.count({
      where: { accessRole: { id: roleId } },
    });
    if (assignedMembers > 0) {
      throw new ConflictException('Workspace role is assigned to members');
    }
    await this.rolesRepository.remove(role);
  }

  /** Resolves a protected or workspace-local role that may be assigned. */
  async getAssignableRole(
    workspaceId: string,
    roleId: string,
  ): Promise<WorkspaceAccessRole> {
    const role = await this.getRole(roleId);
    this.assertRoleInWorkspace(role, workspaceId);
    if (role.key === WorkspaceRole.OWNER) {
      throw new BadRequestException(
        'Workspace owner must be transferred separately',
      );
    }
    return role;
  }

  private async getRole(roleId: string): Promise<WorkspaceAccessRole> {
    const role = await this.rolesRepository.findOne({
      where: { id: roleId },
      relations: ['permissionEntries'],
    });
    if (!role) throw new NotFoundException('Workspace role not found');
    return role;
  }

  private assertRoleInWorkspace(
    role: WorkspaceAccessRole,
    workspaceId: string,
  ): void {
    if (!role.protected && role.workspaceId !== workspaceId) {
      throw new NotFoundException('Workspace role not found');
    }
  }

  private validateDelegablePermissions(
    permissions: readonly WorkspaceAction[],
  ): WorkspaceAction[] {
    const unique = [...new Set(permissions)];
    if (
      unique.some((action) =>
        NON_DELEGABLE_WORKSPACE_ACTIONS.includes(
          action as (typeof NON_DELEGABLE_WORKSPACE_ACTIONS)[number],
        ),
      )
    ) {
      throw new BadRequestException('Role management cannot be delegated');
    }
    return unique;
  }

  private async assertNameAvailable(
    workspaceId: string,
    name: string,
    excludedRoleId?: string,
  ): Promise<void> {
    const normalized = name.trim().toLocaleLowerCase();
    const roles = await this.rolesRepository.find({
      where: { protected: false, workspaceId },
    });
    if (
      roles.some(
        (role) =>
          role.id !== excludedRoleId &&
          role.name.toLocaleLowerCase() === normalized,
      )
    ) {
      throw new ConflictException('Workspace role name already exists');
    }
  }

  private toResponse(role: WorkspaceAccessRole): WorkspaceRoleResponseDto {
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      protected: role.protected,
      permissions:
        role.key === WorkspaceRole.OWNER
          ? Object.values(WorkspaceAction)
          : (role.permissionEntries ?? []).map(({ action }) => action),
    };
  }
}
