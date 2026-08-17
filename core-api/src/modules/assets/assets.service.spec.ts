import { EventEmitter2 } from '@nestjs/event-emitter';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { GeoIpService } from '@/services/geo-ip/geo-ip.service';
import { Target } from '../targets/entities/target.entity';
import { TechnologyForwarderService } from '../technology/technology-forwarder.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { AssetsService } from './assets.service';
import { AssetService } from './entities/asset-services.entity';
import { Asset } from './entities/assets.entity';
import { TlsAssetsView } from './entities/tls-assets.entity';
import {
  AssetExportFormat,
  AssetExportView,
  ExportAssetsQueryDto,
} from './dto/export-assets.dto';

describe('AssetsService', () => {
  let service: AssetsService;
  let mockAssetRepository: Partial<Repository<Asset>>;
  let mockAssetServiceRepository: Partial<Repository<AssetService>>;
  let mockTargetRepository: Partial<Repository<Target>>;
  let mockEventEmitter: Partial<EventEmitter2>;
  let mockTechnologyForwarderService: Partial<TechnologyForwarderService>;
  let mockWorkspacesService: Partial<WorkspacesService>;
  let mockGeoIpService: Partial<GeoIpService>;
  let mockDataSource: Partial<DataSource>;

  beforeEach(async () => {
    mockAssetRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    mockAssetServiceRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      getOneOrFail: jest.fn(),
      getMany: jest.fn(),
      getManyAndCount: jest.fn(),
      getRawMany: jest.fn(),
      getRawOne: jest.fn(),
    } as any;

    mockTargetRepository = {
      findOne: jest.fn(),
      update: jest.fn(),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    mockTechnologyForwarderService = {
      enrichTechnologies: jest.fn(),
    };

    mockWorkspacesService = {
      getWorkspaceIdByTargetId: jest.fn(),
      getWorkspaceConfigValue: jest.fn(),
    };

    mockGeoIpService = {
      lookup: jest.fn(),
    } as any;

    mockDataSource = {
      createQueryBuilder: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(),
      getRawMany: jest.fn(),
      delete: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetsService,
        {
          provide: getRepositoryToken(Asset),
          useValue: mockAssetRepository,
        },
        {
          provide: getRepositoryToken(AssetService),
          useValue: mockAssetServiceRepository,
        },
        {
          provide: getRepositoryToken(Target),
          useValue: mockTargetRepository,
        },
        {
          provide: getRepositoryToken(TlsAssetsView),
          useValue: {},
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: TechnologyForwarderService,
          useValue: mockTechnologyForwarderService,
        },
        {
          provide: WorkspacesService,
          useValue: mockWorkspacesService,
        },
        {
          provide: GeoIpService,
          useValue: mockGeoIpService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<AssetsService>(AssetsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('switchAsset', () => {
    it('scopes the asset lookup to the selected workspace', async () => {
      const asset = { id: 'asset-id', isEnabled: true } as Asset;
      jest.spyOn(mockAssetRepository, 'findOne').mockResolvedValue(asset);
      jest.spyOn(mockAssetRepository, 'save').mockResolvedValue(asset);

      await service.switchAsset('asset-id', false, 'workspace-id');

      expect(mockAssetRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: 'asset-id',
          target: {
            workspaceTargets: { workspace: { id: 'workspace-id' } },
          },
        },
      });
      expect(asset.isEnabled).toBe(false);
    });

    it('does not resolve an asset outside the selected workspace', async () => {
      jest.spyOn(mockAssetRepository, 'findOne').mockResolvedValue(null);

      await expect(
        service.switchAsset('asset-id', false, 'workspace-id'),
      ).rejects.toThrow(NotFoundException);
      expect(mockAssetRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getAssetsForExport', () => {
    it('collects every page from the filtered active asset view', async () => {
      const query = Object.assign(new ExportAssetsQueryDto(), {
        format: AssetExportFormat.CSV,
        hosts: ['example.com'],
        limit: 5,
        page: 7,
        sortBy: 'host',
        sortOrder: 'ASC',
        value: 'example',
        view: AssetExportView.HOST,
      });
      const getHostAssets = jest
        .spyOn(service, 'getHostAssets')
        .mockResolvedValueOnce({
          data: [{ host: 'api.example.com', assetCount: 2 }],
          hasNextPage: true,
          limit: 100,
          page: 1,
          pageCount: 2,
          total: 101,
        })
        .mockResolvedValueOnce({
          data: [{ host: 'www.example.com', assetCount: 1 }],
          hasNextPage: false,
          limit: 100,
          page: 2,
          pageCount: 2,
          total: 101,
        });

      const result = await service.getAssetsForExport(query, 'workspace-id');

      expect(getHostAssets).toHaveBeenCalledTimes(2);
      expect(getHostAssets).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          hosts: ['example.com'],
          limit: 100,
          page: 1,
          sortBy: 'host',
          value: 'example',
        }),
        'workspace-id',
      );
      expect(getHostAssets).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ limit: 100, page: 2 }),
        'workspace-id',
      );
      expect(result).toEqual({
        columns: [
          { key: 'host', header: 'Host' },
          { key: 'services', header: 'Services' },
        ],
        rows: [
          { host: 'api.example.com', services: 2 },
          { host: 'www.example.com', services: 1 },
        ],
        sheetName: 'Hosts',
      });
    });
  });
});
