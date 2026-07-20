import { Role, WorkspaceRole } from '@/common/enums/enum';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { User } from '../auth/entities/user.entity';
import type { WorkspaceAccessRole } from '../workspaces/entities/workspace-access-role.entity';
import type { WorkspaceMembers } from '../workspaces/entities/workspace-members.entity';
import type { Workspace } from '../workspaces/entities/workspace.entity';
import type { WorkspaceRolesService } from '../workspaces/workspace-roles.service';
import { PlatformUsersService } from './platform-users.service';

describe('PlatformUsersService', () => {
  const actorId = '2a00f7b3-6d4b-4709-81ef-28101c96bff0';
  const targetId = 'b87480f5-aef4-4bf0-a656-af4b3c0f33a0';
  const workspaceId = 'a062ff6a-92e6-47a0-b013-4316fd771772';
  const roleId = '00000000-0000-4000-8000-000000000003';

  const createService = () => {
    const transactionalUsersRepository = {
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as Repository<User>;
    const manager = {
      query: jest.fn(),
      getRepository: jest.fn().mockReturnValue(transactionalUsersRepository),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(
        (callback: (entityManager: EntityManager) => Promise<unknown>) =>
          callback(manager),
      ),
    } as unknown as DataSource;
    const usersRepository = {
      delete: jest.fn(),
      findOne: jest.fn(),
    } as unknown as Repository<User>;
    const saveMembers = jest.fn();
    const membersRepository = {
      save: saveMembers,
      find: jest.fn(),
    } as unknown as Repository<WorkspaceMembers>;
    const workspacesRepository = {
      count: jest.fn(),
      find: jest.fn(),
    } as unknown as Repository<Workspace>;
    const createUser = jest.fn();
    const authService = {
      api: {
        createUser,
      },
    } as unknown as ConstructorParameters<typeof PlatformUsersService>[4];
    const workspaceRolesService = {
      getAssignableRole: jest.fn(),
    } as unknown as WorkspaceRolesService;

    return {
      service: new PlatformUsersService(
        dataSource,
        usersRepository,
        membersRepository,
        workspacesRepository,
        authService,
        workspaceRolesService,
      ),
      manager,
      transactionalUsersRepository,
      usersRepository,
      membersRepository,
      workspacesRepository,
      authService,
      workspaceRolesService,
      createUser,
      saveMembers,
    };
  };

  it('prevents demoting the last active platform admin', async () => {
    const { service, manager, transactionalUsersRepository } = createService();
    jest.spyOn(transactionalUsersRepository, 'findOne').mockResolvedValue({
      id: targetId,
      role: Role.ADMIN,
      banned: false,
    } as User);
    jest
      .spyOn(manager, 'query')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 1 }]);

    await expect(
      service.setPlatformRole(actorId, targetId, Role.USER),
    ).rejects.toThrow('At least one active platform admin is required');
    expect(transactionalUsersRepository.update).not.toHaveBeenCalled();
  });

  it('allows demotion when another active platform admin remains', async () => {
    const { service, manager, transactionalUsersRepository } = createService();
    jest.spyOn(transactionalUsersRepository, 'findOne').mockResolvedValue({
      id: targetId,
      role: Role.ADMIN,
      banned: false,
    } as User);
    jest
      .spyOn(manager, 'query')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 2 }]);

    await expect(
      service.setPlatformRole(actorId, targetId, Role.USER),
    ).resolves.toEqual({ message: 'Platform role updated successfully' });
    expect(transactionalUsersRepository.update).toHaveBeenCalledWith(
      { id: targetId },
      { role: Role.USER },
    );
  });

  it('prevents banning the last active platform admin', async () => {
    const { service, manager, transactionalUsersRepository } = createService();
    jest.spyOn(transactionalUsersRepository, 'findOne').mockResolvedValue({
      id: targetId,
      role: Role.ADMIN,
      banned: false,
    } as User);
    jest
      .spyOn(manager, 'query')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 1 }]);

    await expect(service.setBanned(actorId, targetId, true)).rejects.toThrow(
      'At least one active platform admin is required',
    );
  });

  it('creates a platform user without workspace access', async () => {
    const { service, createUser, membersRepository } = createService();
    createUser.mockResolvedValue({
      user: { id: targetId, name: 'No Access', email: 'none@example.com' },
    } as never);

    await expect(
      service.provisionUser({
        name: 'No Access',
        email: 'none@example.com',
        password: 'temporary-password',
        platformRole: Role.USER,
        workspaceAssignments: [],
      }),
    ).resolves.toEqual(
      expect.objectContaining({ id: targetId, workspaceAssignments: 0 }),
    );
    expect(membersRepository.save).not.toHaveBeenCalled();
  });

  it('creates one membership per requested workspace assignment', async () => {
    const {
      service,
      createUser,
      membersRepository,
      workspacesRepository,
      workspaceRolesService,
    } = createService();
    jest.spyOn(workspacesRepository, 'count').mockResolvedValue(1);
    jest.spyOn(workspaceRolesService, 'getAssignableRole').mockResolvedValue({
      id: roleId,
      key: WorkspaceRole.OPERATOR,
      name: 'Operator',
    } as WorkspaceAccessRole);
    createUser.mockResolvedValue({
      user: { id: targetId, name: 'Operator', email: 'operator@example.com' },
    } as never);
    jest.spyOn(membersRepository, 'save').mockResolvedValue({} as never);

    await expect(
      service.provisionUser({
        name: 'Operator',
        email: 'operator@example.com',
        password: 'temporary-password',
        platformRole: Role.USER,
        workspaceAssignments: [{ workspaceId, roleId }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({ id: targetId, workspaceAssignments: 1 }),
    );
    expect(membersRepository.save).toHaveBeenCalledWith([
      expect.objectContaining({
        workspace: { id: workspaceId },
        user: { id: targetId },
        roleId,
      }),
    ]);
  });

  it('does not accept explicit workspace assignments for a platform admin', async () => {
    const { service } = createService();

    await expect(
      service.provisionUser({
        name: 'Admin',
        email: 'admin@example.com',
        password: 'temporary-password',
        platformRole: Role.ADMIN,
        workspaceAssignments: [{ workspaceId, roleId }],
      }),
    ).rejects.toThrow('Platform admins do not require workspace assignments');
  });

  it('shows every workspace as inherited access for a platform admin', async () => {
    const { service, usersRepository, workspacesRepository, membersRepository } =
      createService();
    jest.spyOn(usersRepository, 'findOne').mockResolvedValue({
      id: targetId,
      role: Role.ADMIN,
    } as User);
    jest.spyOn(workspacesRepository, 'find').mockResolvedValue([
      { id: workspaceId, name: 'Default' } as Workspace,
    ]);

    await expect(service.getWorkspaceAccess(targetId)).resolves.toEqual([
      {
        workspaceId,
        workspaceName: 'Default',
        roleId: null,
        roleKey: null,
        roleName: 'Platform Administrator',
        roleProtected: true,
        accessSource: 'platform_admin',
      },
    ]);
    expect(membersRepository.find).not.toHaveBeenCalled();
  });

  it('shows explicit relational workspace access for a platform user', async () => {
    const { service, usersRepository, membersRepository } = createService();
    jest.spyOn(usersRepository, 'findOne').mockResolvedValue({
      id: targetId,
      role: Role.USER,
    } as User);
    jest.spyOn(membersRepository, 'find').mockResolvedValue([
      {
        workspace: { id: workspaceId, name: 'Default' },
        roleId,
        accessRole: {
          id: roleId,
          key: WorkspaceRole.OPERATOR,
          name: 'Operator',
          protected: true,
        },
      } as WorkspaceMembers,
    ]);

    await expect(service.getWorkspaceAccess(targetId)).resolves.toEqual([
      {
        workspaceId,
        workspaceName: 'Default',
        roleId,
        roleKey: WorkspaceRole.OPERATOR,
        roleName: 'Operator',
        roleProtected: true,
        accessSource: 'membership',
      },
    ]);
  });
});
