import { BOT_ID } from '@/common/constants/app.constants';
import {
  ScreenshotPayload,
  ServiceDiscoveryPayload,
} from '@/common/interfaces/app.interface';
import { JobDataResultType } from '@/common/types/app.types';
import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as crypto from 'crypto';
import { DataSource, EntityManager, InsertResult } from 'typeorm';
import {
  DnsResolutionStatus,
  IssueSourceType,
  Severity,
  ToolCategory,
} from '../../common/enums/enum';
import { AssetService } from '../assets/entities/asset-services.entity';
import { AssetTag } from '../assets/entities/asset-tags.entity';
import { Asset } from '../assets/entities/assets.entity';
import { HttpResponse } from '../assets/entities/http-response.entity';
import { Port } from '../assets/entities/ports.entity';
import { IssuesService } from '../issues/issues.service';
import { StorageService } from '../storage/storage.service';
import { Vulnerability } from '../vulnerabilities/entities/vulnerability.entity';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { DataAdapterInput } from './data-adapter.interface';
import {
  TARPIT_OPEN_PORT_THRESHOLD,
  WEB_PORT_FLOOR,
} from '@/common/constants/app.constants';

@Injectable()
export class DataAdapterService {
  private readonly logger = new Logger(DataAdapterService.name);

  constructor(
    private readonly dataSource: DataSource,
    private workspaceService: WorkspacesService,
    private issuesService: IssuesService,
    private storageService: StorageService,
  ) {}

  /**
   * Seeds the {@link WEB_PORT_FLOOR} endpoints for the given assets so the HTTP
   * probe always has a baseline to run, whatever the port scan did or didn't
   * return. See WEB_PORT_FLOOR for why coverage must not depend on naabu.
   *
   * Idempotent: conflicts on (assetId, port) refresh `value` only, so it never
   * disturbs ports naabu genuinely discovered, and re-running a discovery does
   * not duplicate rows.
   *
   * Takes an EntityManager rather than opening its own connection — callers are
   * already inside a transaction, and the pg pool is sized to the same value as
   * the result-processor concurrency, so grabbing a second connection while
   * holding a transaction can deadlock the pool.
   */
  private async ensureWebPortFloor(
    manager: EntityManager,
    assets: Array<{ id: string; value: string }>,
  ): Promise<void> {
    if (WEB_PORT_FLOOR.length === 0 || assets.length === 0) {
      return;
    }

    const floorServices = assets.flatMap((asset) =>
      WEB_PORT_FLOOR.map((port) => ({
        value: `${asset.value}:${port}`,
        port,
        assetId: asset.id,
      })),
    );

    await manager
      .createQueryBuilder()
      .insert()
      .into(AssetService)
      .values(floorServices)
      .orUpdate({
        conflict_target: ['assetId', 'port'],
        overwrite: ['value'],
      })
      .execute();
  }

  public async validateData<T extends object>(
    data: object | object[],
    cls: new () => T,
  ): Promise<boolean> {
    const arr = Array.isArray(data) ? data : [data];

    for (const item of arr) {
      const instance = plainToInstance(cls, item);
      const errors = await validate(instance as object);
      if (errors.length > 0) {
        return false;
      }
    }

    return true;
  }

  public async subdomains({
    data,
    job,
  }: DataAdapterInput<Asset[]>): Promise<InsertResult | void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Deduplicate data based on value
      const uniqueData = Array.from(
        new Map(data.map((asset) => [asset.value, asset])).values(),
      );

      const primaryAssets = uniqueData.find(
        (asset) => asset.value === job.asset.value,
      );

      // Update Asset
      await queryRunner.manager
        .createQueryBuilder()
        .update(Asset)
        .where({ id: job.asset.id })
        .set({
          isPrimary: true,
          dnsRecords: primaryAssets?.dnsRecords,
          dnsResolutionStatus:
            primaryAssets?.dnsResolutionStatus ??
            DnsResolutionStatus.UNRESOLVED,
        })
        .execute();

      const workspaceId = await this.workspaceService.getWorkspaceIdByTargetId(
        job.asset.target.id,
      );
      const workspaceConfigs =
        await this.workspaceService.getWorkspaceConfigValue(workspaceId!);

      // const workspaceId =
      // Insert Assets
      const insertResult = await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(Asset)
        .values(
          uniqueData.map((asset) => ({
            ...asset,
            target: { id: job.asset.target.id },
            isEnabled: workspaceConfigs.isAutoEnableAssetAfterDiscovered,
          })),
        )
        .orUpdate(
          ['dnsRecords', 'dnsResolutionStatus'],
          ['value', 'targetId'],
        )
        .returning(['id', 'value', 'dnsResolutionStatus'])
        .execute();

      // Seed the floor at discovery time rather than waiting for the port scan.
      // portsScanner applies it too, but only for assets whose naabu job actually
      // ran — an asset whose scan never completed (worker outage, target-wide
      // block, cancelled run) would otherwise never get an HTTP probe at all.
      //
      // Names that do not resolve are skipped: they are excluded from HTTP
      // probing anyway, so seeding them would add asset_services that are never
      // probed, never marked isErrorPage, and therefore inflate the target's
      // service count permanently.
      const discoveredAssets = (
        insertResult.raw as Array<{
          id: string;
          value: string;
          dnsResolutionStatus?: DnsResolutionStatus;
        }>
      )?.filter(
        (asset) =>
          asset?.id &&
          asset?.value &&
          asset.dnsResolutionStatus !== DnsResolutionStatus.UNRESOLVED,
      );

      if (discoveredAssets?.length) {
        await this.ensureWebPortFloor(queryRunner.manager, discoveredAssets);
      }

      await queryRunner.commitTransaction();
      return insertResult;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new Error(error);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * HTTP responses data normalization
   * @param param0
   * @returns
   */
  public async httpResponses({
    data,
    job,
  }: DataAdapterInput<HttpResponse>): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (job.assetServiceId) {
        // isErrorPage must track the *latest* probe outcome, not stay stuck at
        // whatever the first probe set. httpx reports failed=true only when it
        // could not obtain any HTTP response for this endpoint. Previously we
        // only ever set the flag true and never cleared it, so a service that
        // failed once stayed flagged forever — even after a later scan probed it
        // successfully. That left it excluded from every isErrorPage=false
        // consumer (e.g. the Targets "services" count), showing 0 services for a
        // target whose ports were up. Assign the current outcome unconditionally.
        await queryRunner.manager
          .createQueryBuilder()
          .update(AssetService)
          .set({ isErrorPage: Boolean(data.failed) })
          .where({ id: job.assetServiceId })
          .execute();
      }

      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(HttpResponse)
        .values({
          ...data,
          assetServiceId: job.assetService?.id,
          jobHistoryId: job.jobHistory.id,
        })
        .execute();

      await queryRunner.commitTransaction();

      return;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   *
   * @param param0
   * @returns
   */
  public async portsScanner({
    data,
    job,
  }: DataAdapterInput<number[]>): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // Filter out NaN values from the port array
    // Deduplicate ports
    const uniquePorts = [...new Set(data.filter((port) => !isNaN(port)))];

    try {
      // Insert ports data
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(Port)
        .values({
          ports: uniquePorts,
          assetId: job.asset.id,
          jobHistoryId: job.jobHistory.id,
        })
        .execute();

      // Tarpit guard. Target-side scan detection (a firewall or IPS answering
      // the SYN on every probed port) makes naabu report hundreds of "open"
      // ports for a single host. Those are not reachable services, and deriving
      // an asset_service from each one is corrosive twice over: it inflates the
      // inventory and service counts shown to the operator, and it multiplies
      // every downstream per-service step (nmap, httpx, screenshot) by the same
      // bogus factor. In the enerbank.com discovery, 121 of 338 assets came back
      // in the 50-435 open-port range and accounted for 27,318 of the 28,091
      // asset_services — the remaining 217 hosts produced under 800 between them.
      //
      // The raw Port row above is still written, so the scan result is preserved
      // for inspection and nothing is silently discarded; we only decline to
      // treat an implausible result as a set of real services.
      const isImplausiblePortCount =
        uniquePorts.length > TARPIT_OPEN_PORT_THRESHOLD;

      if (isImplausiblePortCount) {
        this.logger.warn(
          `Skipping asset service creation for ${job.asset.value}: ${uniquePorts.length} open ports exceeds the ${TARPIT_OPEN_PORT_THRESHOLD} threshold, treating the port scan as scan-detection noise`,
        );
      }

      // Insert asset services data
      if (!isImplausiblePortCount && uniquePorts && uniquePorts.length > 0) {
        const assetServices = uniquePorts.map((port) => ({
          value: `${job.asset.value}:${port}`,
          port: port,
          assetId: job.asset.id,
        }));

        await queryRunner.manager
          .createQueryBuilder()
          .insert()
          .into(AssetService)
          .values(assetServices)
          .orUpdate({
            conflict_target: ['assetId', 'port'],
            overwrite: ['value'],
          })
          .execute();
      }

      // The floor is applied unconditionally — and deliberately *after* the
      // branch above, so it still lands in the two cases that most need it: a
      // scan that returned nothing (blocked, rate-limited, or short-circuited by
      // the worker's edge detection) and a scan discarded as tarpit noise. Those
      // are precisely the paths that used to leave an asset with zero services
      // and therefore zero HTTP probes.
      await this.ensureWebPortFloor(queryRunner.manager, [
        { id: job.asset.id, value: job.asset.value },
      ]);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return;
  }

  /**
   * Vulnerabilities data normalization
   * @param param0
   * @returns
   */
  public async vulnerabilities({
    data,
    job,
  }: DataAdapterInput<Vulnerability[]>): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      if (data.length === 0) {
        return;
      }

      const now = new Date();
      const values = data.map((vuln) => {
        const stringHash = `${vuln.name}-${job.asset.id}-${job.tool.id}`;
        const fingerprint = crypto
          .createHash('md5')
          .update(stringHash)
          .digest('hex');
        return {
          ...vuln,
          fingerprint,
          assetId: job.asset.id,
          toolId: job.tool.id,
          asset: { id: job.asset.id },
          jobHistory: { id: job.jobHistory.id },
          tool: { id: job.tool.id },
          firstDetectedDate: now,
          lastSeenDate: now,
        };
      });

      // Deduplicate based on fingerprint
      const uniqueValues = Array.from(
        new Map(values.map((v) => [v.fingerprint, v])).values(),
      );

      const result = await manager
        .createQueryBuilder()
        .insert()
        .into(Vulnerability)
        .values(uniqueValues)
        .orUpdate({
          conflict_target: ['fingerprint'],
          overwrite: [
            'updatedAt',
            'severity',
            'description',
            'tags',
            'references',
            'authors',
            'affectedUrl',
            'ipAddress',
            'host',
            'ports',
            'cvssMetric',
            'cvssScore',
            'cveId',
            'cweId',
            'extractorName',
            'extractedResults',
            'evidence',
            'lastSeenDate',
          ],
        })
        .returning('*')
        .execute();

      const insertedVulnerabilities = result.raw as Vulnerability[];

      const uniqueVulnerabilities = Array.from(
        new Map(
          insertedVulnerabilities.map((vuln) => [vuln.fingerprint, vuln]),
        ).values(),
      );

      const vulsForAlert = uniqueVulnerabilities.filter(
        (vuln) =>
          vuln.severity &&
          [Severity.HIGH, Severity.CRITICAL].includes(vuln.severity),
      );

      if (vulsForAlert.length > 0) {
        const workspaceId = job.jobHistory.workflow?.workspace.id;

        if (!workspaceId) {
          this.logger.warn(
            'Workspace ID is missing from job history workflow, skipping issue creation',
          );
          return;
        }

        const vulnsWithoutExistingIssue = await Promise.all(
          vulsForAlert.map(async (v) => {
            const existing =
              await this.issuesService.findExistingOpenIssueBySource(
                v.id,
                IssueSourceType.VULNERABILITY,
                workspaceId,
              );
            return existing ? null : v;
          }),
        );

        const newVulsForAlert = vulnsWithoutExistingIssue.filter(
          (v): v is Vulnerability => v !== null,
        );

        if (newVulsForAlert.length > 0) {
          await Promise.all(
            newVulsForAlert.map((v) =>
              this.issuesService.createIssue(
                {
                  title: `[${v.severity.charAt(0).toUpperCase() + v.severity.slice(1).toLowerCase()}] ${v.name}`,
                  description: v.description,
                  sourceId: v.id,
                  sourceType: IssueSourceType.VULNERABILITY,
                },
                workspaceId,
                BOT_ID,
              ),
            ),
          );
        }
      }
    });
  }

  /**
   * Asset tags data normalization
   * @param param0
   * @returns
   * @example
   * {
   *   "tags": [
   *     {
   *       "key": "tag-key",
   *       "value": "tag-value"
   *     }
   *   ]
   * }
   */
  public async classifier({
    data,
    job,
  }: DataAdapterInput<AssetTag[]>): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(AssetTag)
      .values(
        data.map((tag) => ({
          ...tag,
          assetId: job.asset.id,
          toolId: job.tool.id,
        })),
      )
      .execute();
  }

  public async screenshot({
    data,
    job,
  }: DataAdapterInput<ScreenshotPayload>): Promise<void> {
    if (!data.screenshot || !data.url) {
      return;
    }

    const buffer = Buffer.from(data.screenshot, 'base64');
    const { path } = await this.storageService.uploadFile(
      `${crypto.createHash('md5').update(job.asset.value).digest('hex')}.png`,
      buffer,
      'screenshot',
    );
    if (path) {
      await this.dataSource
        .createQueryBuilder()
        .update(AssetService)
        .set({ screenshotPath: path })
        .where({ id: job.assetServiceId })
        .execute();
    }

    return;
  }

  /**
   * Persists nmap service-discovery results onto the asset_service. The worker
   * runs nmap against a single (host, port) and returns the parsed services as
   * JSON, so we match the entry for this service's port (falling back to the
   * first). `scheme` is stored only for web services, making it the gate the
   * screenshot step queries on.
   */
  public async serviceDiscovery({
    data,
    job,
  }: DataAdapterInput<ServiceDiscoveryPayload[]>): Promise<void> {
    if (!job.assetServiceId || !Array.isArray(data) || data.length === 0) {
      return;
    }

    const match =
      data.find((entry) => entry.port === job.assetService?.port) ?? data[0];
    if (!match) {
      return;
    }

    await this.dataSource
      .createQueryBuilder()
      .update(AssetService)
      .set({
        service: match.service || null,
        product: match.product || null,
        // Only web services carry a scheme; non-web services clear it so the
        // screenshot gate (scheme IS NOT NULL) never fires for them.
        scheme: match.isWeb ? match.scheme || null : null,
      })
      .where({ id: job.assetServiceId })
      .execute();

    return;
  }

  /**
   * Sync data based on tool category
   * @param payload Data to sync
   * @returns
   */
  public async syncData({
    job,
    data,
  }: DataAdapterInput<JobDataResultType>): Promise<void> {
    try {
      // Define type for sync function configuration
      type SyncFunctionConfig<T = unknown> = {
        handler: (data: DataAdapterInput<T>) => Promise<void | InsertResult>;
        validationClass?: new () => object;
      };

      // Map of tool categories to their corresponding sync functions and validation classes
      const syncFunctions: Partial<
        Record<ToolCategory, SyncFunctionConfig<unknown>>
      > = {
        [ToolCategory.PORTS_SCANNER]: {
          handler: (data: DataAdapterInput<number[]>) =>
            this.portsScanner(data),
        },
        [ToolCategory.SUBDOMAINS]: {
          handler: (data: DataAdapterInput<Asset[]>) => this.subdomains(data),
          // validationClass: Asset,
        },
        [ToolCategory.HTTP_PROBE]: {
          handler: (data: DataAdapterInput<HttpResponse>) =>
            this.httpResponses(data),
          // validationClass: HttpResponse, // no validate for now
        },
        [ToolCategory.VULNERABILITIES]: {
          handler: (data: DataAdapterInput<Vulnerability[]>) =>
            this.vulnerabilities(data),
          // validationClass: Vulnerability,
        },
        [ToolCategory.CLASSIFIER]: {
          handler: (data: DataAdapterInput<AssetTag[]>) =>
            this.classifier(data),
          validationClass: AssetTag,
        },
        [ToolCategory.SCREENSHOT]: {
          handler: (data: DataAdapterInput<ScreenshotPayload>) =>
            this.screenshot(data),
          validationClass: ScreenshotPayload,
        },
        [ToolCategory.SERVICE_DISCOVERY]: {
          handler: (data: DataAdapterInput<ServiceDiscoveryPayload[]>) =>
            this.serviceDiscovery(data),
        },
        // Note: ASSISTANT category is handled separately or not supported in this mapping
      };

      // Get the appropriate sync function based on category
      if (!job.tool.category) {
        throw new Error('Tool category is undefined');
      }

      const syncFunction = syncFunctions[job.tool.category];

      // Check if we have a function for this category
      if (!syncFunction) {
        throw new Error(`Unsupported tool category: ${job.tool.category}`);
      }

      // Validate data before syncing
      if (syncFunction.validationClass && data !== undefined) {
        const isValid = await this.validateData(
          data,
          syncFunction.validationClass,
        );
        if (!isValid) {
          throw new Error(
            `Data validation failed for category: ${job.tool.category}`,
          );
        }
      }

      // Call the appropriate sync function with proper type assertion
      const typedData = { job, data } as unknown as DataAdapterInput<unknown>;
      await syncFunction.handler(typedData);

      return;
    } catch (error) {
      throw new Error(error);
    }
  }
}
