import { WorkersService } from '@/modules/workers/workers.service';
import { Metadata } from '@grpc/grpc-js';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { WORKER_TOKEN_HEADER } from '../constants/app.constants';
import { GrpcWorkerContext } from './grpc-worker-context.service';

@Injectable()
export class GrpcWorkerTokenGuard implements CanActivate {
  constructor(
    @Inject(WorkersService) private readonly workersService: WorkersService,
    private readonly grpcWorkerContext: GrpcWorkerContext,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx: unknown = context.switchToRpc().getContext();
    const metadata: Metadata | undefined =
      (ctx as { metadata?: Metadata }).metadata ??
      (ctx as Metadata | undefined);

    const tokenValues = metadata?.get?.(WORKER_TOKEN_HEADER);
    const metadataToken = tokenValues?.[0];
    const requestToken = (
      context.switchToRpc().getData<{ workerToken?: string }>()
    )?.workerToken;
    const workerToken =
      typeof metadataToken === 'string' ? metadataToken : requestToken;

    if (!workerToken) {
      throw new RpcException('Worker token is missing');
    }

    const workerInstance =
      await this.workersService.validateWorkerToken(workerToken);

    if (!workerInstance) {
      throw new RpcException('Invalid worker token');
    }

    this.grpcWorkerContext.setWorker(workerToken, workerInstance);

    return true;
  }
}
