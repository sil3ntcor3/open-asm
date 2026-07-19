import { GrpcWorkerTokenGuard } from '@/common/guards/grpc-worker-token.guard';
import { WORKER_TOKEN_HEADER } from '@/common/constants/app.constants';
import type { GrpcWorkerContext } from '@/common/guards/grpc-worker-context.service';
import { Metadata } from '@grpc/grpc-js';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { AliveStreamManager } from './alive-stream-manager.service';
import type { ToolArtifactService } from './tool-artifact.service';
import { WorkersController } from './workers.controller';
import type { WorkersService } from './workers.service';

describe('WorkersController gRPC policy', () => {
  it.each([
    'grpcGetManifest',
    'grpcStorage',
    'grpcAlive',
    'grpcConnectInternalNetwork',
    'grpcBuiltinToolRegistry',
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
});
