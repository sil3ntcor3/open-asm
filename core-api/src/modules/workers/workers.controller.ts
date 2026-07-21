import { WorkspaceAction } from '@/common/authorization/workspace-action.enum';
import { WorkspacePolicy } from '@/common/authorization/workspace-policy.decorator';
import { WorkspacePolicyService } from '@/common/authorization/workspace-policy.service';
import { WORKER_TOKEN_HEADER } from '@/common/constants/app.constants';
import { UserContext, WorkspaceId } from '@/common/decorators/app.decorator';
import { Doc } from '@/common/doc/doc.decorator';
import { Role, WorkerScope } from '@/common/enums/enum';
import { GrpcWorkerContext } from '@/common/guards/grpc-worker-context.service';
import { GrpcWorkerTokenGuard } from '@/common/guards/grpc-worker-token.guard';
import { UserContextPayload } from '@/common/interfaces/app.interface';
import { GetManyResponseDto } from '@/utils/getManyResponse';
import { Metadata } from '@grpc/grpc-js';
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Patch,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { ApiTags } from '@nestjs/swagger';
import { createReadStream } from 'fs';
import { Observable } from 'rxjs';
import {
  GetManyWorkersDto,
  ScannerStatusReportDto,
  UpdateWorkerSettingsDto,
} from './dto/workers.dto';
import { WorkerInstance } from './entities/worker.entity';
import { AliveStreamManager } from './alive-stream-manager.service';
import { ToolArtifactService } from './tool-artifact.service';
import { WorkersService } from './workers.service';

interface GrpcCall {
  getPeer?(): string | undefined;
}

@ApiTags('Workers')
@Controller('workers')
export class WorkersController {
  private readonly logger = new Logger(WorkersController.name);
  constructor(
    private readonly workersService: WorkersService,
    private readonly aliveStreamManager: AliveStreamManager,
    private readonly toolArtifactService: ToolArtifactService,
    private readonly grpcWorkerContext: GrpcWorkerContext,
    private readonly workspacePolicyService: WorkspacePolicyService,
  ) {}

  /** Resolves the worker identity established by GrpcWorkerTokenGuard. */
  private authenticatedWorkerId(metadata: Metadata): string {
    const workerToken = metadata.get(WORKER_TOKEN_HEADER)?.[0];
    const worker =
      typeof workerToken === 'string'
        ? this.grpcWorkerContext.getWorker(workerToken)
        : undefined;
    if (!worker) {
      throw new RpcException('Worker not found in authenticated context');
    }
    return worker.id;
  }

  @Doc({
    summary: 'Get all workers with pagination and sorting.',
    description:
      'Fetches a paginated list of all active security assessment workers in the cluster.',
    response: {
      serialization: GetManyResponseDto(WorkerInstance),
    },
  })
  @Get()
  @WorkspacePolicy(WorkspaceAction.WORKER_READ)
  getWorkers(
    @Query() query: GetManyWorkersDto,
    @WorkspaceId() workspaceId: string,
  ) {
    return this.workersService.getWorkers({ ...query, workspaceId });
  }

  @Doc({
    summary: 'Update worker runtime settings',
    description:
      "Change a worker instance's desired max concurrency and/or pause state at runtime. The worker applies the change on its next control poll (a few seconds); shrinking concurrency never kills running jobs.",
    response: {
      serialization: WorkerInstance,
    },
  })
  @Patch('/:id/settings')
  async updateWorkerSettings(
    @Param('id') id: string,
    @Body() dto: UpdateWorkerSettingsDto,
    @UserContext() userContext: UserContextPayload,
    @WorkspaceId() workspaceId: string,
  ) {
    const scope = await this.workersService.getWorkerManagementScope(
      id,
      workspaceId,
    );

    if (scope === WorkerScope.CLOUD) {
      if (userContext.role !== Role.ADMIN) {
        throw new ForbiddenException(
          'Only platform administrators can manage global workers',
        );
      }
    } else {
      await this.workspacePolicyService.assertAllowed(
        { id: userContext.id, role: userContext.role },
        workspaceId,
        WorkspaceAction.WORKER_MANAGE,
      );
    }

    return this.workersService.updateWorkerSettings(id, dto, workspaceId);
  }

  @GrpcMethod('WorkersService', 'GetManifest')
  @UseGuards(GrpcWorkerTokenGuard)
  grpcGetManifest(): { initCommands: string[] } {
    return {
      initCommands: [],
    };
  }

  @GrpcMethod('WorkersService', 'Storage')
  @UseGuards(GrpcWorkerTokenGuard)
  grpcStorage(request: {
    path: string;
  }): Observable<{ chunk: Buffer; offset: number; eof: boolean }> {
    return new Observable((subscriber) => {
      void this.toolArtifactService
        .resolveArtifact(request.path)
        .then((filePath) => {
          const stream = createReadStream(filePath, {
            highWaterMark: 1024 * 1024,
          });
          let offset = 0;

          stream.on('data', (chunk: Buffer) => {
            subscriber.next({ chunk, offset, eof: false });
            offset += chunk.length;
          });

          stream.on('end', () => {
            subscriber.next({ chunk: Buffer.alloc(0), offset, eof: true });
            subscriber.complete();
          });

          stream.on('error', (error) => {
            subscriber.error(error);
          });
        })
        .catch((error: unknown) => {
          subscriber.error(error);
        });
    });
  }

  @GrpcMethod('WorkersService', 'Join')
  async grpcJoin(
    requests: {
      apiKey: string;
      token?: string;
      metadata?: { name?: string; os?: string };
    },
    call: GrpcCall,
  ): Promise<{ workerId: string; workerToken: string }> {
    const peer = call?.getPeer?.();
    const ipAddress = typeof peer === 'string' ? peer.split(':')[0] : undefined;

    const worker = await this.workersService.join({
      apiKey: requests.apiKey,
      token: requests.token,
      metadata: requests.metadata,
      ipAddress,
    });

    return {
      workerId: worker.id,
      workerToken: worker.token,
    };
  }

  @GrpcMethod('WorkersService', 'Alive')
  @UseGuards(GrpcWorkerTokenGuard)
  grpcAlive(request: {
    workerToken: string;
  }): Observable<{ alive: boolean; lastSeenAt: string; workerId: string }> {
    return new Observable((subscriber) => {
      let intervalId: NodeJS.Timeout;
      let registeredWorkerId: string | undefined;
      let streamId: string | undefined;

      const updateAlive = async () => {
        try {
          const worker = await this.workersService.alive({
            token: request.workerToken,
          });
          if (worker) {
            if (!registeredWorkerId) {
              streamId = this.aliveStreamManager.register(
                worker.id,
                request.workerToken,
              );
              registeredWorkerId = worker.id;
            } else {
              this.aliveStreamManager.updateAlive(registeredWorkerId);
            }
            subscriber.next({
              alive: true,
              lastSeenAt: worker.lastSeenAt.toISOString(),
              workerId: worker.id,
            });
          } else {
            subscriber.error(new Error('Worker not found after update.'));
          }
        } catch (err) {
          subscriber.error(err);
        }
      };

      void updateAlive().then(() => {
        intervalId = setInterval(() => {
          void updateAlive();
        }, 10000);
      });

      return () => {
        if (intervalId) clearInterval(intervalId);
        if (registeredWorkerId && streamId) {
          this.aliveStreamManager.unregister(registeredWorkerId, streamId);
          this.logger.log(
            `[grpcAlive] Worker ${registeredWorkerId} stream disconnected, releasing jobs`,
          );
          void this.workersService.releaseWorkerJobs(registeredWorkerId);
        }
      };
    });
  }

  @GrpcMethod('WorkersService', 'ConnectInternalNetwork')
  @UseGuards(GrpcWorkerTokenGuard)
  async grpcConnectInternalNetwork(
    request: {
      workerId: string;
      networkId: string;
      networkInterfaces: Array<{
        interfaceName: string;
        ipAddress: string;
        cidr: string;
        gatewayIp: string;
        gatewayMac: string;
      }>;
    },
    metadata: Metadata,
  ): Promise<{ message: string }> {
    return this.workersService.connectInternalNetwork({
      ...request,
      workerId: this.authenticatedWorkerId(metadata),
    });
  }

  @GrpcMethod('WorkersService', 'BuiltinToolRegistry')
  @UseGuards(GrpcWorkerTokenGuard)
  async grpcBuiltinToolRegistry(request: {
    os: string;
    arch: string;
  }): Promise<{ toolPaths: string[] }> {
    return {
      toolPaths: await this.toolArtifactService.listArtifacts(
        request.os,
        request.arch,
      ),
    };
  }

  @GrpcMethod('WorkersService', 'ReportScannerStatus')
  @UseGuards(GrpcWorkerTokenGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  grpcReportScannerStatus(
    request: ScannerStatusReportDto,
    metadata: Metadata,
  ): Promise<{ message: string }> {
    return this.workersService.reportScannerStatus(
      this.authenticatedWorkerId(metadata),
      request,
    );
  }
}
