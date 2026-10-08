# Upstream sync review: oasm-platform/open-asm `v0.8.1` → sil3ntcor3/open-asm `dev`

Status: **PLAN — Phase 2 checkpoint (no upstream code applied yet)**. Branch: `merge/upstream-v0.8.1` (local only, created from `origin/dev` `7ca40f8d`).

## Summary

- **TAG:** `v0.8.1` → `aad31c2175e4df5fb6e092836c362d1d4f0958e3` (latest non-prerelease per `gh release view -R oasm-platform/open-asm`, published 2026-09-30; local clone at `oasm-platform-master/open-asm` resolves the same SHA).
- **BASE:** `8ddfef100a99e506ce8897f51d03c01887b40399` — upstream `refactor(router): improve router logic and fix some bug (#453)`, 2026-06-23. Determined by `git merge-base origin/dev v0.8.1` (single merge base).
  - **Deviation from the prompt's assumption:** BASE does *not* predate the fork's first unique commit. The fork branched from upstream `4437b6e1` (#430, 2026-06-09) and later merged upstream `main` at `8ddfef10` in fork commit `5cd1c5bf` ("merge(upstream): sync with oasm-platform/open-asm main", 2026-06-23). This is therefore the **second** upstream sync. It does not change the method: nothing after `8ddfef10` is in the fork, and `git diff BASE origin/dev` still captures every fork-authored change (including that merge's resolutions).
- **Upstream remote:** FORK_DIR already had `upstream` → `https://github.com/oasm-platform/open-asm.git`; it was fetched (read-only) instead of adding the local clone. The local clone was used only as a read-only reference.
- **Fork tip:** `origin/dev` = `7ca40f8d1ff9ebcd771754774c61f6f5ea460bbc`.

| Class | Units |
|---|---|
| CLEAN | 5 |
| OVERLAP | 29 |
| CONFLICT | 34 |
| SEMANTIC-CONFLICT | 0 |
| DEFERRED-ARCH | 15 |
| DEPENDENT | 33 |
| MIGRATION-RISK | 1 |
| EXCLUDED | 22 |
| **Total** | **139** (from 148 first-parent upstream commits, 156 commits total) |

**Verdict:** _pending Phase 3._

## Sync record

- Previous sync: fork merge `5cd1c5bf` took upstream through `8ddfef10` (#453).
- This sync: upstream `v0.8.1` = `aad31c2175e4df5fb6e092836c362d1d4f0958e3`. Cherry-picks do not record upstream ancestry, so **this file is the source of truth**: the next sync should diff from `v0.8.1` and skip the applied SHAs below; every unit not listed as applied remains outstanding.
- Applied unit source SHAs: _filled in Phase 3._

## Method

- **Units.** Upstream mostly squash-merges PRs (subject ends in `(#NNN)`); 3 true merge commits (`03c3cd3d` #483, `9ad23690` #526+#524, `0179331e` #615) are treated as one unit each (`-m 1`). Direct commits without a PR are one unit each (dependency bumps, small fixes), except these follow-ups grouped with their feature:
  - `ecfe5b35`, `53b81d6e`, `b7981278`: MCP consolidation (#463) + MCP Connect tab enablement + mcp.service follow-up, same day, same files.
  - `54de2dfe`, `e04264b6`: statistic cron (#479) + its optimisation follow-up (same service files).
  - `0e25a58b`, `27273d85`: Vite 8 (#475) + rollup optional dependency added "for vite compatibility".
  - `635b1ec2`, `cf7b04dc`: worker TUI (#517) + headless mode for the same TUI.
  - `1225ad8c`, `ab1f0cfa`: better-auth OpenAPI integration + type-cast follow-up.
  - `d7988f37`, `e859add2`, `40e053c6`: pnpm migration (#574) + Dockerfile moves/build-context fixes made for it the same day.
  - `7d143abe`, `3f58d7ad`: connector manifest sync + workflow config aligned to new connector defaults.
- **Prediction.** For each commit: `git merge-tree --write-tree --merge-base=<parent> origin/dev <commit>` (conflicts vs fork) and the same against BASE (conflicts caused by missing upstream prerequisites). A conflict that occurs on `origin/dev` but not on BASE is attributed to fork changes (→ CONFLICT); one that also occurs on BASE means the unit builds on an earlier upstream unit (→ DEPENDENT, prerequisite = the latest earlier skipped unit touching that file).
- **Sequential dry-run.** Units were then simulated oldest-first by chaining `merge-tree` results through dangling `git commit-tree` objects (no refs touched), dropping excluded paths each step, and running a `git blame`-based check that no line authored in `BASE..origin/dev` is deleted or rewritten. Phase 3 cherry-picks are authoritative.
- **Excluded paths** were interpreted as `.github/**` plus `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc` **at any depth** (upstream also touches `console/pnpm-lock.yaml`).
- **Hard rule 3 (image tags)** was interpreted to include Dockerfile base-image tags (`FROM node:22-alpine` → `node:26-alpine`); those units are classified EXCLUDED.
- **Semantic overrides** (textually clean but not applicable): U103 (#616, imports `usePermission` from #602), U073 (`e8b2220b`, tracks upstream-generated OpenAPI spec), U065 (`cb769bda`, README screenshots of absent features), U069 (`ab8119f2`, binary depends on U065), U013 (#465, guide text for dropped CI), U136 (#662, MIGRATION-RISK).

## Fork inventory (`BASE..origin/dev`)

153 commits (incl. 39 merges); 382 files changed, 43690 insertions(+), 7713 deletions(-).

| Service | Files | Fork-authored paths (abridged) |
|---|---|---|
| console | 86 | `console/src/pages` (35), `console/src/__tests__` (19), `console/src/components` (9), `console/src/hooks` (4), `console/src/test` (4), `console/src/routes` (3), `console/src/services` (2), `console/src/utils` (2), `console/Dockerfile`, `console/e2e/auth`, `console/nginx.conf`, `console/package.json` … |
| core-api | 215 | `core-api/src/modules` (134), `core-api/public/archived` (33), `core-api/src/common` (22), `core-api/src/database` (14), `core-api/src/proto` (2), `core-api/src/utils` (2), `core-api/Dockerfile`, `core-api/example.env`, `core-api/package.json`, `core-api/public/images`, `core-api/src/main.ts`, `core-api/src/provision-admin-input.ts` … |
| worker | 50 | `worker/internal/worker` (26), `worker/third_party/oasm-sdk-go` (15), `worker/internal/config` (2), `worker/.example.env`, `worker/Dockerfile`, `worker/go.mod`, `worker/go.sum`, `worker/provider-config.example.yaml`, `worker/scripts/install.ps1`, `worker/scripts/install.sh` |
| grpc-client | 12 | `grpc-client/go/jobs_registry` (2), `grpc-client/go/workers` (2), `grpc-client/ts/google` (2), `grpc-client/go/go.mod`, `grpc-client/go/go.sum`, `grpc-client/ts/jobs_registry.client.ts`, `grpc-client/ts/jobs_registry.ts`, `grpc-client/ts/workers.client.ts`, `grpc-client/ts/workers.ts` |
| infra/docs | 33 | `.dockerignore`, `.github/workflows/build-myoasm-images.yml`, `.github/workflows/build-nightly.yml`, `.github/workflows/build-release.yml`, `.github/workflows/check-build.yml`, `.github/workflows/check-lint.yml`, `.github/workflows/check-test.yml`, `.github/workflows/check-tool-updates.yml`, `.github/workflows/frontend-tests.yml`, `.gitignore`, `.husky/commit-msg`, `.husky/commit-msg.disabled` … |

The full file list (which defines "fork-authored") is `git diff --name-only 8ddfef10 origin/dev`.

**What the fork changed, in plain language:**

- **Release/infra:** own image pipeline (`build-myoasm-images.yml` → `sil3ntcor3/myoasm-*` on Docker Hub for `dev`/`main`), upstream nightly/release workflows removed, tool-update check workflow, hardened compose (Postgres healthcheck, state services, first-admin bootstrap), `docker-compose.dev.yml`, subfinder-providers compose, `scripts/` (image builds, compose security test), VS Code workspace.
- **Job engine (core-api):** `SKIP LOCKED` job pickup, job indexes, status-priority ordering, pagination/count fixes, cancelled-status handling, scan windows / pause / per-target concurrency, bulk discovery and add-target-without-discovery, pipeline step ordering, tarpit/edge detection gates, discovery-history status fixes.
- **Data model (13 migrations):** jobs indexes, job control/scan window columns, vulnerability evidence, expanded → relational workspace roles & permissions, unique membership, removal of remote-execution columns, worker scanner status & tool-update management, asset DNS status + job terminal details, asset_service discovery columns (nmap), http_responses edge/CDN columns.
- **Security remediations:** controller role-metadata enforcement, first-admin bootstrap hardening and private provisioning, workspace-scoped job queries.
- **Findings/assets:** vulnerability drilldown, informational findings, filtered severity counts, CSV/XLSX asset exports, report target option.
- **Worker (Go):** subfinder/naabu/nuclei/httpx fixes, wildcard-DNS filtering, nmap service discovery, best-effort screenshots (TLS-ignore, web-only), edge/tarpit detection, scanner health loop, managed tool-update rollout, pinned/prebaked scanner artifacts, nuclei parser fixes.
- **Console:** jobs page (headers, row actions, counts), scan-window UI, tools/versions UI, roles/access UI, assets export, vulnerability filters/drilldown, workspace header, SW/`index.html` revalidation.
- **grpc-client:** regenerated Go/TS stubs for fork proto changes (+ `go.sum`).
- **Docs:** administrator and user guides, AGENTS.md.

## Units table

Services: c = console, a = core-api, w = worker, g = grpc-client, i = infra/docs. "Fork commits" = fork commits touching the conflicting (or overlapping) files.

| ID | Upstream PR | Title | Svc | Class | Action | Fork commits involved | Risk | Security-relevant | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| U001 | #456 | fix(console): prevent premature 401 redirect on initial page load (#456) — conflicts with fork changes in: `console/src/pages/tools/components/marketplace.tsx` (`79fe5ca9`) | c | CONFLICT | Skip | `46a01e21` `f4bfb619` | M | Y — 401 redirect handling | Fork rewrote marketplace page; port 401-redirect fix manually if the bug reproduces |
| U002 | — | refactor(assets): remove isErrorPage filter from asset queries — conflicts with fork changes in: `core-api/src/modules/assets/assets.service.ts`, `core-api/src/modules/targets/targets.service.ts` (`14208ea7`) | a | CONFLICT | Skip | `f7e0d50b` `b604228d` `d7657854` `2858d942` +11 | M | N | Keep fork; port manually only if needed |
| U003 | — | refactor(dashboard): update grid classes for responsive layout (`852ecc73`) | c | OVERLAP | Apply | `b81aef1c` | M | N | Apply; review overlap |
| U004 | #458 | feat(console): add custom top progress bar for route transitions (#458) (`3dc457c5`) | c | OVERLAP | Apply | `f4bfb619` `b81aef1c` | M | N | Apply; review overlap |
| U005 | #459 | fix(console,core-api): align notification asset counts with detail screen and filter null status codes (#459) — conflicts with fork changes in: `core-api/src/modules/assets/assets.service.ts` (`045a9eba`) | ca | CONFLICT | Skip | `f7e0d50b` `b604228d` `2858d942` `69ae8ea0` +3 | M | N | Keep fork; port manually only if needed |
| U006 | #460 | feat(notifications): replace popover with sheet and add delete (#460) — REGEN: conflict only in generated/lockfile (`console/src/services/apis/gen/queries.ts`); regenerate (`934ebbb4`) | ca | OVERLAP | Apply (regen) | `46a01e21` `ff25fcb9` `bcbc2095` `892d4c4d` +14 | M | Y — new `DELETE /api/notifications/:id`; delete is scoped to `{id, userId}` (recipient row only) | Apply; regenerate API client |
| U007 | — | style(console): update sidebar and tabs active indicator styles (`7875fa25`) | c | OVERLAP | Apply | `22679e89` | M | N | Apply; review overlap |
| U008 | #461 | fix(worker): add arm64 Docker image support via cross-compilation (#461) — conflicts with fork changes in: `worker/Dockerfile` (`db589104`) | w | CONFLICT | Skip | `09b38792` `40fa3f36` `dddeb62e` `4b54f43a` +1 | M | N | Fork owns worker Dockerfile/image pipeline; port arm64 cross-compile manually if needed |
| U009 | — | feat(console): auto-update document.title from Page component (`19a27574`) | c | CLEAN | Apply | — | L | N | Apply |
| U010 | #462 | feat(console): add AI-powered tag generation for assets (#462) — conflicts with fork changes in: `core-api/src/modules/assets/assets.service.spec.ts` (`838481b7`) | ca | CONFLICT | Skip | `f7e0d50b` `b604228d` `ad9a5548` | M | Y — LLM-backed tag generation (data sent to provider) | Keep fork; port manually only if needed |
| U011 | #463 | refactor(core-api): consolidate MCP tools into agents module with security improvements (#463) (+53b81d6e, b7981278) — conflicts with fork changes in: `console/src/pages/settings/settings.tsx`, `core-api/src/modules/agents/agents.tools.ts` (`ecfe5b35`) | ca | CONFLICT | Skip | `dddeb62e` `3f63d297` `ad9a5548` | M | Y — MCP tool consolidation advertised "with security improvements" | Keep fork; port manually only if needed |
| U012 | #464 | fix(notifications): filter notifications by workspace (#464) (`2fece036`) | ca | OVERLAP | Apply (regen) | `46a01e21` `ff25fcb9` `bcbc2095` `892d4c4d` +14 | M | Y — scopes notification list to active workspace (`@WorkspaceId`) — limits cross-workspace notification bleed | Apply; regenerate API client (upstream generated hunk carries unrelated MCP hooks) |
| U013 | #465 | ci(infra): fix existing workflows — path filters, npm workspace, buildx  (#465) — all substantive changes are `.github/**`; the only remaining hunk (DEVELOPER_GUIDE.md "Local CI Testing") documents `.github/scripts/test-local.sh` and workflows the fork deleted (`3993a3a6`) | i | EXCLUDED | Log only | — | L | N | None (CI is fork-owned) |
| U014 | #478 | feat(console): auto-fill workspace name and redirect new users to discovery (#478) (`98d145aa`) | c | OVERLAP | Apply | `22679e89` | M | N | Apply; verify onboarding redirect to /targets/start-discovery fits fork add-target flow |
| U015 | — | refactor(issues): comment out unused code in menu-bar, data-adapter, issues, and jobs-registry modules — conflicts with fork changes in: `core-api/src/modules/data-adapter/data-adapter.service.ts` (`40e68782`) | ca | CONFLICT | Skip | `3d0169e7` `e93521d9` `df1ae7dd` `f3236b84` +4 | M | N | Keep fork; port manually only if needed |
| U016 | — | feat(routes): add create issue route and enable its component (`32763ee7`) | c | OVERLAP | Apply | `669e5f70` | L | N | Apply; confirm create-issue page works in fork |
| U017 | #479 | refactor(statistic): skip unchanged records in daily cron and add distributed lock (#479) (+e04264b6) — conflicts with fork changes in: `core-api/src/modules/data-adapter/data-adapter.service.spec.ts` [deps: U005] (`54de2dfe`) | a | CONFLICT | Skip | `3d0169e7` `e93521d9` `df1ae7dd` `f3236b84` +4 | M | N | Keep fork; port manually only if needed |
| U018 | #480 | refactor(core-api): wrap TypeORM relations with Relation<> type (#480) — conflicts with fork changes in: `core-api/src/modules/agents/entities/agent-conversation.entity.ts`, `core-api/src/modules/targets/entities/target.entity.ts`, `core-api/src/modules/tools/ (`5cf231ed`) | ca | CONFLICT | Skip | `46a01e21` `892d4c4d` `c19baf61` `18c17f93` +6 | H | N | Keep fork; port manually only if needed |
| U019 | #482 | feat(remote-execute): add command validation and unit tests (#482) — conflicts with fork changes in: `core-api/src/modules/remote-execute/dto/run-command.dto.ts`, `core-api/src/modules/remote-execute/remote-execute.service.ts`, `core-api/src/modules/workers/re (`c169ed46`) | a | CONFLICT | Skip | `ad9a5548` | M | Y — remote-execute command validation (command-injection guard); fork removed remote-execution columns | Fork removed remote execution; no action unless re-enabled |
| U020 | #481 | fix(worker): fix screenshot (#481) (`0395ec58`) | w | OVERLAP | Apply | `6d5227d7` | M | N | Apply; verify screenshot timing on JS-heavy sites (fork tuned screenshot pipeline) |
| U021 | — | ci(changelog): improve changelog generation output — only excluded paths (`.github/**`, pnpm files) (`21d4ed44`) | — | EXCLUDED | Log only | — | L | N | None |
| U022 | #484 | refactor(workspaces): remove workspace_targets and link target directly to workspace (#484) — conflicts with fork changes in: `console/src/pages/targets/setting-target.tsx`, `console/src/services/apis/gen/queries.ts`, `core-api/src/modules/reports/services/sum (`a5649040`) | ca | CONFLICT | Skip | `46a01e21` `ff25fcb9` `bcbc2095` `892d4c4d` +25 | H | Y — tenancy model change (drops `workspace_targets`) | Do not port; fork queries rely on workspace_targets (e.g. getManyJobs join) |
| U023 | #485 | feat(console): add worker selection to agent mode toggle (#485) — requires skipped U019 [deps: U019] (`22f07410`) | ca | DEPENDENT | Skip | `ad9a5548` | M | N | Revisit if prerequisites adopted |
| U024 | #483 | chore(deps): bump golang.org/x/net from 0.53.0 to 0.55.0 in /worker (#483) (`03c3cd3d`) | w | OVERLAP | Apply | `dddeb62e` `ad9a5548` `f6456a4b` | M | N | Apply; review overlap |
| U025 | #477 | Merge pull request #477 from oasm-platform/dependabot/npm_and_yarn/js-yaml-4.2.0 (`2ec5a548`) | ai | OVERLAP | Apply | `b604228d` `a2708df6` `dddeb62e` | M | Y — js-yaml security bump | Apply; review overlap |
| U026 | — | chore: bump axios from 1.15.2 to 1.18.1 — conflicts with fork changes in: `core-api/package.json`, `package-lock.json` (`ce874631`) | cai | CONFLICT | Skip | `b604228d` `a2708df6` `dddeb62e` | M | Y — axios security bump | Bump axios manually in fork (fork pins core-api axios) |
| U027 | — | chore: bump tar from 7.5.15 to 7.5.19 (`a4392840`) | i | OVERLAP | Apply | `b604228d` `dddeb62e` | M | Y — tar security bump | Apply; review overlap |
| U028 | — | chore: bump form-data from 4.0.5 to 4.0.6 (`5251d2aa`) | i | OVERLAP | Apply | `b604228d` `dddeb62e` | M | Y — form-data security bump | Apply; review overlap |
| U029 | — | chore: bump uuid from 13.0.0 to 14.0.1 (`fb3161e4`) | ci | OVERLAP | Apply | `b604228d` `dddeb62e` | M | Y — uuid major bump (console) | Apply; uuid v14 is ESM-only — console only |
| U030 | — | chore: bump dompurify from 3.3.3 to 3.4.11 (`d0963ca7`) | i | OVERLAP | Apply | `b604228d` `dddeb62e` | M | Y — dompurify XSS-fix bump | Apply; review overlap |
| U031 | — | chore: bump nestjs group with 8 updates (`1334e25c`) | ai | OVERLAP | Apply | `b604228d` `a2708df6` `dddeb62e` | M | Y — NestJS patch bumps | Apply; review overlap |
| U032 | — | chore: bump markdown-it from 14.1.1 to 14.3.0 (`7c308878`) | i | OVERLAP | Apply | `b604228d` `dddeb62e` | M | Y — markdown-it bump | Apply; review overlap |
| U033 | — | chore: bump docker/login-action from 3 to 4 — only excluded paths (`.github/**`, pnpm files) (`4bac71bc`) | — | EXCLUDED | Log only | — | L | N | None |
| U034 | — | chore: bump actions/setup-node from 4 to 6 — only excluded paths (`.github/**`, pnpm files) (`92676f88`) | — | EXCLUDED | Log only | — | L | N | None |
| U035 | — | chore: bump softprops/action-gh-release from 2 to 3 — only excluded paths (`.github/**`, pnpm files) (`29a2bfcc`) | — | EXCLUDED | Log only | — | L | N | None |
| U036 | — | chore: bump multer from 2.1.1 to 2.2.0 (`ae004800`) | ai | OVERLAP | Apply | `b604228d` `a2708df6` `dddeb62e` | M | Y — multer bump (upload parsing) | Apply; review overlap |
| U037 | — | chore: bump docker/setup-buildx-action from 3 to 4 — only excluded paths (`.github/**`, pnpm files) (`a0dfdeaa`) | — | EXCLUDED | Log only | — | L | N | None |
| U038 | — | chore: bump node from 22-alpine to 26-alpine in /console — hard rule 3: changes Docker base-image tag (`node:22-alpine` → `node:26-alpine`) (`32888710`) | c | EXCLUDED | Log only | `71c67ee5` | L | N | Bump base images in fork image pipeline deliberately if wanted |
| U039 | — | chore: bump hono from 4.12.23 to 4.12.28 (`fd006bdd`) | i | OVERLAP | Apply | `b604228d` `dddeb62e` | M | Y — hono bump | Apply; review overlap |
| U040 | — | chore: bump docker/setup-qemu-action from 3 to 4 — only excluded paths (`.github/**`, pnpm files) (`5f11e107`) | — | EXCLUDED | Log only | — | L | N | None |
| U041 | — | chore: bump node from 22-alpine to 26-alpine in /core-api — hard rule 3: changes Docker base-image tag (`node:22-alpine` → `node:26-alpine`) (`38fa8c5e`) | a | EXCLUDED | Log only | `3f63d297` | L | N | Bump base images in fork image pipeline deliberately if wanted |
| U042 | #343 | chore(deps): bump basic-ftp from 5.2.0 to 5.3.1 (#343) — empty commit (changes already present upstream; no file changes) (`cba904d1`) | — | EXCLUDED | Log only | — | L | N | None |
| U043 | #341 | chore(deps): bump postcss from 8.5.8 to 8.5.15 (#341) (`a74d331f`) | i | OVERLAP | Apply | `b604228d` `dddeb62e` | M | Y — postcss bump | Apply; review overlap |
| U044 | #335 | chore(deps): bump @nestjs/microservices from 11.1.17 to 11.1.19 (#335) — REGEN: conflict only in generated/lockfile (`package-lock.json`); regenerate (`79cb1143`) | i | OVERLAP | Apply (regen) | `b604228d` `dddeb62e` | M | Y — NestJS bump | Apply; review overlap |
| U045 | #328 | chore(deps): bump @hono/node-server from 1.19.11 to 1.19.14 (#328) — empty commit (changes already present upstream; no file changes) (`6771f4f4`) | — | EXCLUDED | Log only | — | L | N | None |
| U046 | #324 | chore(deps): bump @nestjs/core from 11.1.17 to 11.1.18 (#324) (`99480c16`) | i | OVERLAP | Apply | `b604228d` `dddeb62e` | M | Y — NestJS bump | Apply; review overlap |
| U047 | #272 | chore(deps): bump lodash, @nestjs/config and @nestjs/swagger (#272) — empty commit (changes already present upstream; no file changes) (`5c853fe9`) | — | EXCLUDED | Log only | — | L | N | None |
| U048 | #269 | chore(deps): bump webpack and @nestjs/cli in /core-api (#269) — empty commit (changes already present upstream; no file changes) (`723742ac`) | — | EXCLUDED | Log only | — | L | N | None |
| U049 | #475 | chore: bump vite from 6.4.1 to 8.1.3 (#475) (+27273d85) — REGEN: conflict only in generated/lockfile (`package-lock.json`); regenerate (`0e25a58b`) | ci | OVERLAP | Apply (regen) | `b604228d` `dddeb62e` | H | Y — build-tool major bump (supply-chain surface) | Apply only with explicit OK (Vite 6→8 major) |
| U050 | — | refactor(test): use test utility wrapper and async assertions for connect-worker-dialog (`bfdefb26`) | c | CLEAN | Apply | — | L | N | Apply |
| U051 | — | refactor(worker): update headless browser init and improve screenshot rendering — conflicts with fork changes in: `worker/internal/worker/client.go` (`7613114a`) | w | CONFLICT | Skip | `14243401` `46a01e21` `d7657854` `18c17f93` +4 | M | N | Fork owns screenshot/browser init; review ideas only |
| U052 | #522 | feat(integrations): add integrations with custom fields and layout refactor (#522) — requires skipped U011, U022, U026 [deps: U011, U022, U026] (`c5f944ea`) | cai | DEPENDENT | Skip | `46a01e21` `ff25fcb9` `bcbc2095` `892d4c4d` +18 | H | N | Revisit if prerequisites adopted |
| U053 | #517 | feat(worker): design tui for worker (#517) (+cf7b04dc) — conflicts with fork changes in: `worker/internal/worker/job.go`, `worker/internal/worker/remote_execute.go` [deps: U051] (`635b1ec2`) | w | CONFLICT | Skip | `09b38792` `c19baf61` `e93521d9` `df1ae7dd` +10 | M | N | Worker TUI is upstream UX; fork worker is heavily customised — do not port |
| U054 | #538 | feat(console): add target switcher dropdown to detail page (#538) (`dd7ce943`) | c | CLEAN | Apply | — | L | N | Apply |
| U055 | #539 | refactor(core-api): convert entity enum columns to varchar type (#539) — conflicts with fork changes in: `core-api/src/modules/workspaces/entities/workspace-members.entity.ts` [deps: U018] (`9526f196`) | a | CONFLICT | Skip | `e77fd541` `3f63d297` `ad9a5548` | H | N | Do not port as-is; fork migrations alter the same enums. Re-evaluate only if adopting upstream schema wholesale |
| U056 | — | feat(console): replace screenshot hover tooltip with click-to-fullscreen modal (`d70dc300`) | c | CLEAN | Apply | — | L | N | Apply |
| U057 | — | fix(core-api,console): fix service list sorting by using TypeORM metadata and enable screenshot sort (`ca265281`) | ca | OVERLAP | Apply | `f7e0d50b` `b604228d` `2858d942` `69ae8ea0` +3 | M | Y — `sortBy` whitelisted against TypeORM entity metadata before `orderBy()` | Apply; verify asset list sorting |
| U058 | #541 | feat(core-api,console): add new vulnerability notifications (#541) — conflicts with fork changes in: `core-api/src/modules/data-adapter/data-adapter.service.spec.ts` [deps: U005, U015, U052] (`a4758a20`) | ca | CONFLICT | Skip | `3d0169e7` `e93521d9` `df1ae7dd` `f3236b84` +4 | M | N | Keep fork; port manually only if needed |
| U059 | #542 | feat(core-api,console): add Telegram bot pairing flow (#542) — requires skipped U017, U052, U055, U058 [deps: U017, U052, U055, U058] (`0fa30524`) | cai | DEPENDENT | Skip | `46a01e21` `ff25fcb9` `bcbc2095` `892d4c4d` +17 | H | Y — Telegram bot pairing (bot tokens, chat linkage) | Revisit if prerequisites adopted |
| U060 | #546 | feat(secure): level envelope encryption with key rotation (#546) — conflicts with fork changes in: `core-api/src/modules/workspaces/workspaces.service.ts` [deps: U010, U017, U022, U052] (`b1971b62`) | a | CONFLICT | Skip | `e77fd541` `3f63d297` `ad9a5548` | H | Y — workspace envelope encryption + key rotation | Port deliberately later (new migration, fork timestamp) if envelope encryption is wanted; note timestamp collision 1785000000000 |
| U061 | #548 | fix(telegram,encryption):  restore DEK-based decryption (#548) — requires skipped U060 [deps: U060] (`72ab4598`) | a | DEPENDENT | Skip | — | M | Y — DEK decryption fix | Revisit if prerequisites adopted |
| U062 | #549 | feat(integrations): implement telegram bot command framework (#549) — requires skipped U059, U061 [deps: U059, U061] (`8574eac4`) | ai | DEPENDENT | Skip | `b604228d` `a2708df6` `dddeb62e` | M | Y — Telegram bot command surface | Revisit if prerequisites adopted |
| U063 | #550 | refactor(console): redesign llm connect panel and restructure agents components (#550) — conflicts with fork changes in: `console/src/hooks/use-agent-chat.ts`, `console/src/pages/vulnerabilities/detail-vulnerability.tsx`, `core-api/src/modules/agents/agents.co (`621a44f9`) | cai | CONFLICT | Skip | `ad9a5548` `f49693ec` | H | Y — LLM provider/connect panel | Keep fork; port manually only if needed |
| U064 | #547 | chore: bump actions/setup-go from 5 to 7 (#547) — only excluded paths (`.github/**`, pnpm files) (`1b565e80`) | — | EXCLUDED | Log only | — | L | N | None |
| U065 | — | docs(readme): add integrations and agents screenshots — README screenshots document upstream integrations (#522) and agents (#550) UI the fork does not have (`cb769bda`) | i | DEPENDENT | Skip | `1148a294` `97a6abfa` `ff25fcb9` `bcbc2095` +3 | M | N | Do not adopt (documents absent features) |
| U066 | — | chore(ci): grant pull-requests read access to build-release workflow — only excluded paths (`.github/**`, pnpm files) (`98124f42`) | — | EXCLUDED | Log only | — | L | N | None |
| U067 | — | feat(core-api): fetch dynamic anthropic models — requires skipped U063 [deps: U063] (`e5251581`) | a | DEPENDENT | Skip | — | M | Y — calls Anthropic models API | Revisit if prerequisites adopted |
| U068 | #526, 524 | Merge branch 'main' of https://github.com/oasm-platform/open-asm (`9ad23690`) | cai | OVERLAP | Apply | `b604228d` `a2708df6` `dddeb62e` | M | N | Apply; review overlap |
| U069 | — | docs(readme): add project logo to README header — edits `docs/images/mcp.png` last changed by skipped cb769bda (binary conflict once cb769bda is skipped) [deps: U065] (`ab8119f2`) | i | DEPENDENT | Skip | `1148a294` `97a6abfa` `ff25fcb9` `bcbc2095` +3 | M | N | Optional: re-apply logo hunk by hand |
| U070 | — | refactor(console): restructure statistic card layout and remove card wrapper (`208f73c6`) | c | CLEAN | Apply | — | L | N | Apply |
| U071 | — | docs(readme): update badges and improve styling — requires skipped U065, U069 [deps: U065, U069] (`9988b0af`) | i | DEPENDENT | Skip | `1148a294` `97a6abfa` `ff25fcb9` `bcbc2095` +3 | M | N | Optional: README badges by hand |
| U072 | #555 | feat(workspace): add configs section and skip SUBDOMAINS jobs when asset-discovery disabled (#555) — conflicts with fork changes in: `console/src/components/ui/job-status.tsx`, `console/src/pages/assets/list-assets.tsx`, `console/src/pages/jobs-registry/runs.t (`7d9b12b5`) | cai | CONFLICT | Skip | `f7e0d50b` `b604228d` `f3236b84` `ef133f6d` +28 | M | N | Keep fork; port manually only if needed |
| U073 | — | chore(docs): track openapi specification file — tracks upstream-generated `.open-api/open-api.json` (describes endpoints from skipped units) and un-ignores `.open-api/`, contrary to fork AGENTS.md gotcha 6 (`e8b2220b`) | i | DEPENDENT | Skip | `c19baf61` | M | N | Do not adopt; keep `.open-api/` generated and ignored |
| U074 | #561 | refactor(console): standardize tanstack query keys (#561) — conflicts with fork changes in: `console/src/hooks/useTimelineTrend.ts`, `console/src/pages/dashboard/components/asset-trends.tsx`, `console/src/pages/dashboard/components/issues-timeline.tsx`, `conso (`1db01212`) | c | CONFLICT | Skip | `f4bfb619` `a9e4ff21` | M | N | Keep fork; port manually only if needed |
| U075 | — | feat: add better-auth openapi integration (+ab1f0cfa) — conflicts with fork changes in: `core-api/src/main.ts` [deps: U018, U073] (`1225ad8c`) | ai | CONFLICT | Skip | `18c17f93` `ad9a5548` | M | Y — exposes better-auth endpoints in OpenAPI doc | Keep fork; port manually only if needed |
| U076 | — | feat(console): enhance UI components and tool installation safety — conflicts with fork changes in: `console/src/pages/settings/components/get-about-project.tsx`, `console/src/pages/tools/components/tool-install-button.tsx` [deps: U059, U074] (`994bbe3a`) | c | CONFLICT | Skip | `dddeb62e` `3f63d297` | M | Y — "tool installation safety" hardening | Keep fork; port manually only if needed |
| U077 | — | chore: update funding — only excluded paths (`.github/**`, pnpm files) (`218930d4`) | — | EXCLUDED | Log only | — | L | N | None |
| U078 | #560 | chore: bump fast-uri from 3.1.0 to 3.1.4 (#560) (`e20f0b7b`) | i | OVERLAP | Apply | `b604228d` `dddeb62e` | M | Y — fast-uri bump | Apply; review overlap |
| U079 | #540 | chore: bump actions/setup-node from 6 to 7 (#540) — only excluded paths (`.github/**`, pnpm files) (`f0b9ce95`) | — | EXCLUDED | Log only | — | L | N | None |
| U080 | #552 | feat(api,worker): split job result into category-scoped endpoints (#552) — conflicts with fork changes in: `core-api/src/common/enums/enum.ts`, `core-api/src/modules/data-adapter/data-adapter.service.ts`, `core-api/src/modules/jobs-registry/dto/jobs-registry.d (`31b0371e`) | cagiw | CONFLICT | Skip | `3d0169e7` `e93521d9` `89a1d123` `df1ae7dd` +11 | H | N | Keep fork; port manually only if needed |
| U081 | — | chore(core-api): optimize docker build stages — hard rule 3: changes Docker base-image tag (`node:22-alpine` → `node:26-alpine`) (`e644fe3d`) | a | EXCLUDED | Log only | `3f63d297` | L | N | Optional manual port of build-stage optimisation without tag change |
| U082 | — | feat(core-api): separate workspace installation from provider worker availability (`eadaccf6`) | a | OVERLAP | Apply | `46a01e21` `892d4c4d` `c19baf61` `ad9a5548` | M | N | Apply; confirm provider-worker availability semantics match fork tool-rollout model |
| U083 | #572 | chore: bump docker/login-action from 4 to 4.5.2 (#572) — only excluded paths (`.github/**`, pnpm files) (`1c90cedd`) | — | EXCLUDED | Log only | — | L | N | None |
| U084 | #571 | chore: bump github/codeql-action from 4 to 4.37.3 (#571) — only excluded paths (`.github/**`, pnpm files) (`1c04ca8b`) | — | EXCLUDED | Log only | — | L | N | None |
| U085 | #574 | perf(package): migrate npm to pnpm (#574) (+e859add2, 40e053c6) — pnpm migration [deps: U038, U052, U075, U080] (`d7988f37`) | cai | DEFERRED-ARCH | Skip | `46a01e21` `ff25fcb9` `b604228d` `ced848f5` +8 | H | N | See Phase 4 |
| U086 | #577 | refactor(console): rename asset group to host group (#577) — requires skipped U072 [deps: U072] (`35740b7f`) | c | DEPENDENT | Skip | — | M | N | Revisit if prerequisites adopted |
| U087 | #578 | feat(asset-group): asset group automation — workflow schedules, statistics & creation wizard (#578) — conflicts with fork changes in: `console/sw.js`, `core-api/src/database/database.module.ts`, `core-api/src/modules/asset-group/asset-group.controller.ts`, `co (`e63ec9b3`) | cai | CONFLICT | Skip | `ee0c1d4a` `18c17f93` `e77fd541` `ad9a5548` +2 | H | N | Keep fork; port manually only if needed |
| U088 | #595 | fix(console): resolve login race condition and match input height to button (#595) — requires skipped U001 [deps: U001] (`e7b46b83`) | c | DEPENDENT | Skip | `f4bfb619` `b81aef1c` | M | Y — login race fix | Revisit if prerequisites adopted |
| U089 | #596 | feat(core-api): slim job payloads and tenant scope (#596) — conflicts with fork changes in: `console/src/pages/jobs-registry/jobs-registry.tsx`, `core-api/src/modules/jobs-registry/jobs-registry.controller.ts`, `core-api/src/modules/jobs-registry/processors/jo (`135d3131`) | cai | CONFLICT | Skip | `89a1d123` `f3236b84` `40fa3f36` `ee0c1d4a` +9 | H | Y — derives `workspaceId` from auth context in `getManyJobs` (fork already does this: `@WorkspaceId()` + `@WorkspacePolicy`) | Fork already scopes jobs by auth workspace; consider porting result-file cleanup separately |
| U090 | #597 | feat(jobs-registry): surface cancelled/skipped status and fix list pagination (#597) — requires skipped U087, U089 [deps: U087, U089] (`ab4e7776`) | cai | DEPENDENT | Skip | `46a01e21` `ff25fcb9` `bcbc2095` `892d4c4d` +37 | M | N | Revisit if prerequisites adopted |
| U091 | — | chore(console): remove sw.js artifacts from source root — requires skipped U087 [deps: U087] (`aec7a259`) | ci | DEPENDENT | Skip | `c19baf61` `ee0c1d4a` `18c17f93` `e77fd541` +2 | M | N | Revisit if prerequisites adopted |
| U092 | #599 | feat(console): new dashboard with asset insights, filtering and date fixes (#599) — conflicts with fork changes in: `console/src/pages/dashboard/components/asset-trends.tsx` [deps: U022, U087, U090] (`99c27be3`) | cai | CONFLICT | Skip | `f4bfb619` | M | N | Keep fork; port manually only if needed |
| U093 | #602 | feat(workspaces): granular permissions and member invitations (#602) — conflicts with fork changes in: `console/src/__tests__/pages/settings.test.tsx`, `console/src/pages/admin/user-detail-sheet.tsx`, `console/src/pages/reports/reports.tsx`, `console/src/pages (`451ec99e`) | cai | CONFLICT | Skip | `3d0169e7` `46a01e21` `b604228d` `89a1d123` +10 | H | Y — granular workspace permissions + invitations | Keep fork RelationalWorkspaceRoles; cherry-pick ideas (invitations) manually |
| U094 | #598 | fix(core-api): correct status for empty job histories (#598) — requires skipped U087, U090, U093 [deps: U087, U090, U093] (`905301b2`) | cai | DEPENDENT | Skip | `46a01e21` `ff25fcb9` `bcbc2095` `892d4c4d` +34 | M | N | Revisit if prerequisites adopted |
| U095 | #605 | feat(integrations): cloudflare  provider connectors with periodic sync scheduling and console management UI (#605) — conflicts with fork changes in: `console/src/__tests__/pages/targets.test.tsx`, `core-api/src/modules/data-adapter/data-adapter.service.spec.ts (`ea3ca6a5`) | cai | CONFLICT | Skip | `3d0169e7` `e93521d9` `df1ae7dd` `f3236b84` +7 | H | Y — Cloudflare credentials storage/sync | Keep fork; port manually only if needed |
| U096 | #606 | feat(console): add search filters and navigation to members settings (#606) — requires skipped U093 [deps: U093] (`856f050b`) | c | DEPENDENT | Skip | — | M | N | Revisit if prerequisites adopted |
| U097 | #607 | feat(audit-log): workspace audit log with decorator wiring and console UI (#607) — conflicts with fork changes in: `core-api/example.env`, `core-api/src/modules/internal-networks/internal-networks.controller.ts`, `core-api/src/modules/targets/targets.service.t (`06ec3c25`) | cai | CONFLICT | Skip | `ff25fcb9` `bcbc2095` `ced848f5` `614736d4` +10 | H | Y — workspace audit log | Keep fork; port manually only if needed |
| U098 | — | ci(release): use GitHub native auto-generated release notes via softprops — only excluded paths (`.github/**`, pnpm files) (`4da70aff`) | — | EXCLUDED | Log only | — | L | N | None |
| U099 | #608 | feat(assets): add asset topology graph view and API (#608) — conflicts with fork changes in: `console/src/pages/assets/list-assets.tsx` [deps: U087, U092, U093, U097] (`8a1264e0`) | cai | CONFLICT | Skip | `b604228d` `929979b9` `b81aef1c` | M | N | Keep fork; port manually only if needed |
| U100 | #610 | refactor(console): rework splash and session flow (#610) — requires skipped U093 [deps: U093] (`73fe9b55`) | c | DEPENDENT | Skip | `f4bfb619` `b81aef1c` | M | Y — session/splash flow | Revisit if prerequisites adopted |
| U101 | #611 | feat(console): polish workspace switcher and sidebar (#611) — requires skipped U096, U099, U100 [deps: U096, U099, U100] (`273844f9`) | c | DEPENDENT | Skip | `f4bfb619` `b81aef1c` | M | N | Revisit if prerequisites adopted |
| U102 | #615 | Merge pull request #615 from oasm-platform/feat/mcp-connect-client-selector — requires skipped U074 [deps: U074] (`0179331e`) | c | DEPENDENT | Skip | `f4bfb619` | M | N | Revisit if prerequisites adopted |
| U103 | #616 | fix(console): warm workspace/current-permission at root for direct settings nav (#616) — U093 (#602) — imports `@/hooks/usePermission`, which only exists after upstream #602 (granular permissions) (`22f67576`) | c | DEPENDENT | Skip | — | M | N | Revisit only if #602 is adopted |
| U104 | #617 | refactor(worker): inline gRPC client (#617) — conflicts with fork changes in: `grpc-client/go/go.mod`, `grpc-client/ts/workers.client.ts`, `grpc-client/ts/workers.ts`, `worker/internal/gen/go.sum` [deps: U053, U080, U087] (`55843eea`) | giw | CONFLICT | Skip | `46a01e21` `18c17f93` `dddeb62e` `ad9a5548` +1 | H | Y — replaces shared gRPC client package | Prerequisite for connector model; assess with Phase 4 |
| U105 | #557 | chore: bump google.golang.org/grpc from 1.80.0 to 1.82.1 in /worker (#557) — requires skipped U104 [deps: U104] (`c93d3758`) | w | DEPENDENT | Skip | `dddeb62e` `ad9a5548` `f6456a4b` | M | N | Revisit if prerequisites adopted |
| U106 | #619 | chore: bump github/codeql-action from 4.37.3 to 4.37.8 (#619) — only excluded paths (`.github/**`, pnpm files) (`29f8a2df`) | — | EXCLUDED | Log only | — | L | N | None |
| U107 | #609 | chore: bump nanoid from 3.3.15 to 3.3.18 (#609) (`c496fbf6`) | a | OVERLAP | Apply | `b604228d` `a2708df6` `dddeb62e` | M | Y — nanoid bump | Apply; review overlap |
| U108 | #586 | chore: bump @playwright/test from 1.62.0 to 1.62.1 (#586) (`5588c10d`) | c | OVERLAP | Apply | `dddeb62e` | M | N | Apply; review overlap |
| U109 | #627 | chore: bump google.golang.org/grpc from 1.82.1 to 1.83.1 in /worker (#627) — requires skipped U105 [deps: U105] (`d23ea6fd`) | w | DEPENDENT | Skip | `dddeb62e` `ad9a5548` `f6456a4b` | M | N | Revisit if prerequisites adopted |
| U110 | #625 | chore: bump the react group across 3 directories with 2 updates (#625) (`6371c621`) | ca | OVERLAP | Apply | `b604228d` `a2708df6` `dddeb62e` | M | N | Apply; review overlap |
| U111 | #621 | feat(worker): node Docker runtime with connector dispatch and pooling (#621) — connector model [deps: U001, U052, U053, U072] (`df318bb0`) | caiw | DEFERRED-ARCH | Skip | `09b38792` `35dda720` `46a01e21` `ff25fcb9` +30 | H | Y — Docker runtime, per-execution tokens, mTLS, encrypted config profiles | See Phase 4 |
| U112 | #635 | refactor(core-api): drop connector tests, preserve masked secrets (#635) — connector model [deps: U111] (`14ac931c`) | aw | DEFERRED-ARCH | Skip | `f3236b84` `ef133f6d` `8511c9f9` `5608b815` +14 | M | Y — masked-secret preservation | See Phase 4 |
| U113 | #634 | feat(integration): add AWS integration features and improve core API structure (#634) — requires skipped U052, U095, U097, U111 [deps: U052, U095, U097, U111] (`86ecb20a`) | cai | DEPENDENT | Skip | `46a01e21` `ff25fcb9` `bcbc2095` `892d4c4d` +25 | H | Y — AWS credentials | Revisit if prerequisites adopted |
| U114 | #639 | feat(tools): support urls discovery tool (#639) — connector model [deps: U080, U095, U099, U104] (`3be3279b`) | caiw | DEFERRED-ARCH | Skip | `f7e0d50b` | H | N | See Phase 4 |
| U115 | — | docs(readme): add connector architecture section and drop tech stack notes from README — connector model [deps: U071] (`f4b6443a`) | i | DEFERRED-ARCH | Skip | `1148a294` `97a6abfa` `ff25fcb9` `bcbc2095` +3 | H | N | See Phase 4 |
| U116 | #640 | feat(console): add worker detail page with graph (#640) — conflicts with fork changes in: `core-api/src/modules/workers/dto/workers.dto.ts` [deps: U052, U093, U101, U111] (`16bc9d83`) | cai | CONFLICT | Skip | `46a01e21` `18c17f93` `ad9a5548` `f6456a4b` | M | N | Keep fork; port manually only if needed |
| U117 | #642 | fix(core-api): store vulnerability severity in lowercase (#642) — requires skipped U114 [deps: U114] (`240bb90f`) | a | DEPENDENT | Skip | `3d0169e7` `e93521d9` `89a1d123` `df1ae7dd` +10 | M | Y — data normalisation migration on `vulnerabilities` | Port with U114 if connector model adopted; otherwise consider normalising severity case in fork |
| U118 | #643 | fix(worker): forward affected_url and description from findings (#643) — connector model [deps: U111, U114] (`eea88fb9`) | aw | DEFERRED-ARCH | Skip | `09b38792` `c19baf61` `e93521d9` `df1ae7dd` +10 | H | N | See Phase 4 |
| U119 | #644 | feat(worker): show live running jobs in worker detail graph (#644) — requires skipped U111, U116, U118 [deps: U111, U116, U118] (`7e3d54d9`) | cai | DEPENDENT | Skip | `46a01e21` `ff25fcb9` `bcbc2095` `892d4c4d` +17 | M | N | Revisit if prerequisites adopted |
| U120 | #647 | fix(console): prevent Telegram buttons from submitting forms (#647) — requires skipped U059 [deps: U059] (`fce48d21`) | c | DEPENDENT | Skip | — | M | N | Revisit if prerequisites adopted |
| U121 | #641 | feat(integration): add connect to Vercel and auto fetch domain, subdomain (#641) — requires skipped U093, U104, U113, U114, U117 [deps: U093, U104, U113, U114] (`16f483d6`) | caiw | DEPENDENT | Skip | `09b38792` `3d0169e7` `46a01e21` `ff25fcb9` +28 | M | Y — Vercel credentials | Revisit if prerequisites adopted |
| U122 | #649 | feat(connector): register nikto, keep partial connector results, tidy vulnerability pages (#649) — connector model [deps: U119, U121] (`0c2a67f8`) | caiw | DEFERRED-ARCH | Skip | `09b38792` `c19baf61` `e93521d9` `df1ae7dd` +11 | H | N | See Phase 4 |
| U123 | #650 | feat(connector): add the ports_scanner category and richer job logging (#650) — connector model [deps: U053, U080, U089, U090] (`661dcd49`) | caiw | DEFERRED-ARCH | Skip | `09b38792` `46a01e21` `ff25fcb9` `bcbc2095` +43 | H | Y — fixes scan-scope widening (ports_scanner blanked `assetIds` → whole-workspace scan) | Check fork job creation for the same assetIds-blanking bug (fork has no ports_scanner category, low likelihood) |
| U124 | #651 | fix(console): add consistent skeleton loading states to dashboard cards (#651) — conflicts with fork changes in: `console/src/pages/dashboard/components/issues-timeline.tsx`, `console/src/pages/dashboard/dashboard.tsx` [deps: U092] (`0a053eea`) | c | CONFLICT | Skip | `f4bfb619` `b81aef1c` | M | N | Keep fork; port manually only if needed |
| U125 | #652 | feat(worker): reconcile orphaned connector containers at startup (#652) — connector model [deps: U111, U123] (`93064055`) | aiw | DEFERRED-ARCH | Skip | `09b38792` `14243401` `46a01e21` `ff25fcb9` +21 | H | N | See Phase 4 |
| U126 | #653 | feat(worker): add live worker runtime telemetry (#653) — connector model [deps: U053, U104, U111, U114] (`7d14435b`) | caiw | DEFERRED-ARCH | Skip | `46a01e21` `18c17f93` `e77fd541` `dddeb62e` +3 | H | N | See Phase 4 |
| U127 | #654 | feat(console): guide users to install tools for empty groups (#654) — requires skipped U111, U114, U119, U123, U124 [deps: U111, U114, U119, U123] (`45b3eb6e`) | c | DEPENDENT | Skip | `46a01e21` `f4bfb619` `b81aef1c` | M | N | Revisit if prerequisites adopted |
| U128 | #656 | fix(core-api): preserve asset group scan scope (#656) — requires skipped U093, U123 [deps: U093, U123] (`0f2a3ae0`) | ca | DEPENDENT | Skip | `f3236b84` `ef133f6d` `8511c9f9` `5608b815` +14 | M | Y — preserves asset-group scan scope | Revisit if prerequisites adopted |
| U129 | — | docs(dev): refresh agent and developer guides, fix taskfile migration args — pnpm migration [deps: U013, U095, U104, U111] (`ce1a7841`) | ai | DEFERRED-ARCH | Skip | `1148a294` `97a6abfa` `ff25fcb9` `bcbc2095` +4 | H | N | See Phase 4 |
| U130 | #655 | fix(worker): detect docker.sock group gid for worker on Linux (#655) — connector model [deps: U125, U129] (`1230e37e`) | i | DEFERRED-ARCH | Skip | `1148a294` `97a6abfa` `ff25fcb9` `bcbc2095` +3 | H | Y — docker.sock exposure moved to a connector broker | See Phase 4 |
| U131 | #657 | fix(core-api): create missing bucket on upload 404  (#657) — conflicts with fork changes in: `core-api/src/modules/storage/storage.service.ts` [deps: U089, U114] (`eff9d165`) | a | CONFLICT | Skip | `89a1d123` | M | N | Compare with fork storage provisioning (89a1d123); port only if fork lacks 404 bucket recreation |
| U132 | #659 | chore(core-api): upgrade NestJS to v12  (#659) — requires skipped U099, U114, U126, U129 [deps: U099, U114, U126, U129] (`63051b03`) | ca | DEPENDENT | Skip | `b604228d` `a2708df6` `dddeb62e` | H | Y — NestJS 12 framework upgrade | Revisit if prerequisites adopted |
| U133 | #661 | fix(ci): run console build natively to avoid QEMU SIGILL (#661) — requires skipped U085 [deps: U085] (`c09eb058`) | c | DEPENDENT | Skip | `71c67ee5` | M | N | Revisit if prerequisites adopted |
| U134 | — | fix(core-api): chunk vulnerability upsert under the Postgres parameter cap — requires skipped U121 [deps: U121] (`03a57775`) | a | DEPENDENT | Skip | `3d0169e7` `e93521d9` `df1ae7dd` `f3236b84` +4 | M | N | Small bug fix (Postgres 65535-parameter cap); port manually into fork data-adapter |
| U135 | — | chore(connectors): sync manifest (nuclei 3.11.1, wpscan 4.1.0) (+3f58d7ad) — connector model [deps: U111, U123] (`7d143abe`) | a | DEFERRED-ARCH | Skip | `962eb6f0` | H | N | See Phase 4 |
| U136 | #662 | fix(core-api): keep vulnerabilities when a workflow is deleted (#662) (`59c237ac`) | a | MIGRATION-RISK | Skip | `ad9a5548` `f49693ec` | M | Y — FK `ON DELETE` semantics for findings (data retention) | Port manually as a fork-timestamped migration (small, low risk) |
| U137 | #663 | fix(worker): keep the job poller alive and cap connector containers by resources (#663) — connector model [deps: U111, U126, U129, U130] (`aa910428`) | iw | DEFERRED-ARCH | Skip | `46a01e21` `ff25fcb9` `c19baf61` `ced848f5` +6 | H | N | See Phase 4 |
| U138 | #664 | feat(worker): push job cancellations over a bidirectional gRPC stream (#664) — connector model [deps: U114, U123, U125, U126] (`4774db68`) | aw | DEFERRED-ARCH | Skip | `46a01e21` `18c17f93` `ad9a5548` | H | Y — new bidi worker gRPC stream | See Phase 4 |
| U139 | — | chore(ci): tag releases with task release, gin-style changelog — requires skipped U130, U137 [deps: U130, U137] (`aad31c21`) | i | DEPENDENT | Skip | `1148a294` `97a6abfa` `ff25fcb9` `bcbc2095` +4 | M | N | Revisit if prerequisites adopted |

## Planned application order

- U003 `852ecc73` — — refactor(dashboard): update grid classes for responsive layout
- U004 `3dc457c5` #458 — feat(console): add custom top progress bar for route transitions (#458)
- U006 `934ebbb4` #460 — feat(notifications): replace popover with sheet and add delete (#460) — **REGEN: conflict only in generated/lockfile (`console/src/services/apis/gen/queries.ts`); regenerate**
- U007 `7875fa25` — — style(console): update sidebar and tabs active indicator styles
- U009 `19a27574` — — feat(console): auto-update document.title from Page component
- U012 `2fece036` #464 — fix(notifications): filter notifications by workspace (#464)
- U014 `98d145aa` #478 — feat(console): auto-fill workspace name and redirect new users to discovery (#478)
- U016 `32763ee7` — — feat(routes): add create issue route and enable its component
- U020 `0395ec58` #481 — fix(worker): fix screenshot (#481)
- U024 `03c3cd3d` #483 — chore(deps): bump golang.org/x/net from 0.53.0 to 0.55.0 in /worker (#483)
- U025 `2ec5a548` #477 — Merge pull request #477 from oasm-platform/dependabot/npm_and_yarn/js-yaml-4.2.0
- U027 `a4392840` — — chore: bump tar from 7.5.15 to 7.5.19
- U028 `5251d2aa` — — chore: bump form-data from 4.0.5 to 4.0.6
- U029 `fb3161e4` — — chore: bump uuid from 13.0.0 to 14.0.1
- U030 `d0963ca7` — — chore: bump dompurify from 3.3.3 to 3.4.11
- U031 `1334e25c` — — chore: bump nestjs group with 8 updates
- U032 `7c308878` — — chore: bump markdown-it from 14.1.1 to 14.3.0
- U036 `ae004800` — — chore: bump multer from 2.1.1 to 2.2.0
- U039 `fd006bdd` — — chore: bump hono from 4.12.23 to 4.12.28
- U043 `a74d331f` #341 — chore(deps): bump postcss from 8.5.8 to 8.5.15 (#341)
- U044 `79cb1143` #335 — chore(deps): bump @nestjs/microservices from 11.1.17 to 11.1.19 (#335) — **REGEN: conflict only in generated/lockfile (`package-lock.json`); regenerate**
- U046 `99480c16` #324 — chore(deps): bump @nestjs/core from 11.1.17 to 11.1.18 (#324)
- U049 `0e25a58b 27273d85` #475 — chore: bump vite from 6.4.1 to 8.1.3 (#475) (+27273d85) — **REGEN: conflict only in generated/lockfile (`package-lock.json`); regenerate**
- U050 `bfdefb26` — — refactor(test): use test utility wrapper and async assertions for connect-worker-dialog
- U054 `dd7ce943` #538 — feat(console): add target switcher dropdown to detail page (#538)
- U056 `d70dc300` — — feat(console): replace screenshot hover tooltip with click-to-fullscreen modal
- U057 `ca265281` — — fix(core-api,console): fix service list sorting by using TypeORM metadata and enable screenshot sort
- U068 `9ad23690` #526, 524 — Merge branch 'main' of https://github.com/oasm-platform/open-asm
- U070 `208f73c6` — — refactor(console): restructure statistic card layout and remove card wrapper
- U078 `e20f0b7b` #560 — chore: bump fast-uri from 3.1.0 to 3.1.4 (#560)
- U082 `eadaccf6` — — feat(core-api): separate workspace installation from provider worker availability
- U107 `c496fbf6` #609 — chore: bump nanoid from 3.3.15 to 3.3.18 (#609)
- U108 `5588c10d` #586 — chore: bump @playwright/test from 1.62.0 to 1.62.1 (#586)
- U110 `6371c621` #625 — chore: bump the react group across 3 directories with 2 updates (#625)

## Conflict details

Covers every CONFLICT, SEMANTIC-CONFLICT and MIGRATION-RISK unit. Conflict types come from `git merge-tree` against `origin/dev`. Default resolution options for all: **(a)** keep the fork version (current plan); **(b)** port the upstream intent by hand onto fork code in a fork-authored commit; **(c)** adopt upstream and re-apply the fork change on top (only sensible as part of a broader re-base on upstream).

### U001 — fix(console): prevent premature 401 redirect on initial page load (#456) (#456; `79fe5ca9`)

- **Files involved (fork-conflicting):** `console/src/pages/tools/components/marketplace.tsx`
- **Conflict types:** console/src/pages/tools/components/marketplace.tsx: content
- **What the fork did:** 46a01e21 Add managed tool update rollout support; f4bfb619 Fix tools page on startup
- **What upstream did:** Add sessionLoaded guard to skip 401 handling until session is fetched. Skip router.invalidate() on first session load to avoid stale-context re-resolution that flashes /login. Simplify marketplace tools query. Summary by CodeRabbit * Bug Fixes * Fixed premature redirects to login page during session initialization * Improved marketplace tool loading behavior
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** Fork rewrote marketplace page; port 401-redirect fix manually if the bug reproduces

### U002 — refactor(assets): remove isErrorPage filter from asset queries (direct; `14208ea7`)

- **Files involved (fork-conflicting):** `core-api/src/modules/assets/assets.service.ts`, `core-api/src/modules/targets/targets.service.ts`
- **Conflict types:** core-api/src/modules/assets/assets.service.ts: content; core-api/src/modules/targets/targets.service.ts: content
- **What the fork did:** f7e0d50b feat(assets): export complete host and IP details; b604228d feat(assets): add CSV and XLSX data exports; d7657854 Ignore TLS cert errors in screenshots; count all discovered services; 2858d942 Update assets.service.ts; 69ae8ea0 Fix discovery data missing on assets page
- **What upstream did:** refactor(assets): remove isErrorPage filter from asset queries
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U005 — fix(console,core-api): align notification asset counts with detail screen and filter null status codes (#459) (#459; `045a9eba`)

- **Files involved (fork-conflicting):** `core-api/src/modules/assets/assets.service.ts`
- **Conflict types:** core-api/src/modules/assets/assets.service.ts: content
- **What the fork did:** f7e0d50b feat(assets): export complete host and IP details; b604228d feat(assets): add CSV and XLSX data exports; 2858d942 Update assets.service.ts; 69ae8ea0 Fix discovery data missing on assets page; 929979b9 subfinder and nuclei discovery fixes
- **What upstream did:** Summary by CodeRabbit * New Features * Asset status-code reporting now shows Status Code in the assets table. * Notifications for new asset detections now include services in the summary counts. * Statistics now track service counts alongside host, port, and technology metrics. * Bug Fixes * Improved status-code asset results by excluding empty or invalid entries from the list.
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U008 — fix(worker): add arm64 Docker image support via cross-compilation (#461) (#461; `db589104`)

- **Files involved (fork-conflicting):** `worker/Dockerfile`
- **Conflict types:** worker/Dockerfile: content
- **What the fork did:** 09b38792 Generalize scanner pinning and template seeding; 40fa3f36 Add nmap service discovery to gate screenshots; dddeb62e Misc fixes #1; 4b54f43a Update Dockerfile; f6456a4b UI enhancements
- **What upstream did:** Problem The worker Docker image is only published for `linux/amd64`. On Apple Silicon Macs, after oasm-platform/oasm-docker3 removed the hardcoded `platform: linux/amd64` from the compose file so the worker could run as native arm64, Docker still falls back to the amd64 image (no arm64 manifest exists), which then panics immediately under Rosetta: ``` panic: [launcher] Failed to get the debug url: The hardware on thi…
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** Fork owns worker Dockerfile/image pipeline; port arm64 cross-compile manually if needed

### U010 — feat(console): add AI-powered tag generation for assets (#462) (#462; `838481b7`)

- **Files involved (fork-conflicting):** `core-api/src/modules/assets/assets.service.spec.ts`; plus 1 file(s) that also need earlier upstream units
- **Conflict types:** core-api/src/modules/assets/assets.service.spec.ts: content
- **What the fork did:** f7e0d50b feat(assets): export complete host and IP details; b604228d feat(assets): add CSV and XLSX data exports; ad9a5548 Fix open asm items I-01 to I-04
- **What upstream did:** Summary by CodeRabbit * New Features * Added an auto-generate option when editing asset tags, with loading feedback and results merged into the existing tag list. * Asset details now show the tag editor directly for easier tag management. * Tag generation is now available through the app’s backend with workspace-aware results. * Bug Fixes * Improved tag saving and deduplication so duplicate tags are avoided. * Update…
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U011 — refactor(core-api): consolidate MCP tools into agents module with security improvements (#463) (+53b81d6e, b7981278) (#463; `ecfe5b35 53b81d6e b7981278`)

- **Files involved (fork-conflicting):** `console/src/pages/settings/settings.tsx`, `core-api/src/modules/agents/agents.tools.ts`; plus 3 file(s) that also need earlier upstream units
- **Conflict types:** console/src/pages/settings/settings.tsx: content; core-api/src/modules/agents/agents.tools.ts: content
- **What the fork did:** dddeb62e Misc fixes #1; 3f63d297 fixed worker nodes, roles, and about page; ad9a5548 Fix open asm items I-01 to I-04
- **What upstream did:** - Move tool definitions from mcp/mcp.tools.ts to modules/agents/agents.tools.ts - Remove obsolete mcp.prompt.ts and mcp.resource.ts - Change MCP API key header to x-oasm-api-key - Add session TTL eviction and capacity limit to MCP service - Add SSRF protection via DNS resolution and private IP check in web fetch tool - Replace console.log with NestJS Logger across agents tools - Fix getStatistic tool schema - Sanitiz…
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U015 — refactor(issues): comment out unused code in menu-bar, data-adapter, issues, and jobs-registry modules (direct; `40e68782`)

- **Files involved (fork-conflicting):** `core-api/src/modules/data-adapter/data-adapter.service.ts`
- **Conflict types:** core-api/src/modules/data-adapter/data-adapter.service.ts: content
- **What the fork did:** 3d0169e7 Fix workspace header and service ports; e93521d9 Improve naabu edge detection; fix screenshot name; df1ae7dd Seed web port floor and add naabu edge checks; f3236b84 Fix pipeline step state, tarpit guard, and job dispatch; 40fa3f36 Add nmap service discovery to gate screenshots
- **What upstream did:** refactor(issues): comment out unused code in menu-bar, data-adapter, issues, and jobs-registry modules
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U017 — refactor(statistic): skip unchanged records in daily cron and add distributed lock (#479) (+e04264b6) (#479; `54de2dfe e04264b6`)

- **Files involved (fork-conflicting):** `core-api/src/modules/data-adapter/data-adapter.service.spec.ts`; plus 2 file(s) that also need earlier upstream units
- **Conflict types:** core-api/src/modules/data-adapter/data-adapter.service.spec.ts: content
- **What the fork did:** 3d0169e7 Fix workspace header and service ports; e93521d9 Improve naabu edge detection; fix screenshot name; df1ae7dd Seed web port floor and add naabu edge checks; f3236b84 Fix pipeline step state, tarpit guard, and job dispatch; 40fa3f36 Add nmap service discovery to gate screenshots
- **What upstream did:** Summary by CodeRabbit * New Features * Daily statistics processing now runs with safer concurrency protection, reducing the risk of duplicate runs across multiple app instances. * Bug Fixes * Statistics are now saved only when values actually change, helping reduce unnecessary updates. * Lock handling is more reliable, improving protection against overlapping background jobs and accidental lock conflicts.
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U018 — refactor(core-api): wrap TypeORM relations with Relation<> type (#480) (#480; `5cf231ed`)

- **Files involved (fork-conflicting):** `core-api/src/modules/agents/entities/agent-conversation.entity.ts`, `core-api/src/modules/targets/entities/target.entity.ts`, `core-api/src/modules/tools/tools.service.ts`, `core-api/src/modules/workers/entities/worker.entity.ts`, `core-api/src/modules/workers/remote-execute-subscribe.service.ts`, `core-api/src/modules/workspaces/entities/workspace-members.entity.ts`; plus 1 file(s) that also need earlier upstream units
- **Conflict types:** core-api/src/modules/agents/entities/agent-conversation.entity.ts: content; core-api/src/modules/targets/entities/target.entity.ts: content; core-api/src/modules/tools/tools.service.ts: content; core-api/src/modules/workers/entities/worker.entity.ts: content; core-api/src/modules/workspaces/entities/workspace-members.entity.ts: content
- **What the fork did:** 46a01e21 Add managed tool update rollout support; 892d4c4d feat(tools): centralize scanner version information; c19baf61 feat(subfinder): enhance provider configuration and diagnostics handling; 18c17f93 Nuclei fixes and updates; e77fd541 Access and roles fix #1
- **What upstream did:** Wrap all entity relationship properties with TypeORM's Relation<> generic type to align with TypeORM 0.3+ best practices. This improves type safety by enabling lazy relation resolution and prevents circular dependency issues in entity imports. Affects all entity files across modules: agents, assets, auth, internal-networks, issues, jobs-registry, notifications, reports, statistic, targets, templates, workflows, and c…
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U019 — feat(remote-execute): add command validation and unit tests (#482) (#482; `c169ed46`)

- **Files involved (fork-conflicting):** `core-api/src/modules/remote-execute/dto/run-command.dto.ts`, `core-api/src/modules/remote-execute/remote-execute.service.ts`, `core-api/src/modules/workers/remote-execute-subscribe.service.ts`
- **What the fork did:** ad9a5548 Fix open asm items I-01 to I-04
- **What upstream did:** Summary by CodeRabbit * Bug Fixes * Prevented empty commands from being submitted. * Improved remote command execution reliability by handling streaming results more safely, including timeouts, disconnects, and unexpected message formats. * Fixed a race condition so command results are less likely to be missed when streaming begins. * Added better cleanup when a command times out or a worker becomes unavailable. * St…
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** Fork removed remote execution; no action unless re-enabled

### U022 — refactor(workspaces): remove workspace_targets and link target directly to workspace (#484) (#484; `a5649040`)

- **Files involved (fork-conflicting):** `console/src/pages/targets/setting-target.tsx`, `console/src/services/apis/gen/queries.ts`, `core-api/src/modules/reports/services/summary-report.service.ts`, `core-api/src/modules/targets/targets.controller.ts`, `core-api/src/modules/targets/targets.service.spec.ts`, `core-api/src/modules/targets/targets.service.ts`, `core-api/src/modules/workspaces/workspaces.module.ts`, `core-api/src/modules/workspaces/workspaces.service.spec.ts`, `core-api/src/modules/workspaces/workspaces.service.ts`; plus 5 file(s) that also need earlier upstream units
- **Conflict types:** console/src/pages/targets/setting-target.tsx: content; console/src/services/apis/gen/queries.ts: content; core-api/src/modules/reports/services/summary-report.service.ts: content; core-api/src/modules/targets/targets.controller.ts: content; core-api/src/modules/targets/targets.service.spec.ts: content; core-api/src/modules/targets/targets.service.ts: content; core-api/src/modules/workspaces/workspaces.module.ts: content; core-api/src/modules/workspaces/workspaces.service.spec.ts: content
- **What the fork did:** 46a01e21 Add managed tool update rollout support; ff25fcb9 fix(auth): provision first admin privately; bcbc2095 fix(auth): replace bootstrap token entry; 892d4c4d feat(tools): centralize scanner version information; f7e0d50b feat(assets): export complete host and IP details
- **What upstream did:** Summary by CodeRabbit * New Features * Targets are now directly linked to workspaces, with uniqueness enforced per workspace for target values to prevent duplicates within the same workspace. * Bug Fixes * Improved workspace isolation across assets, jobs, reports, vulnerabilities, and statistics to prevent cross-workspace data mixing. * Workspace-scoped target operations (including CSV export) now stay correctly cons…
- **Why they conflict:** Upstream drops `workspace_targets` and links targets directly to workspaces; fork code (jobs-registry `getManyJobs`, targets, assets services) and fork migrations still use `workspace_targets`.
- **Resolution options:** Do not port; fork queries rely on workspace_targets (e.g. getManyJobs join)

### U026 — chore: bump axios from 1.15.2 to 1.18.1 (direct; `ce874631`)

- **Files involved (fork-conflicting):** `core-api/package.json`, `package-lock.json`
- **Conflict types:** core-api/package.json: content; package-lock.json: content
- **What the fork did:** b604228d feat(assets): add CSV and XLSX data exports; a2708df6 Pin better-auth to 1.6.13 to fix non-deterministic Docker build; dddeb62e Misc fixes #1
- **What upstream did:** chore: bump axios from 1.15.2 to 1.18.1
- **Why they conflict:** Fork pins/changes core-api `axios`; upstream bumps it — `package.json` conflict.
- **Resolution options:** Bump axios manually in fork (fork pins core-api axios)

### U051 — refactor(worker): update headless browser init and improve screenshot rendering (direct; `7613114a`)

- **Files involved (fork-conflicting):** `worker/internal/worker/client.go`
- **Conflict types:** worker/internal/worker/client.go: content
- **What the fork did:** 14243401 Report scanner health loop for workers; 46a01e21 Add managed tool update rollout support; d7657854 Ignore TLS cert errors in screenshots; count all discovered services; 18c17f93 Nuclei fixes and updates; dddeb62e Misc fixes #1
- **What upstream did:** refactor(worker): update headless browser init and improve screenshot rendering
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** Fork owns screenshot/browser init; review ideas only

### U053 — feat(worker): design tui for worker (#517) (+cf7b04dc) (#517; `635b1ec2 cf7b04dc`)

- **Files involved (fork-conflicting):** `worker/internal/worker/job.go`, `worker/internal/worker/remote_execute.go`; plus 4 file(s) that also need earlier upstream units
- **Conflict types:** worker/internal/worker/job.go: content
- **What the fork did:** 09b38792 Generalize scanner pinning and template seeding; c19baf61 feat(subfinder): enhance provider configuration and diagnostics handling; e93521d9 Improve naabu edge detection; fix screenshot name; df1ae7dd Seed web port floor and add naabu edge checks; 5608b815 Reduce naabu rate; nmap + pipeline fixes
- **What upstream did:** Summary by CodeRabbit * New Features * Replaced the worker startup flow with an interactive terminal dashboard showing live sessions and jobs, selectable job output, activity feed, connection details, and a key-help status bar. * Added live system metrics (CPU/memory, goroutines, heap) with visual indicators and responsive layout. * Bug Fixes * Improved runtime synchronization by routing job/session/activity/output/e…
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** Worker TUI is upstream UX; fork worker is heavily customised — do not port

### U055 — refactor(core-api): convert entity enum columns to varchar type (#539) (#539; `9526f196`)

- **Files involved (fork-conflicting):** `core-api/src/modules/workspaces/entities/workspace-members.entity.ts`; plus 5 file(s) that also need earlier upstream units
- **Conflict types:** core-api/src/modules/workspaces/entities/workspace-members.entity.ts: content
- **What the fork did:** e77fd541 Access and roles fix #1; 3f63d297 fixed worker nodes, roles, and about page; ad9a5548 Fix open asm items I-01 to I-04
- **What upstream did:** Replace all PostgreSQL enum column types with varchar across 19 entities to reduce coupling to specific DB features. Fix migration to use ALTER COLUMN TYPE (safe in-place) instead of DROP/ADD COLUMN to preserve existing data and constraints. Summary by CodeRabbit * Bug Fixes * Improved database compatibility and upgrade reliability for status, role, type, priority, and scheduling values across core features. * Preser…
- **Why they conflict:** Upstream converts every Postgres enum column to varchar; fork migrations `ExpandWorkspaceRoles`, `RelationalWorkspaceRoles` and `AddAssetServiceDiscoveryColumns` alter/extend the same enums (`workspace_members_role_enum`, `jobs_category_enum`, `tools_category_enum`).
- **Resolution options:** Do not port as-is; fork migrations alter the same enums. Re-evaluate only if adopting upstream schema wholesale

### U058 — feat(core-api,console): add new vulnerability notifications (#541) (#541; `a4758a20`)

- **Files involved (fork-conflicting):** `core-api/src/modules/data-adapter/data-adapter.service.spec.ts`; plus 6 file(s) that also need earlier upstream units
- **Conflict types:** core-api/src/modules/data-adapter/data-adapter.service.spec.ts: content
- **What the fork did:** 3d0169e7 Fix workspace header and service ports; e93521d9 Improve naabu edge detection; fix screenshot name; df1ae7dd Seed web port floor and add naabu edge checks; f3236b84 Fix pipeline step state, tarpit guard, and job dispatch; 40fa3f36 Add nmap service discovery to gate screenshots
- **What upstream did:** Summary by CodeRabbit * New Features * Added integration editing with schema-driven fields (including toggles, arrays, and secure handling for sensitive values), with Cancel/Save and validation. * Introduced `PATCH /integrations/:id` to update integration name, description, and configuration. * Added notifications for newly found vulnerabilities (including counts) targeting the affected asset. * Bug Fixes * Updated v…
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U060 — feat(secure): level envelope encryption with key rotation (#546) (#546; `b1971b62`)

- **Files involved (fork-conflicting):** `core-api/src/modules/workspaces/workspaces.service.ts`; plus 7 file(s) that also need earlier upstream units
- **Conflict types:** core-api/src/modules/workspaces/workspaces.service.ts: content
- **What the fork did:** e77fd541 Access and roles fix #1; 3f63d297 fixed worker nodes, roles, and about page; ad9a5548 Fix open asm items I-01 to I-04
- **What upstream did:** Summary by CodeRabbit * New Features * Added workspace-scoped envelope encryption for LLM API keys, integration settings, notification connector payloads, and assets. * Introduced automatic DEK backfill and stored DEK metadata on workspaces. * Enabled encryption key rotation with versioned/indexed ciphertext, plus Telegram webhook auto-configuration and a local/dev polling fallback. * Bug Fixes * Improved consistent …
- **Why they conflict:** Upstream adds workspace DEKs (migration `1785000000000-AddWorkspaceDEK`) — **same timestamp** as fork `1785000000000-FixPendingJobPriorityIndexDirection`; fork also edits `workspaces.service.ts`.
- **Resolution options:** Port deliberately later (new migration, fork timestamp) if envelope encryption is wanted; note timestamp collision 1785000000000

### U063 — refactor(console): redesign llm connect panel and restructure agents components (#550) (#550; `621a44f9`)

- **Files involved (fork-conflicting):** `console/src/hooks/use-agent-chat.ts`, `console/src/pages/vulnerabilities/detail-vulnerability.tsx`, `core-api/src/modules/agents/agents.controller.ts`; plus 7 file(s) that also need earlier upstream units
- **Conflict types:** console/src/hooks/use-agent-chat.ts: content; console/src/pages/vulnerabilities/detail-vulnerability.tsx: content; core-api/src/modules/agents/agents.controller.ts: content
- **What the fork did:** ad9a5548 Fix open asm items I-01 to I-04; f49693ec Add vulnerability detail drilldown
- **What upstream did:** Summary by CodeRabbit * New Features * Overhauled Agents chat with conversation history, structured message/tool rendering, streaming “thinking” indicators, copy-to-clipboard, and retryable stream error UI. * Added a task progress (todo) panel plus a new provider-aware agent create/edit form with custom API endpoint support. * Enhanced LLM provider connection flow with connect dialog, expandable connection cards, mod…
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U072 — feat(workspace): add configs section and skip SUBDOMAINS jobs when asset-discovery disabled (#555) (#555; `7d9b12b5`)

- **Files involved (fork-conflicting):** `console/src/components/ui/job-status.tsx`, `console/src/pages/assets/list-assets.tsx`, `console/src/pages/jobs-registry/runs.tsx`, `console/src/pages/targets/list-targets.tsx`, `core-api/src/common/enums/enum.ts`, `core-api/src/modules/assets/assets.controller.ts`, `core-api/src/modules/assets/assets.service.spec.ts`, `core-api/src/modules/jobs-registry/dto/job-history-detail.dto.ts`, `core-api/src/modules/jobs-registry/jobs-registry.service.spec.ts`, `core-api/src/modules/jobs-registry/jobs-registry.service.ts` …(+4); plus 5 file(s) that also need earlier upstream units
- **Conflict types:** console/src/components/ui/job-status.tsx: content; console/src/pages/assets/list-assets.tsx: content; console/src/pages/jobs-registry/runs.tsx: content; console/src/pages/targets/list-targets.tsx: content; core-api/src/common/enums/enum.ts: content; core-api/src/modules/assets/assets.controller.ts: content; core-api/src/modules/assets/assets.service.spec.ts: content; core-api/src/modules/jobs-registry/dto/job-history-detail.dto.ts: content
- **What the fork did:** f7e0d50b feat(assets): export complete host and IP details; b604228d feat(assets): add CSV and XLSX data exports; f3236b84 Fix pipeline step state, tarpit guard, and job dispatch; ef133f6d Fix 500 in getManyJobs: order by computed status-rank alias, not raw CASE; 8511c9f9 Order jobs by status priority so running tasks pin to the top
- **What upstream did:** Summary by CodeRabbit - New Features - Added a Configs section to workspace settings (renamed the related heading). - Workspace API responses now include workspace member details. - Added a Start discovery button for the targets area. - Assets and host assets tables now support an Enabled toggle; job status UI supports Skipped. - Bug Fixes - Rescans can start even when assets discovery is disabled. - Workflow progres…
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U074 — refactor(console): standardize tanstack query keys (#561) (#561; `1db01212`)

- **Files involved (fork-conflicting):** `console/src/hooks/useTimelineTrend.ts`, `console/src/pages/dashboard/components/asset-trends.tsx`, `console/src/pages/dashboard/components/issues-timeline.tsx`, `console/src/pages/settings/components/api-keys-settings.tsx`, `console/src/pages/settings/components/mcp-connect.tsx`, `console/src/pages/tools/components/tool-detail.tsx`
- **Conflict types:** console/src/hooks/useTimelineTrend.ts: content; console/src/pages/dashboard/components/asset-trends.tsx: content; console/src/pages/dashboard/components/issues-timeline.tsx: content; console/src/pages/settings/components/api-keys-settings.tsx: content; console/src/pages/settings/components/mcp-connect.tsx: content; console/src/pages/tools/components/tool-detail.tsx: content
- **What the fork did:** f4bfb619 Fix tools page on startup; a9e4ff21 issues fix
- **What upstream did:** Summary by CodeRabbit * Bug Fixes * Improved dashboard statistics, issue timelines, workspace settings, API keys, configurations, and tool details when switching between workspaces. * Prevented unnecessary data requests when no workspace is selected. * Reduced the risk of displaying cached data from the wrong workspace or feature.
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U075 — feat: add better-auth openapi integration (+ab1f0cfa) (direct; `1225ad8c ab1f0cfa`)

- **Files involved (fork-conflicting):** `core-api/src/main.ts`; plus 3 file(s) that also need earlier upstream units
- **Conflict types:** core-api/src/main.ts: content
- **What the fork did:** 18c17f93 Nuclei fixes and updates; ad9a5548 Fix open asm items I-01 to I-04
- **What upstream did:** feat: add better-auth openapi integration (+ab1f0cfa)
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U076 — feat(console): enhance UI components and tool installation safety (direct; `994bbe3a`)

- **Files involved (fork-conflicting):** `console/src/pages/settings/components/get-about-project.tsx`, `console/src/pages/tools/components/tool-install-button.tsx`; plus 2 file(s) that also need earlier upstream units
- **Conflict types:** console/src/pages/settings/components/get-about-project.tsx: content; console/src/pages/tools/components/tool-install-button.tsx: content
- **What the fork did:** dddeb62e Misc fixes #1; 3f63d297 fixed worker nodes, roles, and about page
- **What upstream did:** feat(console): enhance UI components and tool installation safety
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U080 — feat(api,worker): split job result into category-scoped endpoints (#552) (#552; `31b0371e`)

- **Files involved (fork-conflicting):** `core-api/src/common/enums/enum.ts`, `core-api/src/modules/data-adapter/data-adapter.service.ts`, `core-api/src/modules/jobs-registry/dto/jobs-registry.dto.ts`, `core-api/src/modules/jobs-registry/jobs-registry.controller.ts`, `core-api/src/modules/jobs-registry/processors/job-result.processor.ts`, `core-api/src/proto/jobs_registry.proto`, `grpc-client/go/jobs_registry/jobs_registry.pb.go`, `grpc-client/go/jobs_registry/jobs_registry_grpc.pb.go`, `grpc-client/ts/jobs_registry.client.ts`, `grpc-client/ts/jobs_registry.ts` …(+1); plus 5 file(s) that also need earlier upstream units
- **Conflict types:** core-api/src/common/enums/enum.ts: content; core-api/src/modules/data-adapter/data-adapter.service.ts: content; core-api/src/modules/jobs-registry/dto/jobs-registry.dto.ts: content; core-api/src/modules/jobs-registry/jobs-registry.controller.ts: content; core-api/src/modules/jobs-registry/processors/job-result.processor.ts: content; core-api/src/proto/jobs_registry.proto: content; grpc-client/go/jobs_registry/jobs_registry.pb.go: content; grpc-client/go/jobs_registry/jobs_registry_grpc.pb.go: content
- **What the fork did:** 3d0169e7 Fix workspace header and service ports; e93521d9 Improve naabu edge detection; fix screenshot name; 89a1d123 Make storage provisioning robust and retryable; df1ae7dd Seed web port floor and add naabu edge checks; f3236b84 Fix pipeline step state, tarpit guard, and job dispatch
- **What upstream did:** Summary by CodeRabbit * New Features * Added category-scoped job result submission with dedicated HTTP endpoints and gRPC RPCs for subdomains, HTTP probes, ports, vulnerabilities, screenshots, classifiers, and assistants. * Job handling now includes category context to group results more precisely. * Bug Fixes * Improved categorized result/error delivery, including reliable screenshot payload handling. * Documentatio…
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U087 — feat(asset-group): asset group automation — workflow schedules, statistics & creation wizard (#578) (#578; `e63ec9b3`)

- **Files involved (fork-conflicting):** `console/sw.js`, `core-api/src/database/database.module.ts`, `core-api/src/modules/asset-group/asset-group.controller.ts`, `core-api/src/modules/asset-group/asset-group.service.ts`; plus 16 file(s) that also need earlier upstream units
- **Conflict types:** console/sw.js: content; core-api/src/database/database.module.ts: content; core-api/src/modules/asset-group/asset-group.controller.ts: content; core-api/src/modules/asset-group/asset-group.service.ts: content
- **What the fork did:** ee0c1d4a Naabu fixes; 18c17f93 Nuclei fixes and updates; e77fd541 Access and roles fix #1; ad9a5548 Fix open asm items I-01 to I-04; 962eb6f0 update vulnerability filter count
- **What upstream did:** Summary Enhance asset group automation: per-group workflow scheduling with arbitrary cron support, last-run info, statistics, and a multi-step creation wizard in console. Highlights - core-api: allow arbitrary cron schedules for workflows; disable-schedule & improved deletion logic; handle orphaned asset group workflows; add last-run + statistics endpoints (`452420bf`, `ae5c8e70`, `73bb81cc`, `bd021ad2`) - console: c…
- **Why they conflict:** Upstream adds workflow schedules/asset-group automation touching `database.module.ts` and removes `console/sw.js`; fork edited both (SW revalidation, DB module).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U089 — feat(core-api): slim job payloads and tenant scope (#596) (#596; `135d3131`)

- **Files involved (fork-conflicting):** `console/src/pages/jobs-registry/jobs-registry.tsx`, `core-api/src/modules/jobs-registry/jobs-registry.controller.ts`, `core-api/src/modules/jobs-registry/processors/job-result.processor.spec.ts`, `core-api/src/modules/jobs-registry/processors/job-result.processor.ts`, `core-api/src/modules/storage/storage.service.spec.ts`; plus 9 file(s) that also need earlier upstream units
- **Conflict types:** console/src/pages/jobs-registry/jobs-registry.tsx: content; core-api/src/modules/jobs-registry/jobs-registry.controller.ts: content; core-api/src/modules/jobs-registry/processors/job-result.processor.spec.ts: add/add; core-api/src/modules/jobs-registry/processors/job-result.processor.ts: content; core-api/src/modules/storage/storage.service.spec.ts: add/add
- **What the fork did:** 89a1d123 Make storage provisioning robust and retryable; f3236b84 Fix pipeline step state, tarpit guard, and job dispatch; 40fa3f36 Add nmap service discovery to gate screenshots; ee0c1d4a Naabu fixes; 18c17f93 Nuclei fixes and updates
- **What upstream did:** - getManyJobs now derives workspaceId from auth context instead of the client-supplied query param, closing a cross-tenant read hole - hydrate tool (id/name/logoUrl) and asset (id/value/targetId) selects instead of full entities; drop correlated subqueries from job history counts in favor of FILTER aggregates - whitelist sortBy columns with createdAt fallback and add job.id tiebreaker for stable pagination - JobResul…
- **Why they conflict:** Fork rewrote `getManyJobs` (status-rank ordering via `addSelect` alias, auth-derived workspace scope); upstream rewrote the same method for slim payloads.
- **Resolution options:** Fork already scopes jobs by auth workspace; consider porting result-file cleanup separately

### U092 — feat(console): new dashboard with asset insights, filtering and date fixes (#599) (#599; `99c27be3`)

- **Files involved (fork-conflicting):** `console/src/pages/dashboard/components/asset-trends.tsx`; plus 6 file(s) that also need earlier upstream units
- **Conflict types:** console/src/pages/dashboard/components/asset-trends.tsx: content
- **What the fork did:** f4bfb619 Fix tools page on startup
- **What upstream did:** Summary by CodeRabbit * New Features * Added dashboard views for recent assets, top exposed ports, and top technologies. * Added interactive filtering from dashboard results to matching assets. * Host assets now display creation dates and support creation-date sorting. * Improvements * Updated vulnerability insights with a streamlined, scrollable card layout and severity indicators. * Refined dashboard headings and r…
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U093 — feat(workspaces): granular permissions and member invitations (#602) (#602; `451ec99e`)

- **Files involved (fork-conflicting):** `console/src/__tests__/pages/settings.test.tsx`, `console/src/pages/admin/user-detail-sheet.tsx`, `console/src/pages/reports/reports.tsx`, `console/src/pages/targets/add-target.tsx`, `console/src/pages/workers/list-workers.tsx`, `console/src/pages/workspaces/index.tsx`, `core-api/src/common/decorators/workspace-id.decorator.spec.ts`, `core-api/src/common/decorators/workspace-id.decorator.ts`, `core-api/src/modules/asset-group/asset-group.controller.ts`, `core-api/src/modules/assets/assets.controller.spec.ts` …(+10); plus 39 file(s) that also need earlier upstream units
- **Conflict types:** console/src/__tests__/pages/settings.test.tsx: content; console/src/pages/admin/user-detail-sheet.tsx: content; console/src/pages/reports/reports.tsx: content; console/src/pages/targets/add-target.tsx: content; console/src/pages/workers/list-workers.tsx: content; console/src/pages/workspaces/index.tsx: content; core-api/src/common/decorators/workspace-id.decorator.spec.ts: add/add; core-api/src/common/decorators/workspace-id.decorator.ts: content
- **What the fork did:** 3d0169e7 Fix workspace header and service ports; 46a01e21 Add managed tool update rollout support; b604228d feat(assets): add CSV and XLSX data exports; 89a1d123 Make storage provisioning robust and retryable; 18c17f93 Nuclei fixes and updates
- **What upstream did:** feat(workspaces): granular permissions and member invitations (#602)
- **Why they conflict:** Upstream replaces `workspace_members.role` with permission groups/invitations (5 migrations); the fork already replaced roles with its own `workspace_roles`/`workspace_role_permissions` model and `RelationalWorkspaceRoles` migration. Two incompatible authorization models.
- **Resolution options:** Keep fork RelationalWorkspaceRoles; cherry-pick ideas (invitations) manually

### U095 — feat(integrations): cloudflare  provider connectors with periodic sync scheduling and console management UI (#605) (#605; `ea3ca6a5`)

- **Files involved (fork-conflicting):** `console/src/__tests__/pages/targets.test.tsx`, `core-api/src/modules/data-adapter/data-adapter.service.spec.ts`, `core-api/src/modules/internal-networks/internal-networks.service.spec.ts`, `core-api/src/modules/internal-networks/internal-networks.service.ts`; plus 23 file(s) that also need earlier upstream units
- **Conflict types:** console/src/__tests__/pages/targets.test.tsx: content; core-api/src/modules/data-adapter/data-adapter.service.spec.ts: content; core-api/src/modules/internal-networks/internal-networks.service.spec.ts: content; core-api/src/modules/internal-networks/internal-networks.service.ts: content
- **What the fork did:** 3d0169e7 Fix workspace header and service ports; e93521d9 Improve naabu edge detection; fix screenshot name; df1ae7dd Seed web port floor and add naabu edge checks; f3236b84 Fix pipeline step state, tarpit guard, and job dispatch; 40fa3f36 Add nmap service discovery to gate screenshots
- **What upstream did:** feat(integrations): cloudflare  provider connectors with periodic sync scheduling and console management UI (#605)
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U097 — feat(audit-log): workspace audit log with decorator wiring and console UI (#607) (#607; `06ec3c25`)

- **Files involved (fork-conflicting):** `core-api/example.env`, `core-api/src/modules/internal-networks/internal-networks.controller.ts`, `core-api/src/modules/targets/targets.service.ts`; plus 21 file(s) that also need earlier upstream units
- **Conflict types:** core-api/example.env: content; core-api/src/modules/internal-networks/internal-networks.controller.ts: content; core-api/src/modules/targets/targets.service.ts: content
- **What the fork did:** ff25fcb9 fix(auth): provision first admin privately; bcbc2095 fix(auth): replace bootstrap token entry; ced848f5 fix(api): harden Compose state services; 614736d4 fix(api): secure first-admin bootstrap; d7657854 Ignore TLS cert errors in screenshots; count all discovered services
- **What upstream did:** Summary Workspace-scoped audit log: every authenticated member action on a workspace is recorded in an append-only `audit_events` table and viewable via API + Console (Settings → Audit log). v1 scope: only real session + workspace interactions are logged (no API-key/system/auth events yet — schema ready, deferred to v2). What's included Backend (core-api) - Migration `1786800000000-CreateAuditEvents`: `audit_events` …
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U099 — feat(assets): add asset topology graph view and API (#608) (#608; `8a1264e0`)

- **Files involved (fork-conflicting):** `console/src/pages/assets/list-assets.tsx`; plus 7 file(s) that also need earlier upstream units
- **Conflict types:** console/src/pages/assets/list-assets.tsx: content
- **What the fork did:** b604228d feat(assets): add CSV and XLSX data exports; 929979b9 subfinder and nuclei discovery fixes; b81aef1c fix(performance): performance updates
- **What upstream did:** feat(assets): add asset topology graph view and API (#608)
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U104 — refactor(worker): inline gRPC client (#617) (#617; `55843eea`)

- **Files involved (fork-conflicting):** `grpc-client/go/go.mod`, `grpc-client/ts/workers.client.ts`, `grpc-client/ts/workers.ts`, `worker/internal/gen/go.sum`; plus 10 file(s) that also need earlier upstream units
- **What the fork did:** 46a01e21 Add managed tool update rollout support; 18c17f93 Nuclei fixes and updates; dddeb62e Misc fixes #1; ad9a5548 Fix open asm items I-01 to I-04; f6456a4b UI enhancements
- **What upstream did:** refactor(worker): inline gRPC client (#617)
- **Why they conflict:** Upstream deletes `grpc-client/` (moving Go stubs into `worker/internal/gen`); the fork modified and depends on `grpc-client/` (regenerated stubs, `go.sum`).
- **Resolution options:** Prerequisite for connector model; assess with Phase 4

### U116 — feat(console): add worker detail page with graph (#640) (#640; `16bc9d83`)

- **Files involved (fork-conflicting):** `core-api/src/modules/workers/dto/workers.dto.ts`; plus 11 file(s) that also need earlier upstream units
- **Conflict types:** core-api/src/modules/workers/dto/workers.dto.ts: content
- **What the fork did:** 46a01e21 Add managed tool update rollout support; 18c17f93 Nuclei fixes and updates; ad9a5548 Fix open asm items I-01 to I-04; f6456a4b UI enhancements
- **What upstream did:** Backend: add GET /workers/:id returning the worker's info plus the connected tools (built-ins, and connectors only for node-mode workers). Computed fields (isOnline, currentJobsCount, toolsCount) are derived the same way as the list endpoint; the worker token is never serialized. Cloud workers stay readable since the workspace check tolerates a null workspaceId. GET /workers now returns toolsCount instead of the full…
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U124 — fix(console): add consistent skeleton loading states to dashboard cards (#651) (#651; `0a053eea`)

- **Files involved (fork-conflicting):** `console/src/pages/dashboard/components/issues-timeline.tsx`, `console/src/pages/dashboard/dashboard.tsx`; plus 5 file(s) that also need earlier upstream units
- **Conflict types:** console/src/pages/dashboard/components/issues-timeline.tsx: content; console/src/pages/dashboard/dashboard.tsx: content
- **What the fork did:** f4bfb619 Fix tools page on startup; b81aef1c fix(performance): performance updates
- **What upstream did:** fix(console): add consistent skeleton loading states to dashboard cards (#651)
- **Why they conflict:** Both sides edited overlapping hunks in fork-modified file(s); applying would require rewriting fork-authored lines (hard rule 1).
- **Resolution options:** default (a); (b) if the upstream fix is wanted

### U131 — fix(core-api): create missing bucket on upload 404  (#657) (#657; `eff9d165`)

- **Files involved (fork-conflicting):** `core-api/src/modules/storage/storage.service.ts`; plus 2 file(s) that also need earlier upstream units
- **Conflict types:** core-api/src/modules/storage/storage.service.ts: content
- **What the fork did:** 89a1d123 Make storage provisioning robust and retryable
- **What upstream did:** fix(core-api): create missing bucket on upload 404  (#657)
- **Why they conflict:** Both sides changed storage bucket provisioning (`storage.service.ts`): fork `89a1d123` made provisioning robust/retryable; upstream recreates a missing bucket on 404.
- **Resolution options:** Compare with fork storage provisioning (89a1d123); port only if fork lacks 404 bucket recreation

### U136 — fix(core-api): keep vulnerabilities when a workflow is deleted (#662) (#662; `59c237ac`)

- **Files involved (fork-conflicting):** `core-api/src/modules/vulnerabilities/entities/vulnerability.entity.ts`
- **What the fork did:** ad9a5548 Fix open asm items I-01 to I-04; f49693ec Add vulnerability detail drilldown
- **What upstream did:** Problem Removing the last tool from an asset-group pipeline also deleted every vulnerability that group had ever found. Root cause is a full hard-delete chain: - `console` treats an empty pipeline as "delete the workflow" — `asset-group-workflow.tsx` `persistPipeline()` calls `DELETE /workflows/:id` when `jobs.length === 0`. - `vulnerabilities.jobHistoryId -> job_histories.id` was `ON DELETE CASCADE`. - `job_historie…
- **Why they conflict:** Adds a migration on `vulnerabilities`, a table the fork migration `1782400000000-AddVulnerabilityEvidence` also changes (MIGRATION-RISK rule). The change itself (FK `ON DELETE CASCADE` → `SET NULL` on `vulnerabilities.jobHistoryId`) is independent of the fork's `evidence` column.
- **Resolution options:** Port manually as a fork-timestamped migration (small, low risk)

## Migrations

Fork migrations (all fork-authored, applied in fork deployments): `1782200000000-AddJobsIndexes`, `1782300000000-AddJobControlSchedulingConcurrency`, `1782400000000-AddVulnerabilityEvidence`, `1782500000000-ExpandWorkspaceRoles`, `1782600000000-RemoveRemoteExecutionColumns`, `1784506217000-UniqueWorkspaceMembership`, `1784600000000-RelationalWorkspaceRoles`, `1784700000000-AddWorkerScannerStatus`, `1784800000000-AddAssetDnsResolutionStatusAndJobTerminalDetails`, `1784900000000-AddAssetServiceDiscoveryColumns`, `1785000000000-FixPendingJobPriorityIndexDirection`, `1785100000000-AddHttpResponseEdgeColumns`, `1785200000000-AddToolUpdateManagement`.

Fork timestamps run `1782200000000`–`1785200000000`. Upstream timestamps interleave with them (TypeORM runs pending migrations by name, sorted by timestamp, so an older-timestamped upstream file added later would still run on existing databases, but ordering on fresh databases would differ from upstream's).

**Timestamp collision:** upstream `1785000000000-AddWorkspaceDEK` (U060) and fork `1785000000000-FixPendingJobPriorityIndexDirection` share `1785000000000`.

| Upstream migration | Unit | Unit class | Tables | Shares tables with fork migrations | Status | Order vs fork |
|---|---|---|---|---|---|---|
| `1783221179738-RemoveWorkspaceTargets` | U022 | CONFLICT | targets, workspace_targets, workspaces | targets | skipped | between fork migrations |
| `1783762199314-AddIntegrations` | U052 | DEPENDENT | agent_conversation_todos, agent_conversations, agent_mcp_configs, agent_workspace_memories, integrations, issue_comments, issues, reports, targets, tools, users, vulnerabilities, vulnerability_dismissals, workspaces | agent_conversations, targets, vulnerabilities | skipped | between fork migrations |
| `1784014752144-ConvertEnumColumnsToString` | U055 | CONFLICT | agent_conversations, agent_llm_configs, agent_mcp_configs, agent_messages, api_keys, asset_group_workflows, issue_comments, issues, job_histories, jobs, notification_recipients, notifications, reports, targets, tools, users, vulnerabilities, vulnerability_dismissals, workers, workspace_members | agent_conversations, jobs, targets, vulnerabilities, workers, workspace_members | skipped | between fork migrations |
| `1784101236391-AddTelegramConnects` | U059 | DEPENDENT | agent_mcp_configs, integrations, telegram_connects, users | — | skipped | between fork migrations |
| `1785000000000-AddWorkspaceDEK` | U060 | CONFLICT | agent_llm_configs, workspaces | — | skipped | **collides** with fork `1785000000000` |
| `1786002229271-CreateWorkspacePermissionTables` | U093 | CONFLICT | users, workspace_invitations, workspace_member_permissions, workspace_members, workspace_permissions, workspaces | workspace_members | skipped | after all fork migrations |
| `1786200000000-BackfillOwnerPermissionGroups` | U093 | CONFLICT | workspace_member_permissions, workspace_members, workspace_permissions, workspaces | workspace_members | skipped | after all fork migrations |
| `1786281025283-AddUserScopeToAgentConfigs` | U093 | CONFLICT | agent_conversations, agent_llm_configs, users, workspace_members | agent_conversations, workspace_members | skipped | after all fork migrations |
| `1786300000000-DropWorkspaceMemberRole` | U093 | CONFLICT | workspace_members | workspace_members | skipped | after all fork migrations |
| `1786500000000-AddNotificationRef` | U093 | CONFLICT | notifications | — | skipped | after all fork migrations |
| `1786400000000-AddIntegrationSyncSchedule` | U095 | CONFLICT | integrations | — | skipped | after all fork migrations |
| `1786600000000-AddIntegrationSyncScheduleIndex` | U095 | CONFLICT | integrations | — | skipped | after all fork migrations |
| `1786700000000-AddTargetSource` | U095 | CONFLICT | targets | targets | skipped | after all fork migrations |
| `1786800000000-CreateAuditEvents` | U097 | CONFLICT | audit_events, block_audit_mutation | — | skipped | after all fork migrations |
| `1786900000000-CreateToolConfigProfiles` | U111 | DEFERRED-ARCH | jobs, tool_config_profiles, tools, workspaces | jobs | skipped | after all fork migrations |
| `1787721487000-AlterWorkersAddRunMode` | U111 | DEFERRED-ARCH | workers | workers | skipped | after all fork migrations |
| `1788880791398-AddJobConfig` | U111 | DEFERRED-ARCH | jobs | jobs | skipped | after all fork migrations |
| `1788930000000-AddPerformanceIndexes` | U111 | DEFERRED-ARCH | job_histories, workflows | — | skipped | after all fork migrations |
| `1788940000000-AddUniqueConstraintAssetGroupWorkflows` | U111 | DEFERRED-ARCH | asset_group_workflows | — | skipped | after all fork migrations |
| `1788950000000-AddConfigProfileFK` | U111 | DEFERRED-ARCH | tool_config_profiles | — | skipped | after all fork migrations |
| `1789372002292-AddDiscoveredUrls` | U114 | DEFERRED-ARCH | asset_services, discovered_urls, job_histories | asset_services | skipped | after all fork migrations |
| `1789827249065-NormalizeVulnerabilitySeverityCase` | U117 | DEPENDENT | vulnerabilities | vulnerabilities | skipped | after all fork migrations |
| `1790663607145-VulnerabilitySurvivesWorkflowDelete` | U136 | MIGRATION-RISK | job_histories, vulnerabilities | vulnerabilities | skipped | after all fork migrations |

## Dependencies

_Planned (Phase 3 records the actual resolved versions)._ Manifest-level changes in units planned for application:

| Unit | Package(s) | Where | Change |
|---|---|---|---|
| U024 (#483) | `golang.org/x/net`, `x/sys`, `x/text` (indirect) | `worker/go.mod` | 0.53.0→0.55.0, 0.43.0→0.45.0, 0.36.0→0.37.0 |
| U025 (#477) | `js-yaml` | root/core-api `package.json` | ^4.1.1 → ^4.2.0 |
| U027 | `tar` (transitive) | lockfile | 7.5.15 → 7.5.19 |
| U028 | `form-data` (transitive) | lockfile | 4.0.5 → 4.0.6 |
| U029 | `uuid` | `console/package.json` | ^13.0.0 → ^14.0.1 (major) |
| U030 | `dompurify` (transitive) | lockfile | 3.3.3 → 3.4.11 |
| U031 | `@nestjs/{common,core,microservices,platform-express,testing}` ^11.1.9→^11.1.27, `@nestjs/swagger` ^11.2.3→^11.4.5, `@nestjs/typeorm` ^11.0.0→^11.0.3, `@nestjs/cli` ^11.0.14→^11.0.23 | `core-api/package.json` | minor/patch |
| U032 | `markdown-it` (transitive) | lockfile | 14.1.1 → 14.3.0 |
| U036 | `multer` | `core-api/package.json` | ^2.1.1 → ^2.2.0 |
| U039 | `hono` (transitive) | lockfile | 4.12.23 → 4.12.28 |
| U043 (#341) | `postcss` (transitive) | lockfile | 8.5.8 → 8.5.15 |
| U044 (#335) | `@nestjs/microservices` (lockfile) | lockfile | 11.1.17 → 11.1.19 (lockfile conflict → regenerate) |
| U046 (#324) | `@nestjs/core` (lockfile) | lockfile | 11.1.17 → 11.1.18 |
| U049 (#475) | `vite` ^6.4.1 → ^8.1.3; add optional `@rollup/rollup-linux-x64-gnu` ^4.60.0 | `console/package.json` | **major** (lockfile → regenerate) |
| U068 (#526) | `@types/react` ^19.2.0→^19.2.17, `@types/react-leaflet` ^2.8.3→^3.0.0 | console/core-api `package.json` | types only |
| U078 (#560) | `fast-uri` (transitive) | lockfile | 3.1.0 → 3.1.4 |
| U107 (#609) | `nanoid` | `package.json` | ^3.3.8 → ^3.3.18 |
| U108 (#586) | `@playwright/test` | `console/package.json` | ^1.60.0 → ^1.62.1 |
| U110 (#625) | `@types/react` ^19.2.18, `@types/react-dom` ^19.2.5 | `package.json`s | types only |

**Lockfile handling plan.** Several upstream lockfile hunks are dependabot churn that also *removes* other-platform optional binaries (e.g. U044 drops `@esbuild/linux-x64`, `@napi-rs/*`). For every unit that touches a `package.json` or `package-lock.json` (U107, U108, U110 change only `package.json` here because upstream had moved to `pnpm-lock.yaml`, which is excluded) I will run `npm install --package-lock-only --ignore-scripts` after applying, fold any normalisation into that unit's commit (logged as REGENERATED), and confirm that no `linux-*`/`darwin-*` optional entries present at baseline disappear. Note: Docker images do not use the root lockfile (`core-api/Dockerfile` runs `npm install` from `core-api/package*.json`), so lockfile-only bumps affect local/CI installs, while `package.json` changes reach images.

## Excluded-path changes

Dropped from units planned for application:

- U068 (`9ad23690`): `.github/workflows/build-nightly.yml`, `.github/workflows/build-release.yml`, `.github/workflows/check-build.yml`, `.github/workflows/check-lint.yml`, `.github/workflows/check-test.yml`, `.github/workflows/frontend-tests.yml`, `.github/workflows/worker-ci.yml`, `console/pnpm-lock.yaml`
- U107 (`c496fbf6`): `pnpm-lock.yaml`
- U108 (`5588c10d`): `pnpm-lock.yaml`
- U110 (`6371c621`): `pnpm-lock.yaml`

Units that consist only of excluded paths (EXCLUDED, logged, nothing applied): U021 (`21d4ed44`), U033 (`4bac71bc`), U034 (`92676f88`), U035 (`29a2bfcc`), U037 (`a0dfdeaa`), U040 (`5f11e107`), U064 (`1b565e80`), U066 (`98124f42`), U077 (`218930d4`), U079 (`f0b9ce95`), U083 (`1c90cedd`), U084 (`1c04ca8b`), U098 (`4da70aff`), U106 (`29f8a2df`).

Empty upstream commits (no file changes): U042 (`cba904d1`), U045 (`6771f4f4`), U047 (`5c853fe9`), U048 (`723742ac`).

Other EXCLUDED (rule-based): U013 (`3993a3a6`): all substantive changes are `.github/**`; the only remaining hunk (DEVELOPER_GUIDE.md "Local CI Testing") documents `.github/scripts/test-local.sh` and workflows the fork deleted; U038 (`32888710`): hard rule 3: changes Docker base-image tag (`node:22-alpine` → `node:26-alpine`); U041 (`38fa8c5e`): hard rule 3: changes Docker base-image tag (`node:22-alpine` → `node:26-alpine`); U081 (`e644fe3d`): hard rule 3: changes Docker base-image tag (`node:22-alpine` → `node:26-alpine`).

## Check results

_Pending Phase 3._ Planned commands (the `task` binary is not installed locally, so the commands each task wraps are run directly):

| Area | Command | Taskfile equivalent |
|---|---|---|
| core-api lint | `npx eslint "{src,apps,libs,test}/**/*.ts"` (**without** `--fix`, so lint cannot rewrite fork code) | `task api:lint` |
| core-api types | `npx tsc --noEmit -p tsconfig.json` | — (fast check) |
| core-api build | `npm run build` | `task api:build` |
| core-api tests | `npx jest` | `task api:test` |
| console lint | `npm run lint` (`eslint .`, no fix) | `task console:lint` |
| console types/build | `npm run build` (`tsc -b && vite build`) | `task console:build` |
| console tests | `npx vitest run` | `task console:test` (single pass) |
| root | `npm run test:compose-security` | — |
| worker | `go build ./...`, `go vet ./...`, `go test ./...` | `task worker:check`, `worker:lint`, `worker:test` |

Local Node is v26.7.0 (CI uses Node 22); Go 1.27.1.

## Deferred architecture assessment

_Pending Phase 4._ Units: pnpm migration — U085 (#574 + `e859add2` + `40e053c6`), U129 (`ce1a7841`); connector model — U111 (#621), U112 (#635), U114 (#639), U115, U118 (#643), U122 (#649), U123 (#650), U125 (#652), U126 (#653), U130 (#655), U135, U137 (#663), U138 (#664); key prerequisite refactor U104 (#617, inline gRPC client / removes `grpc-client/`).

## UX review

_Pending Phase 3/4._

## Open questions for you

1. **BASE / prior sync.** The fork already took one upstream sync (`5cd1c5bf`, upstream `8ddfef10`). I used `8ddfef10` as BASE. OK to proceed on that basis?
2. **Vite 6 → 8 (U049, #475 + rollup optional dep).** Classified OVERLAP (lockfile-only conflict → regenerate), so the rules say apply. It is a major build-tool upgrade (Rolldown-based) touching the fork's PWA/service-worker build. Apply it (checks decide), or hold it out?
3. **API client regeneration without a database (U006 #460, U012 #464).** Docker is not running, so I cannot boot core-api against a disposable Postgres/Redis to emit `.open-api/open-api.json`. Proposal: build the spec with Nest preview mode (`NestFactory.create(AppModule, { preview: true })`, no providers instantiated, no DB), but only if it first reproduces the current fork spec exactly on `origin/dev`; otherwise skip both units. Alternatively you start Docker Desktop and I use a throwaway stack. Which do you prefer? (The gitignored local `.open-api/open-api.json` would be backed up and restored.)
4. **Base-image tags.** I read hard rule 3 as covering Dockerfile `FROM node:22-alpine` → `node:26-alpine` (U038, U041, U081 → EXCLUDED). Confirm?
5. **Commit message format.** `AGENTS.md` documents conventional commits (`type(scope): …`) enforced by husky, but the fork has disabled that hook (`.husky/commit-msg.disabled`). I will use the prompt's `upstream(v0.8.1): <title> (oasm-platform/open-asm#NNN)` format as instructed. OK?
6. **govulncheck** is not installed. Installing it uses the Go module proxy, but running it queries `vuln.go.dev`, which is beyond package registries. May I install and run it, or skip?
7. **Post-tag upstream security work.** Upstream `main` has `5e708f17` "close cross-tenant, IDOR, SQLi and auth-bypass findings (#671)" after `v0.8.1`; it is out of scope for this sync but worth a targeted review against the fork.
