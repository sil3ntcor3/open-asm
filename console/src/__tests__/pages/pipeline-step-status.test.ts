import { describe, expect, it } from 'vitest';

import {
  derivePipelineStepStatus,
  stepsAreActive,
  type PipelineStepCounts,
} from '@/pages/jobs-registry/runs';

const step = (o: Partial<PipelineStepCounts> = {}): PipelineStepCounts => ({
  total: 0,
  pending: 0,
  inProgress: 0,
  paused: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  ...o,
});

describe('derivePipelineStepStatus', () => {
  it('shows a downstream step as completed even when an upstream step had failures (the nuclei regression)', () => {
    // Screenshot step finished with a mix: 4 completed + 13 failed. It is done,
    // so it must not pin nuclei — which itself completed — at "pending".
    const screenshot = step({ total: 17, completed: 4, failed: 13 });
    const nuclei = step({ total: 11, completed: 11 });

    expect(derivePipelineStepStatus([screenshot], nuclei)).toBe('completed');
  });

  it('holds a step at pending while an upstream step still has running work', () => {
    const httpx = step({ total: 2, inProgress: 1, completed: 1 });
    expect(
      derivePipelineStepStatus([httpx], step({ total: 1, completed: 1 })),
    ).toBe('pending');
  });

  it('holds a step at pending while an upstream step still has queued work', () => {
    const httpx = step({ total: 2, pending: 1, completed: 1 });
    expect(
      derivePipelineStepStatus([httpx], step({ total: 1, completed: 1 })),
    ).toBe('pending');
  });

  it('reports failed when the step itself has a failed job', () => {
    expect(
      derivePipelineStepStatus([], step({ total: 2, completed: 1, failed: 1 })),
    ).toBe('failed');
  });

  it('reports running when the step itself is in progress', () => {
    expect(
      derivePipelineStepStatus(
        [step({ total: 1, completed: 1 })],
        step({ total: 1, inProgress: 1 }),
      ),
    ).toBe('running');
  });

  it('reports pending when the step has no jobs yet', () => {
    expect(
      derivePipelineStepStatus([step({ total: 1, completed: 1 })], step()),
    ).toBe('pending');
    expect(
      derivePipelineStepStatus([step({ total: 1, completed: 1 })], undefined),
    ).toBe('pending');
  });

  it('reports completed when every job in the step completed', () => {
    expect(
      derivePipelineStepStatus(
        [step({ total: 1, completed: 1 })],
        step({ total: 3, completed: 3 }),
      ),
    ).toBe('completed');
  });

  // Regression: the indicator used to read the first page (limit 100) of the
  // paginated job list. On the enerbank.com run — 1 subfinder + 338 naabu +
  // 1,802 nmap = 2,141 jobs, ordered active-work-first — page one held nothing
  // but nmap, so subfinder and naabu had zero jobs in the payload and rendered
  // as "pending" despite being fully complete. Whole-run counts cannot be
  // truncated by a page size, so the finished steps stay finished.
  it('reports finished upstream steps as completed on a run larger than one page', () => {
    const subfinder = step({ total: 1, completed: 1 });
    const naabu = step({ total: 338, completed: 338 });
    const nmap = step({ total: 1802, completed: 83, inProgress: 3, pending: 1716 });

    expect(derivePipelineStepStatus([], subfinder)).toBe('completed');
    expect(derivePipelineStepStatus([subfinder], naabu)).toBe('completed');
    expect(derivePipelineStepStatus([subfinder, naabu], nmap)).toBe('running');
    // Downstream steps have no jobs yet and stay pending behind running nmap.
    expect(
      derivePipelineStepStatus([subfinder, naabu, nmap], step()),
    ).toBe('pending');
  });

  it('reports a step whose work is all terminal but partly cancelled as completed', () => {
    expect(
      derivePipelineStepStatus([], step({ total: 5, completed: 2, cancelled: 3 })),
    ).toBe('completed');
  });
});

// Drives the run-detail polling: while any step still has active work the job
// table must keep refetching so it advances live; once every job is terminal
// polling stops. Derived from whole-run step counts rather than a second
// 100-row job query, which duplicated the polling and could not describe a run
// larger than one page.
describe('stepsAreActive', () => {
  it('is true when any step has queued work', () => {
    expect(
      stepsAreActive([
        step({ total: 1, completed: 1 }),
        step({ total: 2, pending: 2 }),
      ]),
    ).toBe(true);
  });

  it('is true when any step is in progress', () => {
    expect(stepsAreActive([step({ total: 1, inProgress: 1 })])).toBe(true);
  });

  it('is true when a step is paused', () => {
    expect(stepsAreActive([step({ total: 1, paused: 1 })])).toBe(true);
  });

  it('is false when every step is terminal', () => {
    expect(
      stepsAreActive([
        step({ total: 2, completed: 1, failed: 1 }),
        step({ total: 1, cancelled: 1 }),
      ]),
    ).toBe(false);
  });

  it('is false for an empty or missing step list', () => {
    expect(stepsAreActive([])).toBe(false);
    expect(stepsAreActive(undefined)).toBe(false);
  });
});
