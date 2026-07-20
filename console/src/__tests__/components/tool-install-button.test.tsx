import ToolInstallButton from '@/pages/tools/components/tool-install-button';
import type { Tool } from '@/services/apis/gen/queries';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const permission = vi.hoisted(() => ({ canManageTools: false }));

vi.mock('@/hooks/useWorkspacePermissions', () => ({
  useWorkspacePermissions: () => ({
    can: (action: string) =>
      action === 'tool.manage' && permission.canManageTools,
  }),
}));

vi.mock('@/components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({ trigger }: { trigger: ReactNode }) => trigger,
}));

vi.mock('@/services/apis/gen/queries', async () => {
  const actual = await vi.importActual('@/services/apis/gen/queries');
  return {
    ...actual,
    useToolsControllerInstallTool: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
    useToolsControllerUninstallTool: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
  };
});

const tool = {
  id: 'f4346894-cf96-4a92-bf96-b99124465544',
  name: 'nessus',
  type: 'provider',
  isInstalled: false,
} as Tool;

describe('ToolInstallButton', () => {
  beforeEach(() => {
    permission.canManageTools = false;
  });

  it('renders a read-only state without tool management permission', () => {
    render(<ToolInstallButton tool={tool} workspaceId="workspace-id" />);

    expect(screen.getByRole('button', { name: 'Read only' })).toBeDisabled();
  });

  it('renders the install action with tool management permission', () => {
    permission.canManageTools = true;

    render(<ToolInstallButton tool={tool} workspaceId="workspace-id" />);

    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled();
  });
});
