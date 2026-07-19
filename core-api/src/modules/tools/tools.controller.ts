import { WorkspaceId } from '@/common/decorators/app.decorator';
import { WorkspaceAction } from '@/common/authorization/workspace-action.enum';
import { WorkspacePolicy } from '@/common/authorization/workspace-policy.decorator';
import { Doc } from '@/common/doc/doc.decorator';
import { GetManyResponseDto } from '@/utils/getManyResponse';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { DefaultMessageResponseDto } from '@/common/dtos/default-message-response.dto';
import { IdQueryParamDto } from '@/common/dtos/id-query-param.dto';
import { CreateToolDto } from './dto/create-tool.dto';
import { GetApiKeyResponseDto } from './dto/get-apikey-response.dto';
import { GetInstalledToolsDto } from './dto/get-installed-tools.dto';
import { GetToolByIdDto } from './dto/get-tool-by-id.dto';
import { InstallToolDto } from './dto/install-tool.dto';
import { ToolsQueryDto } from './dto/tools-query.dto';
import { AddToolToWorkspaceDto } from './dto/tools.dto';
import { Tool } from './entities/tools.entity';
import { WorkspaceTool } from './entities/workspace_tools.entity';
import { ToolsService } from './tools.service';

@ApiTags('Tools')
@Controller('tools')
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Doc({
    summary: 'Create a new tool',
    description:
      'Registers a new security assessment tool in the system with specified configuration and capabilities.',
    response: {
      serialization: Tool,
    },
  })
  @Post()
  @WorkspacePolicy(WorkspaceAction.TOOL_MANAGE)
  createTool(@Body() dto: CreateToolDto) {
    return this.toolsService.createTool(dto);
  }

  // @Doc({
  //   summary: 'Run a tool',
  //   description: 'Executes a security assessment tool with specified parameters in the designated workspace.',
  //   response: {
  //     serialization: DefaultMessageResponseDto,
  //   },
  //   request: {
  //     getWorkspaceId: true,
  //   },
  // })
  // @Post(':id/run')
  // runTool(
  //   @Param() { id }: IdQueryParamDto,
  //   @Body() dto: RunToolDto,
  //   @WorkspaceId() workspaceId: string,
  // ) {
  //   return this.toolsService.runTool(id, dto, workspaceId);
  // }

  @Doc({
    summary: 'Add tool to workspace',
    description:
      'Associates an existing security tool with a specific workspace for targeted assessments.',
    response: {
      serialization: WorkspaceTool,
    },
  })
  @Post('add-to-workspace')
  @WorkspacePolicy(WorkspaceAction.TOOL_MANAGE, {
    workspaceBody: 'workspaceId',
  })
  async addToolToWorkspace(@Body() dto: AddToolToWorkspaceDto) {
    return this.toolsService.addToolToWorkspace(dto);
  }

  @Doc({
    summary: 'Install tool',
    description:
      'Installs a security tool to a specific workspace with duplicate checking to prevent conflicts.',
    response: {
      serialization: WorkspaceTool,
    },
  })
  @Post('install')
  @WorkspacePolicy(WorkspaceAction.TOOL_MANAGE, {
    workspaceBody: 'workspaceId',
  })
  async installTool(@Body() dto: InstallToolDto) {
    return this.toolsService.installTool(dto);
  }

  @Doc({
    summary: 'Uninstall tool',
    description:
      'Removes a security tool from a specific workspace by deleting its association record.',
    response: {
      serialization: DefaultMessageResponseDto,
    },
  })
  @Post('uninstall')
  @WorkspacePolicy(WorkspaceAction.TOOL_MANAGE, {
    workspaceBody: 'workspaceId',
  })
  async uninstallTool(@Body() dto: InstallToolDto) {
    return this.toolsService.uninstallTool(dto);
  }

  @Doc({
    summary: 'Get built-in tools',
    response: {
      serialization: GetManyResponseDto(Tool),
    },
  })
  @ApiOperation({
    deprecated: true,
  })
  @Get('built-in-tools')
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  async getBuiltInTools() {
    return this.toolsService.getBuiltInTools();
  }

  @Doc({
    summary: 'Get tools',
    description:
      'Fetches a paginated list of available security assessment tools in the system.',
    response: {
      serialization: GetManyResponseDto(Tool),
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Get()
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  async getManyTools(
    @Query() query: ToolsQueryDto,
    @WorkspaceId() workspaceId?: string,
  ) {
    if (!workspaceId) {
      throw new BadRequestException('Workspace ID is required');
    }
    // Override the workspaceId from DTO with the one from header
    query.workspaceId = workspaceId;
    return this.toolsService.getManyTools(query);
  }

  @Doc({
    summary: 'Get installed tools for a workspace',
    description:
      'Fetches all security tools installed in a specific workspace, including built-in tools.',
    response: {
      serialization: GetManyResponseDto(Tool),
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Get('installed')
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  async getInstalledTools(
    @Query() dto: GetInstalledToolsDto,
    @WorkspaceId() workspaceId?: string,
  ) {
    return this.toolsService.getInstalledTools(dto, workspaceId);
  }

  @Doc({
    summary: 'Get tool by ID',
    description:
      'Fetches detailed information about a specific security tool using its unique identifier.',
    response: {
      serialization: Tool,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Get(':id')
  @WorkspacePolicy(WorkspaceAction.WORKSPACE_READ)
  getToolById(
    @Param() { id }: GetToolByIdDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.toolsService.getToolById(id, workspaceId);
  }

  @Doc({
    summary: 'Get tool API key',
    description:
      'Retrieves the authentication API key for accessing the specified security tool.',
    response: {
      serialization: GetApiKeyResponseDto,
    },
    request: {
      getWorkspaceId: true,
    },
  })
  @Get(':id/api-key')
  @WorkspacePolicy(WorkspaceAction.SECRET_MANAGE)
  getToolApiKey(
    @Param() { id }: IdQueryParamDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.toolsService.getToolApiKey(id, workspaceId);
  }

  @Doc({
    summary: 'Rotate tool API key',
    description:
      'Regenerates a new API key for the specified security tool, invalidating the previous key.',
    response: {
      serialization: GetApiKeyResponseDto,
    },
  })
  @Post(':id/api-key/rotate')
  @WorkspacePolicy(WorkspaceAction.SECRET_MANAGE)
  rotateToolApiKey(
    @Param() { id }: IdQueryParamDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.toolsService.rotateToolApiKey(id, workspaceId);
  }
}
