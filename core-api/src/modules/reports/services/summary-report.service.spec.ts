import { JobStatus, Severity } from '@/common/enums/enum';
import { AssetTag } from '@/modules/assets/entities/asset-tags.entity';
import { AssetService } from '@/modules/assets/entities/asset-services.entity';
import { StatisticService } from '@/modules/statistic/statistic.service';
import { Target, TargetType } from '@/modules/targets/entities/target.entity';
import { Vulnerability } from '@/modules/vulnerabilities/entities/vulnerability.entity';
import { Workspace } from '@/modules/workspaces/entities/workspace.entity';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { SummaryReportService } from './summary-report.service';

describe('SummaryReportService', () => {
  let service: SummaryReportService;
  let mockTargetRepo: { query: jest.Mock };

  beforeEach(async () => {
    mockTargetRepo = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SummaryReportService,
        { provide: getRepositoryToken(Vulnerability), useValue: {} },
        { provide: getRepositoryToken(Target), useValue: mockTargetRepo },
        { provide: getRepositoryToken(AssetService), useValue: {} },
        { provide: getRepositoryToken(AssetTag), useValue: {} },
        { provide: getRepositoryToken(Workspace), useValue: {} },
        { provide: StatisticService, useValue: {} },
      ],
    }).compile();

    service = module.get<SummaryReportService>(SummaryReportService);
  });

  describe('getTargets', () => {
    const workspaceId = randomUUID();
    const targetId = randomUUID();

    it('fetches top targets with one parameterized query and maps the rows', async () => {
      mockTargetRepo.query.mockResolvedValue([
        {
          t_id: targetId,
          t_value: 'example.com',
          t_type: TargetType.DOMAIN,
          t_lastDiscoveredAt: null,
          vulnCount: '7',
          targetStatus: JobStatus.COMPLETED,
        },
      ]);

      const result = await (
        service as unknown as {
          getTargets: SummaryReportService['getTargets'];
        }
      ).getTargets(workspaceId);

      expect(result).toEqual([
        {
          id: targetId,
          identifier: 'example.com',
          type: TargetType.DOMAIN,
          status: JobStatus.COMPLETED,
          riskLevel: Severity.HIGH,
          provider: 'OpenASM',
          lastScan: 'Never',
        },
      ]);

      const [sql, params] = mockTargetRepo.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params).toEqual([workspaceId, 10]);
      // Regression guard: vulnerabilities and jobs must each be aggregated in
      // their own LATERAL subquery. Joining them as siblings off assets forms
      // a vulns x jobs cartesian product per asset, which exceeds
      // statement_timeout on well-scanned targets (see getTargetsInWorkspace).
      expect(sql).toContain('LATERAL');
    });

    it('passes date range, target filter and limit as parameters', async () => {
      mockTargetRepo.query.mockResolvedValue([]);
      const startDate = new Date('2026-06-01T00:00:00Z');
      const endDate = new Date('2026-07-01T00:00:00Z');
      const targetIds = [randomUUID(), randomUUID()];

      await (
        service as unknown as {
          getTargets: SummaryReportService['getTargets'];
        }
      ).getTargets(workspaceId, { startDate, endDate, targetIds }, 5);

      const [, params] = mockTargetRepo.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params).toEqual([workspaceId, startDate, endDate, targetIds, 5]);
    });
  });
});
