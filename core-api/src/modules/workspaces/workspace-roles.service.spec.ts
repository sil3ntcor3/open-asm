import { WorkspaceAction } from '@/common/authorization/workspace-action.enum';
import { WorkspaceRole } from '@/common/enums/enum';
import type { Repository } from 'typeorm';
import type { WorkspaceMembers } from './entities/workspace-members.entity';
import type { WorkspaceAccessRole } from './entities/workspace-access-role.entity';
import { WorkspaceRolesService } from './workspace-roles.service';

describe('WorkspaceRolesService', () => {
  const workspaceId = '75f777ca-26d5-4298-961f-c9173b869744';
  const otherWorkspaceId = '4725d89f-ab2b-4555-b2fc-63bf10324596';

  const ownerRole = {
    id: '00000000-0000-4000-8000-000000000005',
    key: WorkspaceRole.OWNER,
    name: 'Owner',
    description: 'Full workspace control.',
    protected: true,
    workspaceId: null,
    permissionEntries: [],
  } as unknown as WorkspaceAccessRole;

  const customRole = {
    id: '515a8072-bb64-4ee6-8d54-fb48df629220',
    key: null,
    name: 'Discovery Lead',
    description: 'Runs discovery and manages targets.',
    protected: false,
    workspaceId,
    permissionEntries: [
      { action: WorkspaceAction.TARGET_CREATE },
      { action: WorkspaceAction.SCAN_EXECUTE },
    ],
  } as unknown as WorkspaceAccessRole;

  const createService = () => {
    const rolesRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(
        (value: Partial<WorkspaceAccessRole>) =>
          value as WorkspaceAccessRole,
      ),
      save: jest.fn((value: WorkspaceAccessRole) =>
        Promise.resolve({
          ...value,
          id: customRole.id,
        }),
      ),
      remove: jest.fn(),
    } as unknown as Repository<WorkspaceAccessRole>;
    const membersRepository = {
      count: jest.fn(),
    } as unknown as Repository<WorkspaceMembers>;

    return {
      service: new WorkspaceRolesService(rolesRepository, membersRepository),
      rolesRepository,
      membersRepository,
    };
  };

  it('returns protected defaults and roles scoped to the selected workspace', async () => {
    const { service, rolesRepository } = createService();
    jest
      .spyOn(rolesRepository, 'find')
      .mockResolvedValue([ownerRole, customRole]);

    await expect(service.getRoles(workspaceId)).resolves.toEqual([
      expect.objectContaining({
        id: ownerRole.id,
        key: WorkspaceRole.OWNER,
        protected: true,
        permissions: Object.values(WorkspaceAction),
      }),
      expect.objectContaining({
        id: customRole.id,
        key: null,
        protected: false,
        permissions: [
          WorkspaceAction.TARGET_CREATE,
          WorkspaceAction.SCAN_EXECUTE,
        ],
      }),
    ]);
    expect(rolesRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          { protected: true },
          { protected: false, workspaceId },
        ],
      }),
    );
  });

  it('creates a custom role scoped to one workspace', async () => {
    const { service, rolesRepository } = createService();
    jest.spyOn(rolesRepository, 'find').mockResolvedValue([]);

    await expect(
      service.createRole(workspaceId, {
        name: 'Discovery Lead',
        description: 'Runs discovery and manages targets.',
        permissions: [
          WorkspaceAction.TARGET_CREATE,
          WorkspaceAction.SCAN_EXECUTE,
        ],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        name: 'Discovery Lead',
        protected: false,
        permissions: [
          WorkspaceAction.TARGET_CREATE,
          WorkspaceAction.SCAN_EXECUTE,
        ],
      }),
    );
    expect(rolesRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        protected: false,
        key: null,
        workspaceId,
      }),
    );
  });

  it('does not allow role-management permission in a custom role', async () => {
    const { service } = createService();

    await expect(
      service.createRole(workspaceId, {
        name: 'Self Escalating',
        description: '',
        permissions: [WorkspaceAction.ROLE_MANAGE],
      }),
    ).rejects.toThrow('Role management cannot be delegated');
  });

  it('does not allow protected roles to be edited', async () => {
    const { service, rolesRepository } = createService();
    jest.spyOn(rolesRepository, 'findOne').mockResolvedValue(ownerRole);

    await expect(
      service.updateRole(workspaceId, ownerRole.id, {
        name: 'Changed Owner',
      }),
    ).rejects.toThrow('Protected workspace roles cannot be changed');
  });

  it('does not resolve a custom role from another workspace for assignment', async () => {
    const { service, rolesRepository } = createService();
    jest.spyOn(rolesRepository, 'findOne').mockResolvedValue({
      ...customRole,
      workspaceId: otherWorkspaceId,
    } as WorkspaceAccessRole);

    await expect(
      service.getAssignableRole(workspaceId, customRole.id),
    ).rejects.toThrow('Workspace role not found');
  });

  it('does not allow the protected owner role to be assigned directly', async () => {
    const { service, rolesRepository } = createService();
    jest.spyOn(rolesRepository, 'findOne').mockResolvedValue(ownerRole);

    await expect(
      service.getAssignableRole(workspaceId, ownerRole.id),
    ).rejects.toThrow('Workspace owner must be transferred separately');
  });

  it('does not delete a custom role while members are assigned', async () => {
    const { service, rolesRepository, membersRepository } = createService();
    jest.spyOn(rolesRepository, 'findOne').mockResolvedValue(customRole);
    jest.spyOn(membersRepository, 'count').mockResolvedValue(2);

    await expect(
      service.deleteRole(workspaceId, customRole.id),
    ).rejects.toThrow('Workspace role is assigned to members');
    expect(rolesRepository.remove).not.toHaveBeenCalled();
  });
});
