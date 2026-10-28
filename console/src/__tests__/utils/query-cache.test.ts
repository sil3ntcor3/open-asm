import {
  PERSISTED_QUERY_CACHE_KEY,
  isSensitiveQueryKey,
} from '@/utils/query-cache';
import { describe, expect, it } from 'vitest';

describe('persisted query cache safety', () => {
  it('uses a versioned storage key', () => {
    expect(PERSISTED_QUERY_CACHE_KEY).toBe('rq-persist:v2');
  });

  it.each([
    [['/api/workspaces/api-key'], true],
    [['/api/tools/tool-1/api-key'], true],
    [['/api/tools', {}, 'workspace-1'], false],
    [['/api/statistic/timeline', 'workspace-1'], false],
  ] as const)(
    'classifies query key %j as sensitive=%s',
    (queryKey, expected) => {
      expect(isSensitiveQueryKey(queryKey)).toBe(expected);
    },
  );
});
