import { Public, Roles } from '@/common/decorators/app.decorator';
import { Doc } from '@/common/doc/doc.decorator';
import { DefaultMessageResponseDto } from '@/common/dtos/default-message-response.dto';
import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Role } from '@/common/enums/enum';
import { BOOTSTRAP_AUTHORIZATION_TTL_MS } from './bootstrap-authorization';
import {
  AuthorizeFirstAdminDto,
  CreateFirstAdminDto,
  GetMetadataDto,
  GetVersionDto,
} from './dto/root.dto';
import { RootService } from './root.service';

const BOOTSTRAP_COOKIE_NAME = 'oasm_admin_bootstrap';
const BOOTSTRAP_COOKIE_PATH = '/api/init-admin';

@ApiTags('Root')
@Controller()
export class RootController {
  constructor(private readonly rootService: RootService) {}

  @Public()
  @Get('health')
  getHealth(): string {
    return this.rootService.getHealth();
  }

  @Public()
  @Doc({
    summary: 'Creates the first admin user in the system.',
    description: 'Creates the first admin user in the system.',
    response: {
      serialization: DefaultMessageResponseDto,
    },
  })
  @Post('init-admin')
  async createFirstAdmin(
    @Body() dto: CreateFirstAdminDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DefaultMessageResponseDto> {
    const authorization = request.cookies?.[BOOTSTRAP_COOKIE_NAME] as
      | string
      | undefined;
    const origin = request.headers.origin;
    const result = await this.rootService.createFirstAdmin(
      dto,
      authorization,
      typeof origin === 'string' ? origin : undefined,
    );
    response.clearCookie(BOOTSTRAP_COOKIE_NAME, {
      httpOnly: true,
      path: BOOTSTRAP_COOKIE_PATH,
      sameSite: 'strict',
    });
    return result;
  }

  @Public()
  @ApiExcludeEndpoint()
  @Get('init-admin/authorize')
  async authorizeFirstAdmin(
    @Query() dto: AuthorizeFirstAdminDto,
    @Res() response: Response,
  ): Promise<void> {
    const { authorization, secure } =
      await this.rootService.authorizeFirstAdmin(dto.ticket);
    response.cookie(BOOTSTRAP_COOKIE_NAME, authorization, {
      httpOnly: true,
      maxAge: BOOTSTRAP_AUTHORIZATION_TTL_MS,
      path: BOOTSTRAP_COOKIE_PATH,
      sameSite: 'strict',
      secure,
    });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.redirect(303, '/init-admin');
  }

  @Public()
  @Doc({
    summary: 'Get system metadata.',
    description:
      'Returns metadata about the system state, like whether it has been initialized.',
    response: {
      serialization: GetMetadataDto,
    },
  })
  @Get('metadata')
  getMetadata() {
    return this.rootService.getMetadata();
  }

  @Public()
  @Doc({
    summary: 'Get the latest version.',
    description: 'Returns the latest version information stored in Redis.',
    response: {
      serialization: GetVersionDto,
    },
  })
  @Get('version/latest')
  getLatestVersion(): Promise<GetVersionDto> {
    return this.rootService.getLatestVersion();
  }

  @Roles(Role.ADMIN)
  @Doc({
    summary: 'Check for updates.',
    description:
      'Refreshes release information from GitHub and returns the current update status.',
    response: {
      serialization: GetVersionDto,
    },
  })
  @Post('version/check')
  checkForUpdates(): Promise<GetVersionDto> {
    return this.rootService.checkForUpdates();
  }
}
