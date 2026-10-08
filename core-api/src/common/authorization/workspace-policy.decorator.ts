import { SetMetadata } from '@nestjs/common';
import type { WorkspaceAction } from './workspace-action.enum';

export const WORKSPACE_POLICY_METADATA = 'WORKSPACE_POLICY_METADATA';

export type WorkspacePolicyOptions = {
  workspaceParam?: string;
  workspaceBody?: string;
  workspaceQuery?: string;
};

export type WorkspacePolicyMetadata = WorkspacePolicyOptions & {
  action: WorkspaceAction;
};

/** Declares the workspace action that a route must authorize. */
export const WorkspacePolicy = (
  action: WorkspaceAction,
  options: WorkspacePolicyOptions = {},
) =>
  SetMetadata(WORKSPACE_POLICY_METADATA, {
    action,
    ...options,
  } satisfies WorkspacePolicyMetadata);
