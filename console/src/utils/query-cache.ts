export const LEGACY_PERSISTED_QUERY_CACHE_KEY = 'rq-persist';
export const PERSISTED_QUERY_CACHE_KEY = 'rq-persist:v2';

const TOOL_API_KEY_PATH = /^\/api\/tools\/[^/]+\/api-key$/;

/** Prevents credential-bearing API responses from being written to storage. */
export const isSensitiveQueryKey = (queryKey: readonly unknown[]): boolean => {
  const endpoint = queryKey[0];
  if (typeof endpoint !== 'string') return false;

  return (
    endpoint === '/api/workspaces/api-key' || TOOL_API_KEY_PATH.test(endpoint)
  );
};
