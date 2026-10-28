import { renderWithProviders, screen } from '@/test/utils';
import JobsRegistryPage from '@/pages/jobs-registry/jobs-registry';
import Runs from '@/pages/jobs-registry/runs';
import { act } from '@testing-library/react';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMutate = vi.fn();
const mockNavigate = vi.fn();
const {
  createMockActiveJob,
  createMockJobHistoriesResponse,
  mockActiveJob,
  mockJobHistoriesResponse,
  mockGetManyJobHistories,
} = vi.hoisted(() => {
  const createMockActiveJob = () => ({
    id: 'job-1',
    status: 'in_progress',
    assetServiceId: 'service-1',
    assetService: { value: 'https://example.com' },
    asset: { value: 'example.com' },
    tool: {
      id: 'tool-1',
      name: 'nuclei',
      logoUrl: '',
    },
    createdAt: '2026-01-01T00:00:00',
    updatedAt: '2026-01-01T00:01:45',
    pickJobAt: '2026-01-01T00:00:30',
    completedAt: null as string | null,
    errorLogs: [],
  });
  const mockActiveJob = { current: createMockActiveJob() };
  const createMockJobHistoriesResponse = () => ({
    data: [
      {
        id: 'history-1',
        status: 'in_progress',
        totalJobs: 1,
        pauseEligibleJobs: 1,
        resumeEligibleJobs: 1,
        cancelEligibleJobs: 1,
        workflowName: 'Example workflow',
        jobHistoryName: 'Example run',
        jobRunType: 'manual',
        createdAt: '2026-01-01T00:00:00',
        updatedAt: '2026-01-01T00:02:00',
      },
    ],
    page: 1,
    limit: 10,
    total: 1,
  });
  const mockJobHistoriesResponse = {
    current: createMockJobHistoriesResponse(),
  };

  return {
    createMockActiveJob,
    createMockJobHistoriesResponse,
    mockActiveJob,
    mockJobHistoriesResponse,
    mockGetManyJobHistories: vi.fn(() => ({
      data: mockJobHistoriesResponse.current,
      isLoading: false,
      isError: false,
      error: null,
      queryKey: ['JobsRegistryControllerGetManyJobHistories'],
    })),
  };
});

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'history-1' }),
  };
});

vi.mock('@/services/apis/gen/queries', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/services/apis/gen/queries')>();

  return {
    ...actual,
    useJobsRegistryControllerGetJobHistoryDetail: () => ({
      data: {
        id: 'history-1',
        jobHistoryName: 'Example run',
        workflowName: 'Example workflow',
        tools: [mockActiveJob.current.tool],
      },
    }),
    useJobsRegistryControllerGetManyJobHistories: mockGetManyJobHistories,
    useJobsRegistryControllerGetManyJobs: () => ({
      data: {
        data: [mockActiveJob.current],
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
    useJobsRegistryControllerDeleteJobHistoryJobs: () => ({
      mutate: mockMutate,
    }),
    useJobsRegistryControllerCancelJobHistoryJobs: () => ({
      mutate: mockMutate,
    }),
    useJobsRegistryControllerPauseJobHistoryJobs: () => ({
      mutate: mockMutate,
    }),
    useJobsRegistryControllerResumeJobHistoryJobs: () => ({
      mutate: mockMutate,
    }),
  };
});

describe('Job runs', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockNavigate.mockClear();
    mockActiveJob.current = createMockActiveJob();
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

    await user.click(await screen.findByRole('button', { name: /open menu/i }));

    act(() => {
      rerenderJobsTable();
    });

    expect(screen.getByRole('menuitem', { name: /pause/i })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /cancel/i })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeVisible();
  });

  it('shows headers and leaves ended values blank while a job is running', async () => {
    renderWithProviders(<Runs />);

    expect(
      await screen.findByRole('columnheader', { name: /target/i }),
    ).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /tool/i })).toBeVisible();
    expect(
      screen.getByRole('columnheader', { name: /started at/i }),
    ).toBeVisible();
    expect(
      screen.getByRole('columnheader', { name: /ended at/i }),
    ).toBeVisible();
    expect(
      screen.getByRole('columnheader', { name: /duration/i }),
    ).toBeVisible();

    expect(screen.getByText('2026-01-01 00:00:30')).toBeVisible();
    expect(screen.queryByText('2026-01-01 00:01:45')).not.toBeInTheDocument();
    expect(screen.queryByText('1m 15s')).not.toBeInTheDocument();
  });

  it('shows the end time and duration for a failed task', async () => {
    mockActiveJob.current = {
      ...createMockActiveJob(),
      status: 'failed',
      completedAt: '2026-01-01T00:01:45',
    };

    renderWithProviders(<Runs />);

    expect(await screen.findByText('2026-01-01 00:01:45')).toBeVisible();
    expect(screen.getByText('1m 15s')).toBeVisible();
  });

  it('closes the row action menu after choosing delete', async () => {
    const user = userEvent.setup();

    renderWithProviders(<Runs />);

    await user.click(await screen.findByRole('button', { name: /open menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));

    expect(
      screen.queryByRole('menuitem', { name: /delete/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /delete job/i })).toBeVisible();
  });

  it('closes the row action menu after choosing pause', async () => {
    const user = userEvent.setup();

    renderWithProviders(<Runs />);

    await user.click(await screen.findByRole('button', { name: /open menu/i }));
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

    await user.click(await screen.findByRole('button', { name: /open menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      { id: 'job-1' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('Jobs registry', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockNavigate.mockClear();
    mockJobHistoriesResponse.current = createMockJobHistoriesResponse();
    mockGetManyJobHistories.mockClear();
  });

  it('shows headers and leaves ended values blank while a run is in progress', async () => {
    renderWithProviders(<JobsRegistryPage />);

    expect(
      await screen.findByRole('columnheader', { name: /^job$/i }),
    ).toBeVisible();
    expect(
      screen.getByRole('columnheader', { name: /total jobs/i }),
    ).toBeVisible();
    expect(
      screen.getByRole('columnheader', { name: /started at/i }),
    ).toBeVisible();
    expect(
      screen.getByRole('columnheader', { name: /ended at/i }),
    ).toBeVisible();
    expect(
      screen.getByRole('columnheader', { name: /run type/i }),
    ).toBeVisible();

    expect(screen.getByText('2026-01-01 00:00:00')).toBeVisible();
    expect(screen.queryByText('2026-01-01 00:02:00')).not.toBeInTheDocument();
  });

  it('shows the end time when a run finishes with failed tasks', async () => {
    mockJobHistoriesResponse.current = {
      ...createMockJobHistoriesResponse(),
      data: [
        {
          ...createMockJobHistoriesResponse().data[0],
          status: 'failed',
        },
      ],
    };

    renderWithProviders(<JobsRegistryPage />);

    expect(await screen.findByText('2026-01-01 00:02:00')).toBeVisible();
  });

  it('shows all row actions when a run has mixed eligible jobs', async () => {
    const user = userEvent.setup();

    renderWithProviders(<JobsRegistryPage />);

    await user.click(await screen.findByRole('button', { name: /open menu/i }));

    expect(screen.getByRole('menuitem', { name: /pause/i })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /resume/i })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /cancel/i })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /delete/i })).toBeVisible();
  });

  it('runs a history action without navigating to the run detail', async () => {
    const user = userEvent.setup();

    renderWithProviders(<JobsRegistryPage />);

    await user.click(await screen.findByRole('button', { name: /open menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /pause/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      { id: 'history-1' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('confirms deletion of only jobs under the history', async () => {
    const user = userEvent.setup();

    renderWithProviders(<JobsRegistryPage />);

    await user.click(await screen.findByRole('button', { name: /open menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));

    expect(screen.getByRole('dialog', { name: /delete jobs/i })).toBeVisible();
    expect(
      screen.getByText(/delete all jobs under this registry entry/i),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: /confirm/i }));

    expect(mockMutate).toHaveBeenCalledWith(
      { id: 'history-1' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows one pagination page when there are no jobs', async () => {
    mockJobHistoriesResponse.current = {
      data: [],
      page: 1,
      limit: 10,
      total: 0,
    };

    renderWithProviders(<JobsRegistryPage />);

    expect(await screen.findByText('No data')).toBeVisible();

    const pagination = screen.getByRole('navigation', {
      name: /pagination/i,
    });

    expect(within(pagination).getByRole('link', { name: '1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(pagination).queryByRole('link', { name: '10' }),
    ).not.toBeInTheDocument();
    expect(within(pagination).getByLabelText(/go to next page/i)).toHaveClass(
      'pointer-events-none',
    );
  });

  it('keeps the registry query fresh for newly started discoveries', async () => {
    renderWithProviders(<JobsRegistryPage />);

    expect(
      await screen.findByRole('columnheader', { name: /^job$/i }),
    ).toBeVisible();

    expect(mockGetManyJobHistories).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      }),
      {
        query: expect.objectContaining({
          enabled: true,
          refetchInterval: 3000,
          refetchOnMount: 'always',
          staleTime: 0,
        }),
      },
    );
  });
});
