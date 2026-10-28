import { GrpcWorkerTokenGuard } from '@/common/guards/grpc-worker-token.guard';
import { WORKER_TOKEN_HEADER } from '@/common/constants/app.constants';
import type { WorkspacePolicyService } from '@/common/authorization/workspace-policy.service';
import type { GrpcWorkerContext } from '@/common/guards/grpc-worker-context.service';
import { Metadata } from '@grpc/grpc-js';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { AliveStreamManager } from './alive-stream-manager.service';
import type { ToolArtifactService } from './tool-artifact.service';
import { WorkersController } from './workers.controller';
import type { WorkersService } from './workers.service';
import type { ToolUpdateService } from '../tools/tool-update.service';

describe('WorkersController gRPC policy', () => {
  it.each([
    'grpcGetManifest',
    'grpcStorage',
    'grpcAlive',
    'grpcConnectInternalNetwork',
    'grpcBuiltinToolRegistry',
    'grpcReportScannerStatus',
    'grpcGetToolUpdatePlan',
    'grpcReportToolStatus',
  ] as const)('guards %s with the issued worker identity', (methodName) => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      WorkersController.prototype[methodName],
    ) as unknown[] | undefined;

    expect(guards).toContain(GrpcWorkerTokenGuard);
  });

  it('leaves only initial enrollment unguarded by the issued identity', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      WorkersController.prototype.grpcJoin,
    ) as unknown[] | undefined;

    expect(guards).toBeUndefined();
  });

  it('binds internal-network registration to the token-authenticated worker', async () => {
    const workersService = {
      connectInternalNetwork: jest.fn().mockResolvedValue({
        message: 'Connect success',
      }),
    } as unknown as WorkersService;
    const grpcWorkerContext = {
      getWorker: jest.fn().mockReturnValue({ id: 'authenticated-worker' }),
    } as unknown as GrpcWorkerContext;
    const controller = new WorkersController(
      workersService,
      {} as AliveStreamManager,
      {} as ToolArtifactService,
      grpcWorkerContext,
      {} as WorkspacePolicyService,
      {} as ToolUpdateService,
    );
    const metadata = new Metadata();
    metadata.set(WORKER_TOKEN_HEADER, 'issued-token');

    await controller.grpcConnectInternalNetwork(
      {
        workerId: 'spoofed-worker',
        networkId: 'network-1',
        networkInterfaces: [],
      },
      metadata,
    );

    expect(workersService.connectInternalNetwork).toHaveBeenCalledWith({
      workerId: 'authenticated-worker',
      networkId: 'network-1',
      networkInterfaces: [],
    });
  });

  it('binds scanner status reports to the token-authenticated worker', async () => {
    const workersService = {
      reportScannerStatus: jest
        .fn()
        .mockResolvedValue({ message: 'Status recorded' }),
    } as unknown as WorkersService;
    const grpcWorkerContext = {
      getWorker: jest.fn().mockReturnValue({ id: 'authenticated-worker' }),
    } as unknown as GrpcWorkerContext;
    const controller = new WorkersController(
      workersService,
      {} as AliveStreamManager,
      {} as ToolArtifactService,
      grpcWorkerContext,
      {} as WorkspacePolicyService,
      {} as ToolUpdateService,
    );
    const metadata = new Metadata();
    metadata.set(WORKER_TOKEN_HEADER, 'issued-token');

    await controller.grpcReportScannerStatus(
      {
        engineVersion: 'v3.11.0',
        templateVersion: 'v10.4.6',
        templateSource: 'projectdiscovery/nuclei-templates',
        state: 'ready',
      },
      metadata,
    );

    expect(workersService.reportScannerStatus).toHaveBeenCalledWith(
      'authenticated-worker',
      expect.objectContaining({ state: 'ready' }),
    );
  });

  it('binds update plans and tool status to the token-authenticated worker', async () => {
    const workersService = {
      reportToolStatus: jest
        .fn()
        .mockResolvedValue({ message: 'Tool status recorded' }),
    } as unknown as WorkersService;
    const toolUpdateService = {
      getWorkerUpdatePlan: jest.fn().mockResolvedValue([]),
    } as unknown as ToolUpdateService;
    const grpcWorkerContext = {
      getWorker: jest.fn().mockReturnValue({ id: 'authenticated-worker' }),
    } as unknown as GrpcWorkerContext;
    const controller = new WorkersController(
      workersService,
      {} as AliveStreamManager,
      {} as ToolArtifactService,
      grpcWorkerContext,
      {} as WorkspacePolicyService,
      toolUpdateService,
    );
    const metadata = new Metadata();
    metadata.set(WORKER_TOKEN_HEADER, 'issued-token');

    await controller.grpcGetToolUpdatePlan(
      { os: 'linux', arch: 'amd64' },
      metadata,
    );
    await controller.grpcReportToolStatus(
      {
        component: 'httpx',
        installedVersion: '1.9.0',
        state: 'updating',
        requestId: '1f0999d1-63c0-4f34-9d8e-fe94d625f909',
        targetVersion: '1.10.0',
      },
      metadata,
    );

    expect(toolUpdateService.getWorkerUpdatePlan).toHaveBeenCalledWith(
      'authenticated-worker',
      'linux',
      'amd64',
    );
    expect(workersService.reportToolStatus).toHaveBeenCalledWith(
      'authenticated-worker',
      expect.objectContaining({ component: 'httpx', state: 'updating' }),
    );
  });
});
