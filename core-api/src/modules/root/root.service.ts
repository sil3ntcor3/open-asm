import { DefaultMessageResponseDto } from '@/common/dtos/default-message-response.dto';
import { Role } from '@/common/enums/enum';
import { ReleaseVersion } from '@/common/interfaces/app.interface';
import { RedisService } from '@/services/redis/redis.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { SystemConfigsService } from '../system-configs/system-configs.service';
import { UsersService } from '../users/users.service';
import {
  BOOTSTRAP_AUTHORIZATION_TTL_MS,
  exchangeBootstrapLinkTicket,
  isValidBootstrapSession,
} from './bootstrap-authorization';
import {
  CreateFirstAdminDto,
  GetMetadataDto,
  GetVersionDto,
} from './dto/root.dto';

@Injectable()
export class RootService {
  constructor(
    private readonly usersService: UsersService,
    private readonly systemConfigsService: SystemConfigsService,
    private configService: ConfigService,
    private redisService: RedisService,
  ) {}

  public getHealth(): string {
    return 'OK';
  }

  /**
   * Creates the first admin user in the system.
   * @param dto The data transfer object containing the email and password for the admin user.
   * @param authorization The short-lived browser authorization from the setup link.
   * @param origin The browser Origin header, which must match the configured console.
   * @returns A promise that resolves to a default message response dto.
   */
  public async createFirstAdmin(
    dto: CreateFirstAdminDto,
    authorization?: string,
    origin?: string,
  ): Promise<DefaultMessageResponseDto> {
    const expectedOrigin = this.getConfiguredConsoleUrl()?.origin;
    if (
      !expectedOrigin ||
      origin !== expectedOrigin ||
      !isValidBootstrapSession(
        this.configService.get<string>('ADMIN_BOOTSTRAP_TOKEN'),
        authorization,
      )
    ) {
      throw new UnauthorizedException('Invalid bootstrap authorization');
    }
    const { email, password } = dto;
    await this.usersService.createFirstAdmin(email, password);
    return {
      message: 'Admin user created successfully',
    };
  }

  /** Exchanges and consumes a signed setup-link ticket for browser authorization. */
  public async authorizeFirstAdmin(ticket: string): Promise<{
    authorization: string;
    secure: boolean;
  }> {
    const authorization = exchangeBootstrapLinkTicket(
      this.configService.get<string>('ADMIN_BOOTSTRAP_TOKEN'),
      ticket,
    );
    const consoleUrl = this.getConfiguredConsoleUrl();
    if (!authorization || !consoleUrl) {
      throw new UnauthorizedException('Invalid bootstrap authorization');
    }

    const ticketDigest = createHash('sha256').update(ticket).digest('hex');
    const consumed = await this.redisService.cacheClient.set(
      `bootstrap:first-admin:${ticketDigest}`,
      '1',
      'PX',
      BOOTSTRAP_AUTHORIZATION_TTL_MS,
      'NX',
    );
    if (consumed !== 'OK') {
      throw new UnauthorizedException('Invalid bootstrap authorization');
    }

    return {
      authorization,
      secure: consoleUrl.protocol === 'https:',
    };
  }

  /**
   * Get system metadata.
   * @returns A promise that resolves to a get metadata dto.
   */
  public async getMetadata(): Promise<GetMetadataDto> {
    const MILLISECONDS_PER_SECOND = 100;
    const SECONDS_PER_MINUTE = 60;
    const MINUTES_PER_HOUR = 60;
    const HOURS_PER_DAY = 24;
    const DAYS_PER_YEAR = 365;

    const isInit = await this.usersService.usersRepository.exists({
      where: {
        role: Role.ADMIN,
      },
      cache: {
        id: 'isInit',
        milliseconds:
          MILLISECONDS_PER_SECOND *
          SECONDS_PER_MINUTE *
          MINUTES_PER_HOUR *
          HOURS_PER_DAY *
          DAYS_PER_YEAR,
      },
    });
    const isAssistant = false;

    const systemConfig = await this.systemConfigsService.getConfig();

    const currentVersion = this.configService.get<string>('APP_VERSION');

    return {
      isInit,
      isAssistant,
      name: systemConfig.name,
      logoPath: systemConfig.logoPath,
      currentVersion: currentVersion || null,
    };
  }

  /**
   * Get the latest version from Redis.
   * @returns A promise that resolves to the latest version data.
   * @throws NotFoundException if the version data is not found.
   */
  public async getLatestVersion(): Promise<GetVersionDto> {
    const VERSION_KEY = 'version:latest';
    const LAST_CHECK_KEY = 'version:last_check';
    const [data, lastCheckedAt] = await Promise.all([
      this.redisService.get(VERSION_KEY),
      this.redisService.get(LAST_CHECK_KEY),
    ]);
    const parsed = data ? (JSON.parse(data) as ReleaseVersion) : null;
    const latestVersion = this.normalizeVersion(parsed?.tag_name);
    const currentVersion = this.normalizeVersion(
      this.configService.get<string>('APP_VERSION'),
    );

    return {
      currentVersion,
      currentCommit: this.configService.get<string>('APP_COMMIT') || null,
      channel: this.configService.get<string>('APP_CHANNEL') || null,
      latestVersion,
      isLatest: this.isCurrentVersionAtLeast(currentVersion, latestVersion),
      notes: parsed?.body || null,
      releaseDate: parsed?.published_at || null,
      releaseUrl: parsed?.html_url || null,
      lastCheckedAt: lastCheckedAt || null,
    };
  }

  public async checkForUpdates(): Promise<GetVersionDto> {
    await this.systemConfigsService.checkForUpdates(true);
    return this.getLatestVersion();
  }

  private normalizeVersion(version?: string | null): string | null {
    const normalized = version?.trim().replace(/^v/, '');
    return normalized || null;
  }

  private isCurrentVersionAtLeast(
    currentVersion: string | null,
    latestVersion: string | null,
  ): boolean | null {
    const current = this.getCoreSemver(currentVersion);
    const latest = this.getCoreSemver(latestVersion);

    if (!current || !latest) {
      return null;
    }

    for (let index = 0; index < current.length; index += 1) {
      if (current[index] > latest[index]) return true;
      if (current[index] < latest[index]) return false;
    }

    return true;
  }

  private getCoreSemver(version: string | null): number[] | null {
    const match = version?.match(/^(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
  }

  private getConfiguredConsoleUrl(): URL | null {
    const configuredUrl = this.configService.get<string>('OASM_CONSOLE_URL');
    if (!configuredUrl) return null;

    try {
      const url = new URL(configuredUrl);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        return null;
      }
      return url;
    } catch {
      return null;
    }
  }
}
