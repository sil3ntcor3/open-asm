import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, type EntityManager, type Repository } from 'typeorm';
import { Role } from '@/common/enums/enum';
import { AuthService } from '../auth/auth.service';
import { User } from '../auth/entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let mockUserRepository: Partial<Repository<User>>;
  let mockAuthService: Partial<AuthService>;
  let mockEntityManager: Partial<EntityManager>;
  let transaction: jest.Mock;

  beforeEach(async () => {
    mockUserRepository = {
      count: jest.fn(),
      update: jest.fn(),
    };

    mockEntityManager = {
      getRepository: jest.fn().mockReturnValue(mockUserRepository),
      query: jest.fn().mockResolvedValue([]),
    };

    let transactionTail = Promise.resolve();
    transaction = jest.fn(
      <T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> => {
        const result = transactionTail.then(() =>
          operation(mockEntityManager as EntityManager),
        );
        transactionTail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    );

    mockAuthService = {
      api: {
        signUpEmail: jest.fn(),
        signInEmail: jest.fn(),
      } as any,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: DataSource,
          useValue: { transaction },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('serializes concurrent first-admin creation before checking for an administrator', async () => {
    let adminExists = false;
    const countAdmins = jest
      .spyOn(mockUserRepository, 'count')
      .mockImplementation(() => Promise.resolve(adminExists ? 1 : 0));
    const promoteAdmin = jest
      .spyOn(mockUserRepository, 'update')
      .mockImplementation(() => {
        adminExists = true;
        return Promise.resolve({ affected: 1, generatedMaps: [], raw: [] });
      });
    const signUpEmail = jest
      .spyOn(mockAuthService.api!, 'signUpEmail')
      .mockResolvedValue({ user: { id: 'first-admin-id' } } as never);
    jest
      .spyOn(mockAuthService.api!, 'signInEmail')
      .mockResolvedValue({ token: 'session-token' } as never);

    const results = await Promise.allSettled([
      service.createFirstAdmin(
        'first-admin@example.com',
        'correct horse battery staple',
      ),
      service.createFirstAdmin(
        'attacker@example.com',
        'correct horse battery staple',
      ),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    expect(signUpEmail).toHaveBeenCalledTimes(1);
    expect(mockEntityManager.query).toHaveBeenCalledTimes(2);
    expect(mockEntityManager.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.any(Array),
    );
    expect(mockUserRepository.count).toHaveBeenCalledWith({
      where: { role: Role.ADMIN },
    });
    const lockAdminCreation = mockEntityManager.query as jest.Mock;
    expect(lockAdminCreation.mock.invocationCallOrder[0]).toBeLessThan(
      countAdmins.mock.invocationCallOrder[0],
    );
    expect(countAdmins.mock.invocationCallOrder[0]).toBeLessThan(
      signUpEmail.mock.invocationCallOrder[0],
    );
    expect(signUpEmail.mock.invocationCallOrder[0]).toBeLessThan(
      promoteAdmin.mock.invocationCallOrder[0],
    );
  });
});
