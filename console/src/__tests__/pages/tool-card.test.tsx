import ToolCard from '@/pages/tools/components/tool-card';
import type { Tool, ToolUpdateComponentDto } from '@/services/apis/gen/queries';
import { renderWithProviders, screen } from '@/test/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestUpdate: vi.fn(),
}));

vi.mock('@/hooks/useNavigateWithParams', () => ({
  useNavigateWithParams: () => vi.fn(),
}));

vi.mock('@/services/apis/gen/queries', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    useToolsControllerRequestToolUpdate: () => ({
      mutate: mocks.requestUpdate,
      isPending: false,
    }),
    getToolsControllerGetManyToolsQueryKey: () => ['/api/tools', {}],
  };
});

function managedComponent(
  overrides: Partial<ToolUpdateComponentDto> = {},
): ToolUpdateComponentDto {
  return {
    component: 'nuclei',
    displayName: 'Nuclei engine',
    mode: 'managed',
    installedVersions: ['3.11.0'],
    latestVersion: '3.11.1',
    updateAvailable: true,
    ...overrides,
  };
}

function createTool(updateComponents: ToolUpdateComponentDto[]): Tool {
  return {
    id: 'tool-1',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    name: 'nuclei',
    description: 'Vulnerability scanner',
    command: 'nuclei',
    category: 'vulnerabilities',
    version: '3.11.0',
    logoUrl: '/static/images/nuclei.png',
    isBuiltIn: true,
    isInstalled: true,
    isOfficialSupport: true,
    type: 'built_in',
    providerId: '',
    availableWorkersCount: 3,
    updateComponents,
  };
}

/** Creates a fully successful three-worker rollout for completion-state tests. */
function successfulComponent(requestId: string): ToolUpdateComponentDto {
  return managedComponent({
    installedVersions: ['3.11.1'],
    updateAvailable: false,
    rollout: {
      requestId,
      requestedVersion: '3.11.1',
      totalWorkers: 3,
      pending: 0,
      updating: 0,
      succeeded: 3,
      failed: 0,
      workers: [1, 2, 3].map((workerNumber) => ({
        workerId: `worker-${workerNumber}`,
        workerName: `External worker ${workerNumber}`,
        state: 'succeeded',
        installedVersion: '3.11.1',
        targetVersion: '3.11.1',
      })),
    },
  });
}

describe('ToolCard update management', () => {
  beforeEach(() => {
    mocks.requestUpdate.mockReset();
    localStorage.clear();
  });

  it('shows installed and latest versions when an update is available', async () => {
    renderWithProviders(
      <ToolCard tool={createTool([managedComponent()])} canUpdateTools />,
    );

    expect(await screen.findByText('Installed 3.11.0')).toBeInTheDocument();
    expect(screen.getByText('Latest 3.11.1')).toBeInTheDocument();
    expect(screen.getByText('Update available')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Update Nuclei engine' }),
    ).toBeInTheDocument();
  });

  it('labels worker-image components without offering an app update', async () => {
    renderWithProviders(
      <ToolCard
        tool={createTool([
          managedComponent({
            component: 'nmap',
            displayName: 'Nmap engine',
            mode: 'worker_image',
            installedVersions: ['7.93'],
            latestVersion: undefined,
            updateAvailable: false,
          }),
        ])}
        canUpdateTools
      />,
    );

    expect(
      await screen.findByText('Managed by worker image'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Update Nmap/ }),
    ).not.toBeInTheDocument();
  });

  it('requires confirmation before starting one component rollout', async () => {
    const { user } = renderWithProviders(
      <ToolCard tool={createTool([managedComponent()])} canUpdateTools />,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Update Nuclei engine' }),
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'all currently connected eligible workers',
    );
    expect(mocks.requestUpdate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Start update' }));
    expect(mocks.requestUpdate).toHaveBeenCalledWith({
      id: 'tool-1',
      component: 'nuclei',
    });
  });

  it('shows per-worker failures for an active rollout', async () => {
    const { user } = renderWithProviders(
      <ToolCard
        tool={createTool([
          managedComponent({
            rollout: {
              requestId: 'request-1',
              requestedVersion: '3.11.1',
              totalWorkers: 3,
              pending: 0,
              updating: 0,
              succeeded: 2,
              failed: 1,
              workers: [
                {
                  workerId: 'worker-1',
                  workerName: 'External worker 1',
                  state: 'failed',
                  installedVersion: '3.11.0',
                  targetVersion: '3.11.1',
                  error: 'post-activation smoke test failed',
                },
              ],
            },
          }),
        ])}
        canUpdateTools
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: 'View Nuclei engine rollout' }),
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('External worker 1');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'post-activation smoke test failed',
    );
  });

  it('collapses a successful rollout without leaving a progress bar', async () => {
    const { user } = renderWithProviders(
      <ToolCard
        tool={createTool([successfulComponent('request-1')])}
        canUpdateTools
      />,
    );

    expect(await screen.findByText('Update complete')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'View Nuclei engine rollout' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('progressbar', {
        name: 'Nuclei engine rollout progress',
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/3 succeeded/)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'View Nuclei engine rollout' }),
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('External worker 1');
  });

  it('dismisses only the current completed rollout across remounts', async () => {
    const firstRender = renderWithProviders(
      <ToolCard
        tool={createTool([successfulComponent('request-1')])}
        canUpdateTools
      />,
    );

    await firstRender.user.click(
      await screen.findByRole('button', {
        name: 'Dismiss Nuclei engine completed rollout',
      }),
    );
    expect(screen.queryByText('Update complete')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'View Nuclei engine rollout' }),
    ).not.toBeInTheDocument();

    firstRender.unmount();
    const secondRender = renderWithProviders(
      <ToolCard
        tool={createTool([successfulComponent('request-1')])}
        canUpdateTools
      />,
    );
    expect(screen.queryByText('Update complete')).not.toBeInTheDocument();

    secondRender.unmount();
    renderWithProviders(
      <ToolCard
        tool={createTool([successfulComponent('request-2')])}
        canUpdateTools
      />,
    );
    expect(await screen.findByText('Update complete')).toBeInTheDocument();
  });
});
