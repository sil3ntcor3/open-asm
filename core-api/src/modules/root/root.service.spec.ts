import { RedisService } from '@/services/redis/redis.service';
import { ConfigService } from '@nestjs/config';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { SystemConfigsService } from '../system-configs/system-configs.service';
import { UsersService } from '../users/users.service';
import type { CreateFirstAdminDto } from './dto/root.dto';
import { RootService } from './root.service';

const BOOTSTRAP_SECRET = 'a-secure-bootstrap-token-with-32-chars';
const AUTHORIZATION_TTL_MS = 15 * 60 * 1000;
const TEST_NOW = new Date('2026-08-20T12:00:00.000Z');

function createAuthorization(
  context: 'link' | 'session',
  expiresAt: number,
): string {
  const nonce = 'test-bootstrap-nonce';
  const signature = createHmac('sha256', BOOTSTRAP_SECRET)
    .update(`${context}:${expiresAt}:${nonce}`)
    .digest('base64url');
  return `v1.${expiresAt}.${nonce}.${signature}`;
}

describe('RootService', () => {
  let service: RootService;
  let redisGet: jest.Mock;
  let redisSet: jest.Mock;
  let createFirstAdmin: jest.Mock;
  let configValues: Record<string, string | undefined>;

  beforeEach(async () => {
    redisGet = jest.fn();
    const consumedAuthorizations = new Set<string>();
    redisSet = jest.fn((key: string) => {
      if (consumedAuthorizations.has(key)) return Promise.resolve(null);
      consumedAuthorizations.add(key);
      return Promise.resolve('OK');
    });
    createFirstAdmin = jest.fn();
    configValues = {
      ADMIN_BOOTSTRAP_TOKEN: BOOTSTRAP_SECRET,
      OASM_CONSOLE_URL: 'https://openasm.example.com',
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
            createFirstAdmin,
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
            cacheClient: {
              set: redisSet,
            },
          },
        },
      ],
    }).compile();

    service = module.get<RootService>(RootService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rejects first-admin creation without a signed browser authorization', async () => {
    await expect(
      service.createFirstAdmin({
        email: 'admin@example.com',
        password: 'correct horse battery staple',
      } as CreateFirstAdminDto),
    ).rejects.toThrow('Invalid bootstrap authorization');
    expect(createFirstAdmin).not.toHaveBeenCalled();
  });

  it('exchanges a short-lived setup link for authorization without form token input', async () => {
    jest.useFakeTimers().setSystemTime(TEST_NOW);
    const link = createAuthorization(
      'link',
      TEST_NOW.getTime() + AUTHORIZATION_TTL_MS,
    );
    const revisedService = service as unknown as {
      authorizeFirstAdmin(ticket: string): Promise<{
        authorization: string;
        secure: boolean;
      }>;
      createFirstAdmin(
        dto: CreateFirstAdminDto,
        authorization?: string,
        origin?: string,
      ): Promise<{ message: string }>;
    };
    const { authorization, secure } =
      await revisedService.authorizeFirstAdmin(link);

    expect(secure).toBe(true);

    await expect(
      revisedService.createFirstAdmin(
        {
          email: 'admin@example.com',
          password: 'correct horse battery staple',
        } as CreateFirstAdminDto,
        authorization,
        'https://openasm.example.com',
      ),
    ).resolves.toEqual({ message: 'Admin user created successfully' });
    expect(createFirstAdmin).toHaveBeenCalledWith(
      'admin@example.com',
      'correct horse battery staple',
    );
  });

  it('rejects a valid browser authorization from a different origin', async () => {
    jest.useFakeTimers().setSystemTime(TEST_NOW);
    const link = createAuthorization(
      'link',
      TEST_NOW.getTime() + AUTHORIZATION_TTL_MS,
    );
    const revisedService = service as unknown as {
      authorizeFirstAdmin(ticket: string): Promise<{
        authorization: string;
        secure: boolean;
      }>;
      createFirstAdmin(
        dto: CreateFirstAdminDto,
        authorization?: string,
        origin?: string,
      ): Promise<{ message: string }>;
    };
    const { authorization } = await revisedService.authorizeFirstAdmin(link);

    await expect(
      revisedService.createFirstAdmin(
        {
          email: 'admin@example.com',
          password: 'correct horse battery staple',
        } as CreateFirstAdminDto,
        authorization,
        'https://attacker.example.com',
      ),
    ).rejects.toThrow('Invalid bootstrap authorization');
    expect(createFirstAdmin).not.toHaveBeenCalled();
  });

  it('does not accept an activation-link ticket as browser authorization', async () => {
    jest.useFakeTimers().setSystemTime(TEST_NOW);
    const link = createAuthorization(
      'link',
      TEST_NOW.getTime() + AUTHORIZATION_TTL_MS,
    );
    const revisedService = service as unknown as {
      createFirstAdmin(
        dto: CreateFirstAdminDto,
        authorization?: string,
        origin?: string,
      ): Promise<{ message: string }>;
    };

    await expect(
      revisedService.createFirstAdmin(
        {
          email: 'admin@example.com',
          password: 'correct horse battery staple',
        } as CreateFirstAdminDto,
        link,
        'https://openasm.example.com',
      ),
    ).rejects.toThrow('Invalid bootstrap authorization');
    expect(createFirstAdmin).not.toHaveBeenCalled();
  });

  it('rejects an expired setup link', async () => {
    jest.useFakeTimers().setSystemTime(TEST_NOW);
    const expiredLink = createAuthorization('link', TEST_NOW.getTime() - 1);
    const revisedService = service as unknown as {
      authorizeFirstAdmin(ticket: string): Promise<unknown>;
    };

    await expect(
      revisedService.authorizeFirstAdmin(expiredLink),
    ).rejects.toThrow('Invalid bootstrap authorization');
    expect(redisSet).not.toHaveBeenCalled();
  });

  it('atomically rejects replay of an exchanged setup link', async () => {
    jest.useFakeTimers().setSystemTime(TEST_NOW);
    const link = createAuthorization(
      'link',
      TEST_NOW.getTime() + AUTHORIZATION_TTL_MS,
    );
    const revisedService = service as unknown as {
      authorizeFirstAdmin(ticket: string): Promise<unknown>;
    };

    await expect(revisedService.authorizeFirstAdmin(link)).resolves.toEqual(
      expect.objectContaining({ secure: true }),
    );
    await expect(revisedService.authorizeFirstAdmin(link)).rejects.toThrow(
      'Invalid bootstrap authorization',
    );
    expect(redisSet).toHaveBeenCalledTimes(2);
    expect(redisSet).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^bootstrap:first-admin:[a-f0-9]{64}$/),
      '1',
      'PX',
      AUTHORIZATION_TTL_MS,
      'NX',
    );
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
