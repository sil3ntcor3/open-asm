import { WorkspaceId } from '@/common/decorators/workspace-id.decorator';
import { Doc } from '@/common/doc/doc.decorator';
import { WORKSPACE_HEADER_NAME } from '@/common/constants/app.constants';
import { WorkspaceAction } from '@/common/authorization/workspace-action.enum';
import { WorkspacePolicy } from '@/common/authorization/workspace-policy.decorator';
import { GetManyResponseDto } from '@/utils/getManyResponse';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AssetsService } from './assets.service';
import { GetAssetsQueryDto, GetAssetsResponseDto } from './dto/assets.dto';
import { GetIpAssetsDTO } from './dto/get-ip-assets.dto';
import { GetPortAssetsDTO } from './dto/get-port-assets.dto';
import { GetStatusCodeAssetsDTO } from './dto/get-status-code-assets.dto';
import { GetTechnologyAssetsDTO } from './dto/get-technology-assets.dto';
import { SwitchAssetDto } from './dto/switch-asset.dto';
import { GetTlsResponseDto, GetTlsQueryDto } from './dto/tls.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { GetHostAssetsDTO } from './dto/get-host-assets.dto';
import {
  AssetExportFormat,
  ExportAssetsQueryDto,
} from './dto/export-assets.dto';
import { buildCsvExport, buildXlsxExport } from './utils/asset-export.util';

const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('Assets')
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Doc({
    summary: 'Get assets in target',
    description: 'Retrieves a list of assets associated with the given target.',
    response: {
      serialization: GetManyResponseDto(GetAssetsResponseDto),
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  @Get()
  getAssetsInWorkspace(
    @Query() query: GetAssetsQueryDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.assetsService.getManyAsssetServices(query, workspaceId);
  }

  @Doc({
    summary: 'Get IP asset',
    description: 'Retrieves a list of ip with number of assets.',
    response: {
      serialization: GetManyResponseDto(GetIpAssetsDTO),
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  @Get('/ip')
  getIpAssets(
    @Query() query: GetAssetsQueryDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.assetsService.getIpAssets(query, workspaceId);
  }

  @Doc({
    summary: 'Get host asset',
    description: 'Retrieves a list of host with number of assets.',
    response: {
      serialization: GetManyResponseDto(GetHostAssetsDTO),
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  @Get('/host')
  getHostAssets(
    @Query() query: GetAssetsQueryDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.assetsService.getHostAssets(query, workspaceId);
  }

  @Doc({
    summary: 'Get ports and number of assets',
    description: 'Retrieves a list of port with number of assets.',
    response: {
      serialization: GetManyResponseDto(GetPortAssetsDTO),
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  @Get('/port')
  getPortAssets(
    @Query() query: GetAssetsQueryDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.assetsService.getPortAssets(query, workspaceId);
  }

  @Doc({
    summary: 'Get technologies along with number of assets',
    description: 'Retrieves a list of technologies with number of assets.',
    response: {
      serialization: GetManyResponseDto(GetTechnologyAssetsDTO),
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  @Get('/tech')
  getTechnologyAssets(
    @Query() query: GetAssetsQueryDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.assetsService.getTechnologyAssets(query, workspaceId);
  }

  @Doc({
    summary: 'Get technologies along with number of assets',
    description: 'Retrieves a list of technologies with number of assets.',
    response: {
      serialization: GetManyResponseDto(GetStatusCodeAssetsDTO),
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  @Get('/status-code')
  getStatusCodeAssets(
    @Query() query: GetAssetsQueryDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.assetsService.getStatusCodeAssets(query, workspaceId);
  }

  @Doc({
    summary: 'Get TLS certificates',
    description:
      'Retrieves a paginated list of TLS certificates with filtering and sorting support.',
    response: {
      serialization: GetManyResponseDto(GetTlsResponseDto),
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  @Get('/tls')
  getTlsAssets(
    @Query() query: GetTlsQueryDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.assetsService.getManyTls(query, workspaceId);
  }

  @ApiOperation({
    summary: 'Export assets',
    description:
      'Exports all filtered rows from the selected Assets view as CSV or XLSX.',
  })
  @ApiHeader({
    name: WORKSPACE_HEADER_NAME,
    description: 'Workspace ID',
  })
  @ApiProduces('text/csv', XLSX_CONTENT_TYPE)
  @ApiResponse({
    status: 200,
    description: 'Assets export file',
    content: {
      'text/csv': { schema: { type: 'string', format: 'binary' } },
      [XLSX_CONTENT_TYPE]: {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  @Get('/export')
  async exportAssets(
    @Query() query: ExportAssetsQueryDto,
    @WorkspaceId() workspaceId: string,
    @Res() res: Response,
  ): Promise<void> {
    const sheet = await this.assetsService.getAssetsForExport(
      query,
      workspaceId,
    );
    const isXlsx = query.format === AssetExportFormat.XLSX;
    const file = isXlsx
      ? buildXlsxExport(sheet.sheetName, sheet.columns, sheet.rows)
      : buildCsvExport(sheet.columns, sheet.rows);
    const extension = isXlsx ? 'xlsx' : 'csv';

    res.setHeader(
      'Content-Type',
      isXlsx ? XLSX_CONTENT_TYPE : 'text/csv; charset=utf-8',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="assets-${query.view}-${workspaceId}.${extension}"`,
    );
    res.setHeader('Content-Length', file.length);
    res.send(file);
  }

  @Doc({
    summary: 'Get asset by ID',
    description: 'Retrieves a single asset by its ID.',
    response: {
      serialization: GetAssetsResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  @Get(':id')
  getAssetById(@Param('id') id: string, @WorkspaceId() workspaceId: string) {
    return this.assetsService.getAssetById(id, workspaceId);
  }

  @Doc({
    summary: 'Update asset by ID',
    description: 'Updates an asset by its ID. Only tags can be updated.',
    response: {
      serialization: GetAssetsResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @WorkspacePolicy(WorkspaceAction.TARGET_MANAGE)
  @Patch(':id')
  updateAssetById(
    @Param('id') id: string,
    @Body() updateAssetDto: UpdateAssetDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.assetsService.updateAssetById(id, updateAssetDto, workspaceId);
  }

  @Doc({
    summary: 'Switch asset enabled/disabled',
    description: 'Toggle the enabled/disabled status of an asset.',
    response: {
      serialization: GetAssetsResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @WorkspacePolicy(WorkspaceAction.TARGET_MANAGE)
  @Post('/switch')
  switchAsset(
    @Body() switchAssetDto: SwitchAssetDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.assetsService.switchAsset(
      switchAssetDto.assetId,
      switchAssetDto.isEnabled,
      workspaceId,
    );
  }

  @Doc({
    summary: 'Export services to CSV',
    description:
      'Exports all services in a workspace to a CSV file containing value, ports, technologies, and TLS information for reporting and analysis purposes.',
    response: {
      description: 'CSV file containing services data',
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  @Get('services/export')
  async exportServicesToCSV(
    @WorkspaceId() workspaceId: string,
    @Res() res: Response,
  ) {
    // Helper function to format date as DD-MM-YYYY
    const formatDate = (date: Date | null | undefined): string => {
      if (!date) return '';
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    };

    const services = await this.assetsService.exportServicesForCSV(workspaceId);
    const file = buildCsvExport(
      [
        { key: 'value', header: 'value' },
        { key: 'ports', header: 'ports' },
        { key: 'techs', header: 'techs' },
        { key: 'tlsHost', header: 'tls_host' },
        { key: 'tlsSni', header: 'tls_sni' },
        { key: 'tlsSubjectDn', header: 'tls_subject_dn' },
        { key: 'tlsNotAfter', header: 'tls_not_after' },
        { key: 'tlsNotBefore', header: 'tls_not_before' },
        { key: 'tlsConnection', header: 'tls_connection' },
      ],
      services.map((service) => ({
        ports: service.ports?.join(',') ?? '',
        techs: service.techs?.join(',') ?? '',
        tlsConnection: service.tls?.tls_connection ?? '',
        tlsHost: service.tls?.host ?? '',
        tlsNotAfter: service.tls?.not_after
          ? formatDate(new Date(service.tls.not_after))
          : '',
        tlsNotBefore: service.tls?.not_before
          ? formatDate(new Date(service.tls.not_before))
          : '',
        tlsSni: service.tls?.sni ?? '',
        tlsSubjectDn: service.tls?.subject_dn ?? '',
        value: service.value,
      })),
    );

    // Set response headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="services_${workspaceId}.csv"`,
    );
    res.setHeader('Content-Length', file.length);

    res.send(file);
  }
}
