import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { TargetsService } from '../targets/targets.service';
import type { CreateInternalNetworkDto } from './dtos/create-internal-network.dto';
import type { GetManyInternalNetworksQueryDto } from './dtos/get-many-internal-networks.dto';
import type {
  GetManyNetworkInterfacesQueryDto,
} from './dtos/get-many-network-interfaces.dto';
import type { UpdateInternalNetworkDto } from './dtos/update-internal-network.dto';
import { InternalNetwork } from './entities/internal-network.entity';
import { NetworkInterface } from './entities/network-interface.entity';
import { InternalNetworksService } from './internal-networks.service';
import { SortOrder } from '@/common/dtos/get-many-base.dto';
import { TargetType } from '../targets/entities/target.entity';

describe('InternalNetworksService', () => {
  let service: InternalNetworksService;
  let internalNetworkRepo: Repository<InternalNetwork>;
  let networkInterfaceRepo: Repository<NetworkInterface>;
  let targetsService: TargetsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InternalNetworksService,
        {
          provide: getRepositoryToken(InternalNetwork),
          useValue: {
            findAndCount: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              leftJoinAndSelect: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
              getCount: jest.fn().mockResolvedValue(0),
            }),
          },
        },
        {
          provide: getRepositoryToken(NetworkInterface),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              addSelect: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getRawMany: jest.fn(),
              getCount: jest.fn(),
            }),
            find: jest.fn(),
            findAndCount: jest.fn(),
          },
        },
        {
          provide: TargetsService,
          useValue: {
            createMultipleTargets: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<InternalNetworksService>(InternalNetworksService);
    internalNetworkRepo = module.get<Repository<InternalNetwork>>(
      getRepositoryToken(InternalNetwork),
    );
    networkInterfaceRepo = module.get<Repository<NetworkInterface>>(
      getRepositoryToken(NetworkInterface),
    );
    targetsService = module.get<TargetsService>(TargetsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createInternalNetwork', () => {
    it('should create internal network successfully', async () => {
      const dto: CreateInternalNetworkDto = {
        name: 'Test Network',
      };
      const workspaceId = randomUUID();
      const user = { id: randomUUID() };
      jest.spyOn(internalNetworkRepo, 'save').mockResolvedValue({} as any);

      const result = await service.createInternalNetwork(
        dto,
        workspaceId,
        user as any,
      );

      expect(result).toEqual({
        message: 'Internal network created successfully',
      });
      expect(internalNetworkRepo.save).toHaveBeenCalledWith({
        name: dto.name,
        workspaceId,
        createdBy: user.id,
      });
    });
  });

  describe('updateInternalNetworkById', () => {
    it('should update internal network successfully', async () => {
      const id = randomUUID();
      const dto: UpdateInternalNetworkDto = { name: 'Updated Network' };
      const workspaceId = randomUUID();
      const internalNetwork = {
        id,
        name: 'Old Name',
        workspaceId,
      };

      jest
        .spyOn(internalNetworkRepo, 'findOne')
        .mockResolvedValue(internalNetwork as any);
      jest
        .spyOn(internalNetworkRepo, 'save')
        .mockResolvedValue(internalNetwork as any);

      const result = await service.updateInternalNetworkById(
        id,
        dto,
        workspaceId,
      );

      expect(result).toEqual({
        message: 'Internal network updated successfully',
      });
      expect(internalNetwork.name).toBe(dto.name);
      expect(internalNetworkRepo.findOne).toHaveBeenCalledWith({
        where: { id, workspaceId },
      });
    });

    it('should throw NotFoundException if internal network not found', async () => {
      const id = randomUUID();
      const dto: UpdateInternalNetworkDto = { name: 'Updated Network' };
      const workspaceId = randomUUID();

      jest.spyOn(internalNetworkRepo, 'findOne').mockResolvedValue(null);

      await expect(
        service.updateInternalNetworkById(id, dto, workspaceId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteInternalNetwork', () => {
    it('should delete internal network successfully', async () => {
      const id = randomUUID();
      const workspaceId = randomUUID();
      const internalNetwork = {
        id,
        workspaceId,
      };

      jest
        .spyOn(internalNetworkRepo, 'findOne')
        .mockResolvedValue(internalNetwork as any);
      jest
        .spyOn(internalNetworkRepo, 'remove')
        .mockResolvedValue(internalNetwork as any);

      const result = await service.deleteInternalNetwork(id, workspaceId);

      expect(result).toEqual({
        message: 'Internal network deleted successfully',
      });
      expect(internalNetworkRepo.findOne).toHaveBeenCalledWith({
        where: { id, workspaceId },
      });
    });

    it('should throw NotFoundException if internal network not found', async () => {
      const id = randomUUID();
      const workspaceId = randomUUID();

      jest.spyOn(internalNetworkRepo, 'findOne').mockResolvedValue(null);

      await expect(
        service.deleteInternalNetwork(id, workspaceId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createTargetsFromInterfaces', () => {
    it('creates targets only from interfaces in the selected workspace', async () => {
      const workspaceId = randomUUID();
      const internalNetworkId = randomUUID();
      const interfaceIds = [randomUUID(), randomUUID()];
      const user = { id: randomUUID() };

      jest.spyOn(networkInterfaceRepo, 'find').mockResolvedValue(
        interfaceIds.map((id, index) => ({
          id,
          cidr: `192.0.2.${index}/32`,
          internalNetworkId,
          internalNetwork: { id: internalNetworkId, workspaceId },
        })) as any,
      );
      jest
        .spyOn(targetsService, 'createMultipleTargets')
        .mockResolvedValue({} as any);

      await service.createTargetsFromInterfaces(
        { networkInterfaceIds: interfaceIds },
        workspaceId,
        user as any,
      );

      expect(networkInterfaceRepo.find).toHaveBeenCalledWith({
        where: {
          id: expect.anything(),
          internalNetwork: { workspaceId },
        },
        relations: ['internalNetwork'],
      });
      expect(targetsService.createMultipleTargets).toHaveBeenCalledWith(
        {
          targets: [
            { value: '192.0.2.0/32', type: TargetType.CIDR },
            { value: '192.0.2.1/32', type: TargetType.CIDR },
          ],
        },
        workspaceId,
        user,
        internalNetworkId,
      );
    });

    it('rejects when any requested interface is outside the selected workspace', async () => {
      const workspaceId = randomUUID();
      const interfaceIds = [randomUUID(), randomUUID()];
      jest.spyOn(networkInterfaceRepo, 'find').mockResolvedValue([
        { id: interfaceIds[0] },
      ] as NetworkInterface[]);

      await expect(
        service.createTargetsFromInterfaces(
          { networkInterfaceIds: interfaceIds },
          workspaceId,
          { id: randomUUID() } as any,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(targetsService.createMultipleTargets).not.toHaveBeenCalled();
    });
  });

  describe('getManyInternalNetworks', () => {
    it('should return paginated internal networks for workspace', async () => {
      const query: GetManyInternalNetworksQueryDto = {
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: SortOrder.DESC,
      };
      const workspaceId = randomUUID();
      const networks = [
        {
          id: randomUUID(),
          name: 'Network 1',
          createdAt: new Date(),
          updatedAt: new Date(),
          creator: { id: randomUUID(), name: 'User 1', image: 'image1.jpg' },
          workers: [{ id: randomUUID() }],
        },
      ];
      const total = 1;

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn().mockResolvedValue({
          entities: networks,
          raw: [{ agents: '1' }],
        }),
        getCount: jest.fn().mockResolvedValue(total),
      };
      jest
        .spyOn(internalNetworkRepo, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getManyInternalNetworks(query, workspaceId);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].agents).toBe(1);
      expect(result.total).toBe(total);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(internalNetworkRepo.createQueryBuilder).toHaveBeenCalledWith('network');
    });

    it('should filter by search on name when provided', async () => {
      const query: GetManyInternalNetworksQueryDto = {
        search: 'Test',
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: SortOrder.ASC,
      };
      const workspaceId = randomUUID();

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
        getCount: jest.fn().mockResolvedValue(0),
      };
      jest
        .spyOn(internalNetworkRepo, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getManyInternalNetworks(query, workspaceId);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'network.name LIKE :search',
        { search: '%Test%' },
      );
    });
  });

  describe('getManyNetworkInterfaces', () => {
    it('should return paginated network interfaces for internal network', async () => {
      const internalNetworkId = randomUUID();
      const workspaceId = randomUUID();
      const query: GetManyNetworkInterfacesQueryDto = {
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: SortOrder.DESC,
      };
      const internalNetwork = { id: internalNetworkId, workspaceId };
      const interfaces = [
        {
          id: randomUUID(),
          interfaceName: 'eth0',
          ipAddress: '192.168.1.10',
          cidr: '24',
          gatewayIp: '192.168.1.1',
          gatewayMac: 'aa:bb:cc:dd:ee:ff',
          workerId: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const total = 1;

      jest
        .spyOn(internalNetworkRepo, 'findOne')
        .mockResolvedValue(internalNetwork as any);
      
      const qb = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(interfaces),
        getCount: jest.fn().mockResolvedValue(total),
      };
      jest.spyOn(networkInterfaceRepo, 'createQueryBuilder').mockReturnValue(qb as any);

      const result = await service.getManyNetworkInterfaces(
        internalNetworkId,
        query,
        workspaceId,
      );

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(total);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(internalNetworkRepo.findOne).toHaveBeenCalledWith({
        where: { id: internalNetworkId, workspaceId },
      });
    });

    it('should filter by search on interfaceName when provided', async () => {
      const internalNetworkId = randomUUID();
      const workspaceId = randomUUID();
      const query: GetManyNetworkInterfacesQueryDto = {
        search: 'eth',
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: SortOrder.ASC,
      };
      const internalNetwork = { id: internalNetworkId, workspaceId };

      jest
        .spyOn(internalNetworkRepo, 'findOne')
        .mockResolvedValue(internalNetwork as any);
      
      const qb = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockResolvedValue(0),
      };
      jest.spyOn(networkInterfaceRepo, 'createQueryBuilder').mockReturnValue(qb as any);

      await service.getManyNetworkInterfaces(
        internalNetworkId,
        query,
        workspaceId,
      );
    });

    it('should throw NotFoundException if internal network not found', async () => {
      const internalNetworkId = randomUUID();
      const workspaceId = randomUUID();
      const query: GetManyNetworkInterfacesQueryDto = {
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: SortOrder.ASC,
      };

      jest.spyOn(internalNetworkRepo, 'findOne').mockResolvedValue(null);

      await expect(service.getManyNetworkInterfaces(internalNetworkId, query, workspaceId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getInternalNetworkById', () => {
    it('should return internal network when found', async () => {
      const id = randomUUID();
      const workspaceId = randomUUID();
      const network = {
        id,
        name: 'Test Network',
        createdAt: new Date(),
        updatedAt: new Date(),
        creator: { id: randomUUID(), name: 'User', image: 'img.jpg' },
      };

      jest.spyOn(internalNetworkRepo, 'findOne').mockResolvedValue(network as any);

      const result = await service.getInternalNetworkById(id, workspaceId);

      expect(result).toEqual({
        id: network.id,
        name: network.name,
        createdAt: network.createdAt,
        updatedAt: network.updatedAt,
        agents: 0,
        createdBy: {
          id: network.creator.id,
          name: network.creator.name,
          image: network.creator.image,
        },
      });
      expect(internalNetworkRepo.findOne).toHaveBeenCalledWith({
        where: { id, workspaceId },
        relations: ['creator', 'workers'],
      });
    });

    it('should throw NotFoundException if internal network not found', async () => {
      const id = randomUUID();
      const workspaceId = randomUUID();

      jest.spyOn(internalNetworkRepo, 'findOne').mockResolvedValue(null);

      await expect(service.getInternalNetworkById(id, workspaceId)).rejects.toThrow(NotFoundException);
    });
  });
});
