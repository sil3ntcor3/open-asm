import { TargetsController } from '@/modules/targets/targets.controller';
import { JobsRegistryController } from '@/modules/jobs-registry/jobs-registry.controller';
import { TemplatesController } from '@/modules/templates/templates.controller';
import { ToolsController } from '@/modules/tools/tools.controller';
import { WorkersController } from '@/modules/workers/workers.controller';
import { WorkspacesController } from '@/modules/workspaces/workspaces.controller';
import { VulnerabilitiesController } from '@/modules/vulnerabilities/vulnerabilities.controller';
import { AssetsController } from '@/modules/assets/assets.controller';
import { AssetGroupController } from '@/modules/asset-group/asset-group.controller';
import { InternalNetworksController } from '@/modules/internal-networks/internal-networks.controller';
import { WorkflowsController } from '@/modules/workflows/workflows.controller';
import { ReportsController } from '@/modules/reports/reports.controller';
import { AgentsController } from '@/modules/agents/agents.controller';
import { IssuesController } from '@/modules/issues/issues.controller';
import { SearchController } from '@/modules/search/search.controller';
import { StatisticController } from '@/modules/statistic/statistic.controller';
import { WorkspaceAction } from './workspace-action.enum';
import type {
  WorkspacePolicyMetadata } from './workspace-policy.decorator';
import {
  WORKSPACE_POLICY_METADATA
} from './workspace-policy.decorator';

jest.mock('@/modules/reports/reports.service', () => ({
  ReportsService: class ReportsService {},
}));
jest.mock('@/modules/agents/agents.service', () => ({
  AgentsService: class AgentsService {},
}));
jest.mock('@/modules/agents/agents.completions', () => ({
  AgentsCompletionsService: class AgentsCompletionsService {},
}));
jest.mock('@/modules/agents/agents.skills', () => ({
  AgentsSkillsService: class AgentsSkillsService {},
}));
jest.mock('@/common/guards/auth.guard', () => ({
  AuthGuard: class AuthGuard {},
}));

describe('workspace policy route inventory', () => {
  it.each<[
    object,
    string,
    WorkspaceAction,
  ]>([
    [TargetsController.prototype, 'createMultipleTargets', WorkspaceAction.TARGET_CREATE],
    [TargetsController.prototype, 'discoverTargets', WorkspaceAction.SCAN_EXECUTE],
    [TargetsController.prototype, 'deleteTargetFromWorkspace', WorkspaceAction.TARGET_MANAGE],
    [TargetsController.prototype, 'reScanTarget', WorkspaceAction.SCAN_EXECUTE],
    [TargetsController.prototype, 'updateTarget', WorkspaceAction.TARGET_MANAGE],
    [WorkersController.prototype, 'getWorkers', WorkspaceAction.WORKER_MANAGE],
    [WorkersController.prototype, 'updateWorkerSettings', WorkspaceAction.WORKER_MANAGE],
    [ToolsController.prototype, 'createTool', WorkspaceAction.TOOL_MANAGE],
    [ToolsController.prototype, 'installTool', WorkspaceAction.TOOL_MANAGE],
    [ToolsController.prototype, 'uninstallTool', WorkspaceAction.TOOL_MANAGE],
    [ToolsController.prototype, 'getToolApiKey', WorkspaceAction.SECRET_MANAGE],
    [ToolsController.prototype, 'rotateToolApiKey', WorkspaceAction.SECRET_MANAGE],
    [TemplatesController.prototype, 'createTemplate', WorkspaceAction.TEMPLATE_MANAGE],
    [TemplatesController.prototype, 'uploadFile', WorkspaceAction.TEMPLATE_MANAGE],
    [TemplatesController.prototype, 'renameFile', WorkspaceAction.TEMPLATE_MANAGE],
    [TemplatesController.prototype, 'deleteTemplate', WorkspaceAction.TEMPLATE_MANAGE],
    [WorkspacesController.prototype, 'updateWorkspaceConfigs', WorkspaceAction.WORKSPACE_MANAGE],
    [WorkspacesController.prototype, 'deleteWorkspace', WorkspaceAction.WORKSPACE_MANAGE],
    [WorkspacesController.prototype, 'getWorkspaceApiKey', WorkspaceAction.SECRET_MANAGE],
    [WorkspacesController.prototype, 'rotateApiKey', WorkspaceAction.SECRET_MANAGE],
    [VulnerabilitiesController.prototype, 'scan', WorkspaceAction.SCAN_EXECUTE],
    [VulnerabilitiesController.prototype, 'getVulnerabilities', WorkspaceAction.WORKSPACE_READ],
    [VulnerabilitiesController.prototype, 'getVulnerabilitiesStatistics', WorkspaceAction.WORKSPACE_READ],
    [VulnerabilitiesController.prototype, 'getVulnerabilityById', WorkspaceAction.WORKSPACE_READ],
    [VulnerabilitiesController.prototype, 'analyzeVulnerability', WorkspaceAction.FINDING_TRIAGE],
    [VulnerabilitiesController.prototype, 'deleteVulnerabilityAnalysis', WorkspaceAction.FINDING_TRIAGE],
    [VulnerabilitiesController.prototype, 'bulkDismissVulnerabilities', WorkspaceAction.FINDING_TRIAGE],
    [VulnerabilitiesController.prototype, 'bulkReopenVulnerabilities', WorkspaceAction.FINDING_TRIAGE],
    [JobsRegistryController.prototype, 'getManyJobs', WorkspaceAction.WORKSPACE_READ],
    [JobsRegistryController.prototype, 'getJobsTimeline', WorkspaceAction.WORKSPACE_READ],
    [JobsRegistryController.prototype, 'getManyJobHistories', WorkspaceAction.WORKSPACE_READ],
    [JobsRegistryController.prototype, 'getJobHistoryDetail', WorkspaceAction.WORKSPACE_READ],
    [JobsRegistryController.prototype, 'pauseJobHistoryJobs', WorkspaceAction.SCAN_EXECUTE],
    [JobsRegistryController.prototype, 'resumeJobHistoryJobs', WorkspaceAction.SCAN_EXECUTE],
    [JobsRegistryController.prototype, 'cancelJobHistoryJobs', WorkspaceAction.SCAN_EXECUTE],
    [JobsRegistryController.prototype, 'deleteJobHistoryJobs', WorkspaceAction.SCAN_EXECUTE],
    [JobsRegistryController.prototype, 'reRunJob', WorkspaceAction.SCAN_EXECUTE],
    [JobsRegistryController.prototype, 'cancelJob', WorkspaceAction.SCAN_EXECUTE],
    [JobsRegistryController.prototype, 'pauseJob', WorkspaceAction.SCAN_EXECUTE],
    [JobsRegistryController.prototype, 'resumeJob', WorkspaceAction.SCAN_EXECUTE],
    [JobsRegistryController.prototype, 'deleteJob', WorkspaceAction.SCAN_EXECUTE],
    [AssetsController.prototype, 'getAssetsInWorkspace', WorkspaceAction.WORKSPACE_READ],
    [AssetsController.prototype, 'updateAssetById', WorkspaceAction.TARGET_MANAGE],
    [AssetsController.prototype, 'switchAsset', WorkspaceAction.TARGET_MANAGE],
    [AssetsController.prototype, 'exportServicesToCSV', WorkspaceAction.WORKSPACE_READ],
    [InternalNetworksController.prototype, 'getManyInternalNetworks', WorkspaceAction.WORKSPACE_READ],
    [InternalNetworksController.prototype, 'createInternalNetwork', WorkspaceAction.WORKER_MANAGE],
    [InternalNetworksController.prototype, 'createTargetsFromInterfaces', WorkspaceAction.TARGET_CREATE],
    [InternalNetworksController.prototype, 'updateInternalNetworkById', WorkspaceAction.WORKER_MANAGE],
    [InternalNetworksController.prototype, 'deleteInternalNetwork', WorkspaceAction.WORKER_MANAGE],
    [WorkflowsController.prototype, 'listTemplates', WorkspaceAction.WORKSPACE_READ],
    [WorkflowsController.prototype, 'getManyWorkflows', WorkspaceAction.WORKSPACE_READ],
    [WorkflowsController.prototype, 'createWorkflow', WorkspaceAction.TEMPLATE_MANAGE],
    [WorkflowsController.prototype, 'getWorkspaceWorkflow', WorkspaceAction.WORKSPACE_READ],
    [WorkflowsController.prototype, 'updateWorkflow', WorkspaceAction.TEMPLATE_MANAGE],
    [WorkflowsController.prototype, 'deleteWorkflow', WorkspaceAction.TEMPLATE_MANAGE],
    [AssetGroupController.prototype, 'getAll', WorkspaceAction.WORKSPACE_READ],
    [AssetGroupController.prototype, 'getById', WorkspaceAction.WORKSPACE_READ],
    [AssetGroupController.prototype, 'updateAssetGroupById', WorkspaceAction.SCAN_EXECUTE],
    [AssetGroupController.prototype, 'create', WorkspaceAction.SCAN_EXECUTE],
    [AssetGroupController.prototype, 'addManyWorkflows', WorkspaceAction.SCAN_EXECUTE],
    [AssetGroupController.prototype, 'addManyAssets', WorkspaceAction.SCAN_EXECUTE],
    [AssetGroupController.prototype, 'removeManyWorkflows', WorkspaceAction.SCAN_EXECUTE],
    [AssetGroupController.prototype, 'removeManyAssets', WorkspaceAction.SCAN_EXECUTE],
    [AssetGroupController.prototype, 'delete', WorkspaceAction.SCAN_EXECUTE],
    [AssetGroupController.prototype, 'getAssetsByAssetGroupsId', WorkspaceAction.WORKSPACE_READ],
    [AssetGroupController.prototype, 'getWorkflowsByAssetGroupsId', WorkspaceAction.WORKSPACE_READ],
    [AssetGroupController.prototype, 'getAssetsNotInAssetGroup', WorkspaceAction.WORKSPACE_READ],
    [AssetGroupController.prototype, 'getWorkflowsNotInAssetGroup', WorkspaceAction.WORKSPACE_READ],
    [AssetGroupController.prototype, 'updateAssetGroupWorkflow', WorkspaceAction.SCAN_EXECUTE],
    [AssetGroupController.prototype, 'runGroupWorkflowScheduler', WorkspaceAction.SCAN_EXECUTE],
    [ReportsController.prototype, 'getMany', WorkspaceAction.WORKSPACE_READ],
    [ReportsController.prototype, 'previewSummaryReport', WorkspaceAction.WORKSPACE_READ],
    [ReportsController.prototype, 'previewVulReport', WorkspaceAction.WORKSPACE_READ],
    [ReportsController.prototype, 'generateSummaryReport', WorkspaceAction.REPORT_MANAGE],
    [ReportsController.prototype, 'generateVulReport', WorkspaceAction.REPORT_MANAGE],
    [ReportsController.prototype, 'deleteReport', WorkspaceAction.REPORT_MANAGE],
    [AgentsController.prototype, 'getAgentModes', WorkspaceAction.WORKSPACE_READ],
    [AgentsController.prototype, 'createLLMConfig', WorkspaceAction.AGENT_MANAGE],
    [AgentsController.prototype, 'updateLLMConfig', WorkspaceAction.AGENT_MANAGE],
    [AgentsController.prototype, 'deleteLLMConfig', WorkspaceAction.AGENT_MANAGE],
    [AgentsController.prototype, 'streamMessage', WorkspaceAction.AGENT_USE],
    [AgentsController.prototype, 'deleteConversation', WorkspaceAction.AGENT_USE],
    [AgentsController.prototype, 'upsertMCPServer', WorkspaceAction.AGENT_MANAGE],
    [AgentsController.prototype, 'deleteMCPServer', WorkspaceAction.AGENT_MANAGE],
    [AgentsController.prototype, 'createSkill', WorkspaceAction.AGENT_MANAGE],
    [AgentsController.prototype, 'deleteSkill', WorkspaceAction.AGENT_MANAGE],
    [IssuesController.prototype, 'getMany', WorkspaceAction.WORKSPACE_READ],
    [IssuesController.prototype, 'create', WorkspaceAction.FINDING_TRIAGE],
    [IssuesController.prototype, 'update', WorkspaceAction.FINDING_TRIAGE],
    [IssuesController.prototype, 'changeStatus', WorkspaceAction.FINDING_TRIAGE],
    [IssuesController.prototype, 'createComment', WorkspaceAction.FINDING_TRIAGE],
    [IssuesController.prototype, 'updateCommentById', WorkspaceAction.FINDING_TRIAGE],
    [IssuesController.prototype, 'deleteCommentById', WorkspaceAction.FINDING_TRIAGE],
    [SearchController.prototype, 'searchAssetsTargets', WorkspaceAction.WORKSPACE_READ],
    [StatisticController.prototype, 'getStatistics', WorkspaceAction.WORKSPACE_READ],
    [StatisticController.prototype, 'getTimelineStatistics', WorkspaceAction.WORKSPACE_READ],
  ])('%s.%s requires %s', (prototype, methodName, expectedAction) => {
    const handler = (prototype as Record<string, unknown>)[methodName];
    const methodPolicy = Reflect.getMetadata(
      WORKSPACE_POLICY_METADATA,
      handler as object,
    ) as WorkspacePolicyMetadata | undefined;
    const classPolicy = Reflect.getMetadata(
      WORKSPACE_POLICY_METADATA,
      (prototype as { constructor: object }).constructor,
    ) as WorkspacePolicyMetadata | undefined;
    const policy = methodPolicy ?? classPolicy;

    expect(policy?.action).toBe(expectedAction);
  });
});
