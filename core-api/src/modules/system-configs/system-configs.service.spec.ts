import { RedisService } from '@/services/redis/redis.service';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { SystemConfig } from './entities/system-config.entity';
import { SystemConfigsService } from './system-configs.service';
import axios from 'axios';

jest.mock('axios');

describe('SystemConfigsService', () => {
  let service: SystemConfigsService;
  let mockSystemConfigRepository: Partial<Repository<SystemConfig>>;
  let mockStorageService: Partial<StorageService>;
  let mockRedisService: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    mockSystemConfigRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    mockStorageService = {
      deleteFile: jest.fn(),
    };

    mockRedisService = {
      get: jest.fn(),
      set: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemConfigsService,
        {
          provide: getRepositoryToken(SystemConfig),
          useValue: mockSystemConfigRepository,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<SystemConfigsService>(SystemConfigsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('can force an update check and cache the release metadata', async () => {
    const release = {
      tag_name: 'v0.6.3',
      html_url: 'https://github.com/oasm-platform/open-asm/releases/tag/v0.6.3',
      body: 'Release notes',
      published_at: '2026-07-03T15:37:06Z',
    };
    jest.mocked(axios.get).mockResolvedValue({ data: release });

    await expect(service.checkForUpdates(true)).resolves.toBe(true);

    expect(mockRedisService.set).toHaveBeenCalledWith(
      'version:last_check',
      expect.any(String),
    );
    expect(mockRedisService.set).toHaveBeenCalledWith(
      'version:latest',
      JSON.stringify(release),
    );
  });

  describe('removeLogo', () => {
    it('should remove logo and set logoPath to null', async () => {
      const mockConfig = {
        id: 1,
        name: 'Test System',
        logoPath: '/uploads/logo.png',
      };

      (mockSystemConfigRepository.findOne as jest.Mock).mockResolvedValue(
        mockConfig,
      );
      (mockSystemConfigRepository.save as jest.Mock).mockResolvedValue({
        ...mockConfig,
        logoPath: null,
      });

      const result = await service.removeLogo();

      expect(mockSystemConfigRepository.findOne).toHaveBeenCalled();
      expect(mockSystemConfigRepository.save).toHaveBeenCalledWith({
        ...mockConfig,
        logoPath: null,
      });
      expect(result).toEqual({
        message: 'System logo removed successfully',
      });
    });

    it('should create default config if none exists and return no logo message', async () => {
      const mockConfig = {
        id: 1,
        name: 'OASM',
        logoPath: null,
      };

      (mockSystemConfigRepository.findOne as jest.Mock).mockResolvedValue(null);
      (mockSystemConfigRepository.create as jest.Mock).mockReturnValue(
        mockConfig,
      );
      (mockSystemConfigRepository.save as jest.Mock).mockResolvedValue(
        mockConfig,
      );

      const result = await service.removeLogo();

      expect(mockSystemConfigRepository.findOne).toHaveBeenCalled();
      expect(mockSystemConfigRepository.create).toHaveBeenCalledWith({
        name: 'OASM',
        logoPath: undefined,
      });
      expect(result).toEqual({
        message: 'No system logo to remove',
      });
    });
  });
});
