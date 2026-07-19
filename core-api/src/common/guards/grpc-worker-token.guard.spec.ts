import type { ExecutionContext } from '@nestjs/common';
import { Metadata } from '@grpc/grpc-js';
import type { GrpcWorkerContext } from './grpc-worker-context.service';
import { GrpcWorkerTokenGuard } from './grpc-worker-token.guard';

describe('GrpcWorkerTokenGuard', () => {
  it('accepts Alive request identity when the SDK sends it in the request body', async () => {
    const worker = { id: 'worker-1' };
    const workersService = {
      validateWorkerToken: jest.fn().mockResolvedValue(worker),
    };
    const workerContext = {
      setWorker: jest.fn(),
    } as unknown as GrpcWorkerContext;
    const guard = new GrpcWorkerTokenGuard(
      workersService as never,
      workerContext,
    );
    const rpcContext = {
      getContext: () => new Metadata(),
      getData: () => ({ workerToken: 'issued-worker-token' }),
    };
    const context = {
      switchToRpc: () => rpcContext,
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(workersService.validateWorkerToken).toHaveBeenCalledWith(
      'issued-worker-token',
    );
    expect(workerContext.setWorker).toHaveBeenCalledWith(
      'issued-worker-token',
      worker,
    );
  });
});
