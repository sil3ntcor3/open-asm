import { RedisService } from '@/services/redis/redis.service';
import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { SystemConfigsService } from '../system-configs/system-configs.service';
import { UsersService } from '../users/users.service';
import { RootService } from './root.service';

describe('RootService', () => {
  let service: RootService;
  let redisGet: jest.Mock;
  let configValues: Record<string, string | undefined>;

  beforeEach(async () => {
    redisGet = jest.fn();
    configValues = {
      APP_VERSION: '0.1.0-dev.42+abc123',
      APP_CHANNEL: 'dev',
      APP_COMMIT: 'abc123',
      NODE_ENV: 'production',
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RootService,
        {
          provide: UsersService,
          useValue: {
            createFirstAdmin: jest.fn(),
            usersRepository: {
              count: jest.fn(),
            },
          },
        },
        {
          provide: SystemConfigsService,
          useValue: {
            getConfig: jest.fn().mockResolvedValue({
              name: 'Open ASM',
              logoPath: undefined,
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configValues[key]),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: redisGet,
          },
        },
      ],
    }).compile();

    service = module.get<RootService>(RootService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns the installed build identity and cached update status', async () => {
    redisGet.mockImplementation((key: string) => {
      if (key === 'version:latest') {
        return Promise.resolve(
          JSON.stringify({
            tag_name: 'v0.1.0',
            body: 'Test release notes',
            published_at: '2026-07-03T15:37:06Z',
            html_url:
              'https://github.com/sil3ntcor3/open-asm/releases/tag/v0.1.0',
          }),
        );
      }
      if (key === 'version:last_check') {
        return Promise.resolve('2026-07-19T14:00:00.000Z');
      }
      return Promise.resolve(null);
    });

    await expect(service.getLatestVersion()).resolves.toEqual({
      currentVersion: '0.1.0-dev.42+abc123',
      currentCommit: 'abc123',
      channel: 'dev',
      latestVersion: '0.1.0',
      isLatest: true,
      notes: 'Test release notes',
      releaseDate: '2026-07-03T15:37:06Z',
      releaseUrl: 'https://github.com/sil3ntcor3/open-asm/releases/tag/v0.1.0',
      lastCheckedAt: '2026-07-19T14:00:00.000Z',
    });
  });

  it('reports an unavailable update check without hiding the installed version', async () => {
    redisGet.mockResolvedValue(null);

    await expect(service.getLatestVersion()).resolves.toEqual({
      currentVersion: '0.1.0-dev.42+abc123',
      currentCommit: 'abc123',
      channel: 'dev',
      latestVersion: null,
      isLatest: null,
      notes: null,
      releaseDate: null,
      releaseUrl: null,
      lastCheckedAt: null,
    });
  });
});
