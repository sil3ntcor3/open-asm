export const BEFORE_HOOK_KEY = Symbol('BEFORE_HOOK');
export const AFTER_HOOK_KEY = Symbol('AFTER_HOOK');
export const HOOK_KEY = Symbol('HOOK');
export const AUTH_INSTANCE_KEY = Symbol('AUTH_INSTANCE');
export const AUTH_MODULE_OPTIONS_KEY = Symbol('AUTH_MODULE_OPTIONS');
export const ROLE_METADATA_KEY = Symbol('ROLE_METADATA_KEY');
export const DEFAULT_PORT = 6276;
export const DEFAULT_GRPC_PORT = 16276;
export const API_GLOBAL_PREFIX = 'api';
export const APP_NAME = 'Open Attack Surface Management';
export const DEFAULT_ADMIN_ID = '00bd7b24-2f88-4e2f-84e0-835bf28e7905';
export const WORKER_TIMEOUT = 60000; // milliseconds
export const LIMIT_WORKSPACE_CREATE = 5;
export const API_KEY_LENGTH = 36;
export const MCP_API_KEY_HEADER = 'api-key';
export const WORKER_TOKEN_HEADER = 'worker-token';
export const AUTH_IGNORE_ROUTERS = [
  'mcp',
  'messages',
  '/admin/create-user',
  '/admin/set-role',
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/remove-user',
];
export const WEBAPP_ANALYZER_SRC_URL =
  'https://raw.githubusercontent.com/oasm-platform/webappanalyzer/main/src';
export const GET_WORKSPACE_MCP_TOOL_NAME = 'get_workspaces';
export const WORKSPACE_COOKIE_NAME = 'wid';
export const WORKSPACE_HEADER_NAME = 'X-Workspace-Id';
export const CACHE_STATIC_RESOURCE = 14 * 24 * 60 * 60; // 14 days in seconds
export const BOT_ID = '019b3ae4-189e-7dfe-b10e-20d847717733';
export const BOT_EMAIL = 'bot@oasm.local';
export const BOT_NAME = 'Cai';
export const STORAGE_BASE_PATH = '/api/storage';
export const GITHUB_REPO = 'sil3ntcor3/open-asm';
export const DEFAULT_ENCRYPTION_KEY = 'OASM_DEFAULT_ENCRYPTION_KEY';

/**
 * Above this many open ports on a single host, a port-scan result is treated as
 * target-side scan detection rather than a real service list (see the tarpit
 * guard in DataAdapterService.portsScanner).
 *
 * A genuine internet-facing host exposes a handful of ports; a tarpit answers on
 * effectively all of them. 100 sits well clear of any legitimate host while
 * still catching the noise: in the enerbank.com discovery every flagged asset
 * reported 101-435 open ports, and no host sat near the boundary from below.
 * Override with OASM_TARPIT_OPEN_PORT_THRESHOLD when a target legitimately
 * exposes more (set it to 0 to disable the guard entirely).
 */
export const TARPIT_OPEN_PORT_THRESHOLD = (() => {
  const configured = Number(process.env.OASM_TARPIT_OPEN_PORT_THRESHOLD);
  if (!Number.isFinite(configured) || configured < 0) return 100;
  // 0 disables the guard: no port count can exceed Infinity.
  return configured === 0 ? Number.POSITIVE_INFINITY : configured;
})();

/**
 * Ports probed for every resolving asset regardless of what the port scan
 * returned — the discovery *floor*.
 *
 * Coverage must never be a silent function of a step that can fail. naabu is the
 * single most blockable stage in the pipeline (target-side scan detection, rate
 * limits, an unreachable worker), and it is also the only writer of
 * asset_services. So when it is blocked the asset renders as "no services",
 * which an operator reads as *clean* when it actually means *never checked*. In
 * the enerbank.com run that was 218 of 338 assets, and only 9 services on port
 * 443 across the whole target — for a estate that is overwhelmingly HTTPS.
 *
 * Seeding these ports unconditionally makes discovery degrade instead of
 * disappear: a blocked port scan costs depth, never the baseline web check.
 * These are candidate endpoints, not assertions that anything is listening —
 * httpx still decides, and records failed=true when nothing answers.
 *
 * Override with OASM_WEB_PORT_FLOOR (comma-separated); set it empty to disable.
 */
export const WEB_PORT_FLOOR = (() => {
  const configured = process.env.OASM_WEB_PORT_FLOOR;
  if (configured === undefined) return [80, 443];
  return configured
    .split(',')
    .map((port) => Number(port.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
})();
