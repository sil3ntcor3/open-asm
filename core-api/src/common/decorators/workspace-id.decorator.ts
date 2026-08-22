import type { ExecutionContext } from '@nestjs/common';
import { BadRequestException, createParamDecorator } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import {
  WORKSPACE_COOKIE_NAME,
  WORKSPACE_HEADER_LOOKUP_NAME,
} from '../constants/app.constants';

function parseWorkspaceId(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === 'string' && isUUID(raw)) {
    return raw;
  }
  throw new BadRequestException('Workspace id null or invalid');
}

export const WorkspaceId = createParamDecorator<string | undefined>(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();

    const workspaceId = getWorkspaceIdFromRequest(request);
    if (workspaceId !== undefined) {
      return parseWorkspaceId(workspaceId);
    }

    throw new BadRequestException('Workspace id null or invalid');
  },
);

/**
 * Resolves the caller's selected workspace: the header first, the `wid` cookie
 * as the browser fallback.
 *
 * Reads the header by {@link WORKSPACE_HEADER_LOOKUP_NAME} — see that constant
 * for why the canonical name cannot be used here.
 */
export function getWorkspaceIdFromRequest(req: Request): string | undefined {
  return (
    (req.headers[WORKSPACE_HEADER_LOOKUP_NAME] as string) ||
    (req.cookies?.[WORKSPACE_COOKIE_NAME] as string | undefined)
  );
}
