import type { WorkerInstance } from '@/modules/workers/entities/worker.entity';
import { WorkersService } from '@/modules/workers/workers.service';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { WORKER_TOKEN_HEADER } from '../constants/app.constants';

/**
 * Guard to validate the presence and validity of a worker token in the request headers
 * This guard checks for a 'worker-token' header and validates its content
 */
@Injectable()
export class WorkerTokenGuard implements CanActivate {
  constructor(
    @Inject(WorkersService) private readonly workersService: WorkersService,
  ) {}

  /**
   * Validates if the current request has a valid worker token
   * @param context - The execution context of the current request
   * @returns True if the worker token is valid, throws an error otherwise
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      workerInstance?: WorkerInstance;
    }>();

    // Get the worker token from headers
    const workerToken = request.headers[WORKER_TOKEN_HEADER];

    // Check if worker token exists
    if (!workerToken) {
      throw new UnauthorizedException('Worker token is missing');
    }

    // Validate the worker token against the database
    const workerInstance =
      await this.workersService.validateWorkerToken(workerToken);

    if (!workerInstance) {
      throw new UnauthorizedException('Invalid worker token');
    }

    // Attach the validated worker so handlers can use the token-bound ID
    // instead of trusting a client-supplied workerId in the path/body.
    request.workerInstance = workerInstance;

    return true;
  }
}
