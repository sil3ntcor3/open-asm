import { UserContext, WorkspaceId } from '@/common/decorators/app.decorator';
import { WorkspaceAction } from '@/common/authorization/workspace-action.enum';
import { WorkspacePolicy } from '@/common/authorization/workspace-policy.decorator';
import { Doc } from '@/common/doc/doc.decorator';
import { DefaultMessageResponseDto } from '@/common/dtos/default-message-response.dto';
import { IdQueryParamDto } from '@/common/dtos/id-query-param.dto';
import { UserContextPayload } from '@/common/interfaces/app.interface';
import { GetManyResponseDto } from '@/utils/getManyResponse';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  BulkTargetResultDto,
  CreateMultipleTargetsDto,
  DiscoverTargetsDto,
  DiscoverTargetsResultDto,
  GetManyTargetResponseDto,
  GetManyWorkspaceQueryParamsDto,
  UpdateTargetDto,
} from './dto/targets.dto';
import { Target } from './entities/target.entity';
import { TargetsService } from './targets.service';

@Controller('targets')
export class TargetsController {
  constructor(private readonly targetsService: TargetsService) {}

  @Doc({
    summary: 'Create multiple targets in bulk',
    description:
      'Creates multiple security testing targets in a single request, skipping any duplicates that already exist in the workspace. Supports both DOMAIN (root domain) and CIDR (/24 range only) types. Returns detailed results including created targets and skipped values.',
    response: {
      serialization: BulkTargetResultDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Post('bulk')
  @WorkspacePolicy(WorkspaceAction.TARGET_CREATE)
  createMultipleTargets(
    @Body() dto: CreateMultipleTargetsDto,
    @UserContext() userContext: UserContextPayload,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.targetsService.createMultipleTargets(
      dto,
      workspaceId,
      userContext,
    );
  }

  @Doc({
    summary: 'Start discovery on existing targets',
    description:
      'Starts discovery workflows for the specified targets. Targets that already have pending or in-progress jobs are skipped and reported in the response.',
    response: {
      serialization: DiscoverTargetsResultDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Post('discover')
  @WorkspacePolicy(WorkspaceAction.SCAN_EXECUTE)
  discoverTargets(
    @Body() dto: DiscoverTargetsDto,
    @UserContext() userContext: UserContextPayload,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.targetsService.discoverTargets(dto, workspaceId, userContext);
  }

  @Doc({
    summary: 'Get all targets in a workspace',
    description:
      'Fetches a comprehensive list of all registered security testing targets within the specified workspace for vulnerability management and assessment tracking.',
    response: {
      serialization: GetManyResponseDto(GetManyTargetResponseDto),
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Get()
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  getTargetsInWorkspace(
    @Query() query: GetManyWorkspaceQueryParamsDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.targetsService.getTargetsInWorkspace(query, workspaceId);
  }

  @Doc({
    summary: 'Export targets to CSV',
    description:
      'Exports all targets in a workspace to a CSV file containing value, type (DOMAIN or CIDR), last discovered date, and creation date for reporting and analysis purposes.',
    response: {
      description: 'CSV file containing targets data',
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Get('export')
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  async exportTargetsToCSV(
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

    // Get targets data for CSV export
    const targets = await this.targetsService.exportTargetsForCSV(workspaceId);
    // Create CSV content
    const csvRows: string[] = [];
    // Add header row
    csvRows.push('value,type,lastDiscoveredAt,createdAt');

    // Add data rows
    for (const target of targets) {
      const lastDiscoveredAtFormatted = target.lastDiscoveredAt
        ? formatDate(target.lastDiscoveredAt)
        : '';
      const createdAtFormatted = target.createdAt
        ? formatDate(target.createdAt)
        : '';
      const row = `"${target.value.replace(/"/g, '""')}","${target.type}","${lastDiscoveredAtFormatted}","${createdAtFormatted}"`;
      csvRows.push(row);
    }

    // Set response headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="targets_${workspaceId}.csv"`,
    );
    res.setHeader('Content-Length', Buffer.byteLength(csvRows.join('\n')));

    // Send CSV content
    res.send(csvRows.join('\n'));
  }

  @Doc({
    summary: 'Get a target by ID',
    description:
      'Fetches detailed information about a specific security testing target using its unique identifier, including configuration and assessment status.',
    response: {
      serialization: Target,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Get(':id')
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  getTargetById(
    @Param() { id }: IdQueryParamDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.targetsService.getTargetById(id, workspaceId);
  }

  @Doc({
    summary: 'Delete a target from a workspace',
    description:
      'Removes a security testing target from the specified workspace, terminating all associated monitoring and assessment activities.',
    response: {
      serialization: DefaultMessageResponseDto,
    },
  })
  @Delete(':id/workspace/:workspaceId')
  @WorkspacePolicy(WorkspaceAction.TARGET_MANAGE, {
    workspaceParam: 'workspaceId',
  })
  deleteTargetFromWorkspace(
    @Param() { id }: IdQueryParamDto,
    @Param('workspaceId', new ParseUUIDPipe({ version: '4' }))
    workspaceId: string,
  ) {
    return this.targetsService.deleteTargetFromWorkspace(id, workspaceId);
  }

  @Doc({
    summary: 'Rescan a target',
    description:
      'Initiates a comprehensive security re-assessment of the specified target, triggering new vulnerability scans to identify potential security risks.',
    response: {
      serialization: DefaultMessageResponseDto,
    },
  })
  @Post(':id/re-scan')
  @WorkspacePolicy(WorkspaceAction.SCAN_EXECUTE)
  reScanTarget(
    @Param() { id }: IdQueryParamDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.targetsService.reScanTarget(id, workspaceId);
  }

  @Doc({
    summary: 'Update a target',
    description:
      'Modifies the configuration and properties of an existing security testing target, allowing for dynamic adjustments to assessment parameters.',
    response: {
      serialization: Target,
    },
  })
  @Patch(':id')
  @WorkspacePolicy(WorkspaceAction.TARGET_MANAGE)
  updateTarget(
    @Param() { id }: IdQueryParamDto,
    @Body() dto: UpdateTargetDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.targetsService.updateTarget(id, dto, workspaceId);
  }
}
