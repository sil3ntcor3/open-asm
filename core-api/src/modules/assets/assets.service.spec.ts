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
import { GetAssetsQueryDto } from './dto/assets.dto';

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
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
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

  describe('getManyAsssetServices', () => {
    it('returns the host, tags, and detected service metadata used by detailed exports', async () => {
      (mockAssetServiceRepository as any).getManyAndCount.mockResolvedValue([
        [
          {
            asset: {
              ipAssets: [{ ipAddress: '203.0.113.10' }],
              isEnabled: true,
              targetId: 'target-id',
              value: 'app.example.com',
            },
            createdAt: new Date('2026-08-17T12:00:00.000Z'),
            httpResponses: [
              {
                status_code: 200,
                tech: ['nginx:1.27'],
                tls: { subject_cn: 'app.example.com' },
              },
            ],
            id: 'service-id',
            port: 443,
            product: 'nginx 1.27',
            scheme: 'https',
            service: 'https',
            tags: [{ id: 'tag-id', tag: 'production' }],
            value: 'https://app.example.com',
          } as AssetService,
        ],
        1,
      ]);
      jest
        .spyOn(mockTechnologyForwarderService, 'enrichTechnologies')
        .mockResolvedValue([
          {
            categoryNames: ['Web servers'],
            description: 'High performance web server',
            name: 'nginx',
            website: 'https://nginx.org',
          },
        ] as never);
      const query = Object.assign(new GetAssetsQueryDto(), {
        limit: 10,
        page: 1,
        sortBy: 'createdAt',
        sortOrder: 'ASC',
      });

      const result = await service.getManyAsssetServices(query, 'workspace-id');

      expect(result.data[0]).toEqual(
        expect.objectContaining({
          detectedService: 'https',
          hostname: 'app.example.com',
          product: 'nginx 1.27',
          scheme: 'https',
          tags: [{ id: 'tag-id', tag: 'production' }],
        }),
      );
    });
  });

  describe('getAssetsForExport', () => {
    it('expands each IP into its related service details and preserves IPs without services', async () => {
      const query = Object.assign(new ExportAssetsQueryDto(), {
        format: AssetExportFormat.CSV,
        sortBy: 'ip',
        sortOrder: 'ASC',
        value: '203.0.113',
        view: AssetExportView.IP,
      });
      jest.spyOn(service, 'getIpAssets').mockResolvedValue({
        data: [
          {
            assetCount: 1,
            geoIp: { city: 'Chicago', country: 'United States' } as never,
            ip: '203.0.113.10',
          },
          {
            assetCount: 0,
            geoIp: { city: 'Dallas', country: 'United States' } as never,
            ip: '203.0.113.20',
          },
        ],
        hasNextPage: false,
        limit: 100,
        page: 1,
        pageCount: 1,
        total: 2,
      });
      const getServices = jest
        .spyOn(service, 'getManyAsssetServices')
        .mockResolvedValue({
          data: [
            {
              createdAt: new Date('2026-08-17T12:00:00.000Z'),
              hostname: 'app.example.com',
              httpResponses: {
                tech: ['nginx:1.27'],
                tls: { subject_cn: 'app.example.com' },
              } as never,
              id: 'service-id',
              ipAddresses: ['203.0.113.10', '192.0.2.5'],
              isEnabled: true,
              port: 443,
              targetId: 'target-id',
              value: 'https://app.example.com',
            },
          ],
          hasNextPage: false,
          limit: 100,
          page: 1,
          pageCount: 1,
          total: 1,
        });

      const result = await service.getAssetsForExport(query, 'workspace-id');

      expect(getServices).toHaveBeenCalledWith(
        expect.objectContaining({
          ipAddresses: ['203.0.113.10', '203.0.113.20'],
          limit: 100,
          page: 1,
          value: undefined,
        }),
        'workspace-id',
      );
      expect(result.rows).toEqual([
        expect.objectContaining({
          city: 'Chicago',
          host: 'app.example.com',
          ip: '203.0.113.10',
          port: 443,
          service: 'https://app.example.com',
          services: 1,
        }),
        expect.objectContaining({
          city: 'Dallas',
          ip: '203.0.113.20',
          service: undefined,
          services: 0,
        }),
      ]);
    });

    it('expands each host into its related service details and preserves hosts without services', async () => {
      const query = Object.assign(new ExportAssetsQueryDto(), {
        format: AssetExportFormat.CSV,
        sortBy: 'host',
        sortOrder: 'ASC',
        value: 'example',
        view: AssetExportView.HOST,
      });
      jest.spyOn(service, 'getHostAssets').mockResolvedValue({
        data: [
          { host: 'app.example.com', assetCount: 1 },
          { host: 'idle.example.com', assetCount: 0 },
        ],
        hasNextPage: false,
        limit: 100,
        page: 1,
        pageCount: 1,
        total: 2,
      });
      const getServices = jest
        .spyOn(service, 'getManyAsssetServices')
        .mockResolvedValue({
          data: [
            {
              createdAt: new Date('2026-08-17T12:00:00.000Z'),
              detectedService: 'https',
              hostname: 'app.example.com',
              httpResponses: {
                status_code: 200,
                tech: ['nginx:1.27'],
                tls: { subject_cn: 'app.example.com' },
              } as never,
              id: 'service-id',
              ipAddresses: ['203.0.113.10'],
              isEnabled: true,
              port: 443,
              product: 'nginx 1.27',
              scheme: 'https',
              targetId: 'target-id',
              value: 'https://app.example.com',
            },
          ],
          hasNextPage: false,
          limit: 100,
          page: 1,
          pageCount: 1,
          total: 1,
        });

      const result = await service.getAssetsForExport(query, 'workspace-id');

      expect(getServices).toHaveBeenCalledWith(
        expect.objectContaining({
          hosts: ['app.example.com', 'idle.example.com'],
          limit: 100,
          page: 1,
          value: undefined,
        }),
        'workspace-id',
      );
      expect(result.rows).toEqual([
        expect.objectContaining({
          host: 'app.example.com',
          port: 443,
          service: 'https://app.example.com',
          services: 1,
          technologies: 'nginx:1.27',
        }),
        expect.objectContaining({
          host: 'idle.example.com',
          service: undefined,
          services: 0,
        }),
      ]);
    });

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
      jest.spyOn(service, 'getManyAsssetServices').mockResolvedValue({
        data: [],
        hasNextPage: false,
        limit: 100,
        page: 1,
        pageCount: 0,
        total: 0,
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
      expect(result.columns).toEqual(
        expect.arrayContaining([
          { key: 'host', header: 'Host Name' },
          { key: 'services', header: 'Services' },
          { key: 'service', header: 'Service' },
          { key: 'technologies', header: 'Technologies' },
        ]),
      );
      expect(result.rows).toEqual([
        expect.objectContaining({ host: 'api.example.com', services: 2 }),
        expect.objectContaining({ host: 'www.example.com', services: 1 }),
      ]);
      expect(result.sheetName).toBe('Hosts');
    });
  });
});
