import { WorkerType } from '@/common/enums/enum';
import type { Repository } from 'typeorm';
import type { ApiKeysService } from '../apikeys/apikeys.service';
import type { Asset } from '../assets/entities/assets.entity';
import type { Vulnerability } from '../vulnerabilities/entities/vulnerability.entity';
import type { WorkersService } from '../workers/workers.service';
import type { ToolsQueryDto } from './dto/tools-query.dto';
import type { Tool } from './entities/tools.entity';
import type { WorkspaceTool } from './entities/workspace_tools.entity';
import { ToolsService } from './tools.service';

describe('ToolsService', () => {
  it('attaches worker-reported template versions only to the Nuclei tool', async () => {
    const tools = [
      { id: 'tool-nuclei', name: 'nuclei', type: WorkerType.BUILT_IN },
      { id: 'tool-httpx', name: 'httpx', type: WorkerType.BUILT_IN },
    ] as Tool[];
    const toolsRepository = {
      findAndCount: jest.fn().mockResolvedValue([tools, tools.length]),
    } as unknown as Repository<Tool>;
    const workspaceToolRepository = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<WorkspaceTool>;
    const workerQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(3),
    };
    const getNucleiTemplateVersions = jest.fn().mockResolvedValue(['v10.4.7']);
    const workersService = {
      repo: {
        createQueryBuilder: jest.fn().mockReturnValue(workerQueryBuilder),
      },
      getNucleiTemplateVersions,
    } as unknown as WorkersService;
    const service = new ToolsService(
      toolsRepository,
      workspaceToolRepository,
      {} as Repository<Asset>,
      {} as Repository<Vulnerability>,
      {} as ApiKeysService,
      workersService,
    );
    const query = {
      page: 1,
      limit: 10,
      workspaceId: 'workspace-1',
    } as ToolsQueryDto;

    const response = await service.getManyTools(query);

    expect(getNucleiTemplateVersions).toHaveBeenCalledWith('workspace-1');
    expect(response.data.find((tool) => tool.name === 'nuclei')).toMatchObject({
      templateVersions: ['v10.4.7'],
    });
    expect(
      response.data.find((tool) => tool.name === 'httpx'),
    ).not.toHaveProperty('templateVersions');
  });
});
