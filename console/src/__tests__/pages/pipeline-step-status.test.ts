import { describe, expect, it } from 'vitest';

import { derivePipelineStepStatus, jobsAreActive } from '@/pages/jobs-registry/runs';
import { JobStatus } from '@/services/apis/gen/queries';

const jobs = (status: JobStatus, count: number) =>
  Array.from({ length: count }, () => ({ status }));

describe('derivePipelineStepStatus', () => {
  it('shows a downstream step as completed even when an upstream step had failures (the nuclei regression)', () => {
    // Screenshot step finished with a mix: 4 completed + 13 failed. It is done,
    // so it must not pin nuclei — which itself completed — at "pending".
    const screenshot = [
      ...jobs(JobStatus.completed, 4),
      ...jobs(JobStatus.failed, 13),
    ];
    const nuclei = jobs(JobStatus.completed, 11);

    expect(derivePipelineStepStatus([screenshot], nuclei)).toBe('completed');
  });

  it('holds a step at pending while an upstream step still has running work', () => {
    const httpx = [
      { status: JobStatus.in_progress },
      { status: JobStatus.completed },
    ];
    expect(
      derivePipelineStepStatus([httpx], jobs(JobStatus.completed, 1)),
    ).toBe('pending');
  });

  it('holds a step at pending while an upstream step still has queued work', () => {
    const httpx = [
      { status: JobStatus.pending },
      { status: JobStatus.completed },
    ];
    expect(
      derivePipelineStepStatus([httpx], jobs(JobStatus.completed, 1)),
    ).toBe('pending');
  });

  it('reports failed when the step itself has a failed job', () => {
    expect(
      derivePipelineStepStatus(
        [],
        [{ status: JobStatus.completed }, { status: JobStatus.failed }],
      ),
    ).toBe('failed');
  });

  it('reports running when the step itself is in progress', () => {
    expect(
      derivePipelineStepStatus(
        [jobs(JobStatus.completed, 1)],
        [{ status: JobStatus.in_progress }],
      ),
    ).toBe('running');
  });

  it('reports pending when the step has no jobs yet', () => {
    expect(
      derivePipelineStepStatus([jobs(JobStatus.completed, 1)], []),
    ).toBe('pending');
  });

  it('reports completed when every job in the step completed', () => {
    expect(
      derivePipelineStepStatus(
        [jobs(JobStatus.completed, 1)],
        jobs(JobStatus.completed, 3),
      ),
    ).toBe('completed');
  });
});

// Drives the run-detail polling: while any job is still active the pipeline
// pills + job table must keep refetching so they advance live; once every job
// is terminal polling stops. The pipeline pills froze mid-run because the query
// that feeds them was never given a refetch interval, so this predicate now
// gates BOTH job queries.
describe('jobsAreActive', () => {
  it('is true when any job is pending', () => {
    expect(
      jobsAreActive([
        { status: JobStatus.completed },
        { status: JobStatus.pending },
      ]),
    ).toBe(true);
  });

  it('is true when any job is in progress', () => {
    expect(jobsAreActive([{ status: JobStatus.in_progress }])).toBe(true);
  });

  it('is false when every job is terminal', () => {
    expect(
      jobsAreActive([
        { status: JobStatus.completed },
        { status: JobStatus.failed },
        { status: JobStatus.cancelled },
      ]),
    ).toBe(false);
  });

  it('is false for an empty or missing job list', () => {
    expect(jobsAreActive([])).toBe(false);
    expect(jobsAreActive(undefined)).toBe(false);
  });
});
