import { renderWithProviders, screen } from '@/test/utils';
import Runs from '@/pages/jobs-registry/runs';
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMutate = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'history-1' }),
  };
});

vi.mock('@/services/apis/gen/queries', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/services/apis/gen/queries')
  >();
  const activeJob = {
    id: 'job-1',
    status: actual.JobStatus.in_progress,
    assetServiceId: 'service-1',
    assetService: { value: 'https://example.com' },
    asset: { value: 'example.com' },
    tool: {
      id: 'tool-1',
      name: 'nuclei',
      logoUrl: '',
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    pickJobAt: '2026-01-01T00:00:00Z',
    completedAt: null,
    errorLogs: [],
  };

  return {
    ...actual,
    useJobsRegistryControllerGetJobHistoryDetail: () => ({
      data: {
        id: 'history-1',
        jobHistoryName: 'Example run',
        workflowName: 'Example workflow',
        tools: [activeJob.tool],
      },
    }),
    useJobsRegistryControllerGetManyJobs: () => ({
      data: {
        data: [activeJob],
        page: 1,
        limit: 10,
        total: 1,
      },
      isLoading: false,
      error: null,
      queryKey: ['JobsRegistryControllerGetManyJobs'],
    }),
    useJobsRegistryControllerDeleteJob: () => ({ mutate: mockMutate }),
    useJobsRegistryControllerCancelJob: () => ({ mutate: mockMutate }),
    useJobsRegistryControllerPauseJob: () => ({ mutate: mockMutate }),
    useJobsRegistryControllerResumeJob: () => ({ mutate: mockMutate }),
  };
});

describe('Job runs', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockNavigate.mockClear();
  });

  it('keeps row action menu open when the jobs table rerenders', async () => {
    const user = userEvent.setup();
    let rerenderJobsTable = () => {};

    function Harness() {
      const [, setRenderCount] = useState(0);
      rerenderJobsTable = () => setRenderCount((count) => count + 1);
      return <Runs />;
    }

    renderWithProviders(<Harness />);

    await user.click(
      await screen.findByRole('button', { name: /open menu/i }),
    );

    act(() => {
      rerenderJobsTable();
    });

    expect(screen.getByRole('menuitem', { name: /pause/i })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /cancel/i })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeVisible();
  });

  it('closes the row action menu after choosing delete', async () => {
    const user = userEvent.setup();

    renderWithProviders(<Runs />);

    await user.click(
      await screen.findByRole('button', { name: /open menu/i }),
    );
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));

    expect(
      screen.queryByRole('menuitem', { name: /delete/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /delete job/i })).toBeVisible();
  });

  it('closes the row action menu after choosing pause', async () => {
    const user = userEvent.setup();

    renderWithProviders(<Runs />);

    await user.click(
      await screen.findByRole('button', { name: /open menu/i }),
    );
    await user.click(screen.getByRole('menuitem', { name: /pause/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      { id: 'job-1' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(
      screen.queryByRole('menuitem', { name: /pause/i }),
    ).not.toBeInTheDocument();
  });

  it('does not navigate to assets after confirming delete', async () => {
    const user = userEvent.setup();

    renderWithProviders(<Runs />);

    await user.click(
      await screen.findByRole('button', { name: /open menu/i }),
    );
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      { id: 'job-1' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
