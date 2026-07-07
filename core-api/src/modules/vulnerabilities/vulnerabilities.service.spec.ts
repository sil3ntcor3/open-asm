import { Severity } from '@/common/enums/enum';
import { VulnerabilityStatus } from './dto/get-vulnerability.dto';
import { VulnerabilitiesService } from './vulnerabilities.service';

describe('VulnerabilitiesService', () => {
  const createQueryBuilderMock = () => {
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue([{ severity: Severity.HIGH, count: '2' }]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    return queryBuilder;
  };

  const createService = (
    queryBuilder: ReturnType<typeof createQueryBuilderMock>,
  ) => {
    const vulnerabilitiesRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    return new VulnerabilitiesService(
      vulnerabilitiesRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  };

  describe('getVulnerabilitiesStatistics', () => {
    it('applies the same non-pagination filters used by the vulnerabilities table', async () => {
      const queryBuilder = createQueryBuilderMock();
      const service = createService(queryBuilder);
      const expectedEndDate = new Date('2026-01-31');
      expectedEndDate.setHours(23, 59, 59, 999);

      await service.getVulnerabilitiesStatistics({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        status: VulnerabilityStatus.DISMISSED,
        severity: [Severity.HIGH],
        createdFrom: '2026-01-01',
        createdTo: '2026-01-31',
        tags: ['rce'],
        targetId: '00000000-0000-4000-8000-000000000002',
        q: 'openssl',
      });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'targets.id = :targetId',
        { targetId: '00000000-0000-4000-8000-000000000002' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '"vulnerabilities"."name" ILIKE :q   ',
        {
          q: '%openssl%',
          qArray: '%openssl%',
        },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'dismissal.vulnerabilityId IS NOT NULL',
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'vulnerabilities.severity IN (:...severity)',
        { severity: [Severity.HIGH] },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'vulnerabilities.createdAt >= :createdFrom',
        { createdFrom: new Date('2026-01-01') },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'vulnerabilities.createdAt <= :createdTo',
        { createdTo: expectedEndDate },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(:tag0 = ANY(vulnerabilities.tags))',
        { tag0: 'rce' },
      );
    });
  });
});
