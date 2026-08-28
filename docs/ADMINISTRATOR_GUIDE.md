# Open-ASM Administrator Guide

Operating, securing, and maintaining an Open-ASM deployment.

This guide is for the person who runs the platform: deploying it, provisioning
accounts, scaling workers, keeping scanner engines current, and diagnosing the
stack when something stops working. If you are looking for how to add a target
and triage findings, read the [User Guide](USER_GUIDE.md) instead.

---

## Contents

1. [Architecture](#1-architecture)
2. [Deployment](#2-deployment)
3. [Configuration reference](#3-configuration-reference)
4. [First administrator](#4-first-administrator)
5. [Identity and access](#5-identity-and-access)
6. [Workspaces](#6-workspaces)
7. [Workers](#7-workers)
8. [Scanner tools and templates](#8-scanner-tools-and-templates)
9. [Job dispatch and scheduling](#9-job-dispatch-and-scheduling)
10. [Data, storage, and backups](#10-data-storage-and-backups)
11. [Integrations](#11-integrations)
12. [Upgrades](#12-upgrades)
13. [Troubleshooting runbook](#13-troubleshooting-runbook)
14. [Security notes](#14-security-notes)
15. [Not enabled in this build](#15-not-enabled-in-this-build)

---

## 1. Architecture

Open-ASM is a distributed system. Seven services carry production traffic, plus
two run-once containers that gate startup.

| Service | Container | Image | Listens on | Role |
|---|---|---|---|---|
| Console | `console` | `oasm-console` | `80` (published `3000`) | React SPA served by nginx |
| Core API | `oasm-api` | `oasm-api` | `6276` HTTP, `16276` gRPC | Business logic, persistence, job orchestration |
| Worker | `oasm-worker` (scaled) | `oasm-worker` | — (outbound gRPC only) | Executes scanner binaries |
| PostgreSQL | `oasm-postgres` | `pgvector/pgvector:pg17` | `5432` | System of record |
| Redis | `oasm-redis` | `redis:alpine` | `6379` | BullMQ queues, cache, rate limiting |
| RustFS | `oasm-rustfs` | `rustfs/rustfs` | `9000` | S3-compatible artifact storage |
| Geo-IP | `geo-ip` | `geoip-proxy` | `4360` | IP geolocation enrichment |
| Credential check | `credential-check` | `alpine` | — | Fails startup on weak/missing secrets |
| Migration | `oasm-migration` | `oasm-api` | — | Runs TypeORM migrations, then exits |

### Request and job flow

```
Browser ──REST/SSE──> Core API ──> PostgreSQL   (assets, findings, jobs)
                          │
                          ├──> Redis        (BullMQ schedules, cache)
                          ├──> RustFS       (screenshots, report PDFs)
                          └──> Geo-IP       (ASN/country enrichment)

Worker ──outbound gRPC──> Core API   (pull next job, stream results)
Worker ──raw sockets────> Internet   (subfinder, naabu, nmap, httpx, nuclei)
```

Two properties matter operationally:

- **Workers dial out, never in.** A worker opens a gRPC connection to Core API
  on `16276` and polls for work. Nothing needs to route *to* a worker, so
  workers can sit behind NAT, in another VPC, or on a different continent.
- **Workers are stateless except for their tool cache.** The only durable
  worker state is the scanner binaries and Nuclei templates under
  `WORKER_TOOL_PATH`. Destroying a worker loses nothing but that cache.

### Startup ordering

`credential-check` → `postgres` + `redis` healthy → `migration` completes →
`core-api` healthy → `console` and `oasm-worker`.

`credential-check` runs with `network_mode: none` and validates that every
required secret is present and long enough. A deployment with a blank or
too-short `BETTER_AUTH_SECRET` never reaches the database.

---

## 2. Deployment

### 2.1 Production (recommended)

Production deployments use the separate
[`oasm-docker`](https://github.com/sil3ntcor3/oasm-docker) repository and
pre-built images. **The application source tree is not required on the
deployment host.**

```bash
git clone https://github.com/sil3ntcor3/oasm-docker.git
cd oasm-docker
cp .env.example .env
cp provider-config.example.yaml provider-config.yaml
chmod 600 .env provider-config.yaml
```

Fill in the secrets in `.env` (see [§3](#3-configuration-reference)), then:

```bash
./install.sh
```

`install.sh` pulls images, runs migrations, and prompts privately on the host
for the first administrator's email and password. There is no bootstrap token
and no setup link.

Pass `--no-pull` only when the required images are already present locally.

### 2.2 From source

Useful for development and for testing an unreleased change.

```bash
cp core-api/example.env core-api/.env
cp worker/.example.env worker/.env
cp console/example.env console/.env
```

Populate the secrets, then:

```bash
docker compose up -d --build
```

To run the `dev`-channel images instead of building:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml pull
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --no-build
```

Set `MYOASM_IMAGE_TAG` to an immutable `sha-<12-char-commit>` tag to pin an
exact build.

### 2.3 Verifying a healthy stack

```bash
docker compose ps
```

Expect `oasm-api`, `oasm-postgres`, `oasm-redis`, and `oasm-rustfs` reporting
`(healthy)`, `console` and every `oasm-worker-N` reporting `Up`, and
`oasm-migration` / `credential-check` **absent or exited 0** — they are
run-once containers.

```bash
curl -fsS http://<host>:6276/api/health
```

Then open the console and confirm **Management → Workers** shows one card per
worker replica, each marked **Online** with a green **Scanner healthy** badge.

Interactive API documentation (Scalar) is served at `/api/docs` on the Core API
port.

---

## 3. Configuration reference

### 3.1 Required secrets

`credential-check` refuses to start the stack unless all of these are set to
values of at least the stated length. Generate each one independently — never
reuse a value across variables.

| Variable | Minimum | Used by | Purpose |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | 32 chars | Core API | Signs session cookies. Rotating it logs everyone out. |
| `POSTGRES_PASSWORD` | 32 chars | Core API, Postgres, migration | Database superuser password |
| `REDIS_PASSWORD` | 32 chars, URI-safe | Core API, Redis | Redis AUTH. Embedded in `REDIS_URL`, so avoid `@ : / ?`. |
| `RUSTFS_ACCESS_KEY` | 16 chars | Core API, RustFS | S3 access key |
| `RUSTFS_SECRET_KEY` | 32 chars | Core API, RustFS | S3 secret key |
| `WORKER_ENROLLMENT_TOKEN` | 32 chars | Core API, workers | Shared secret every worker presents to enroll |

Generate them with:

```bash
openssl rand -base64 48 | tr -d '/+=' | head -c 48
```

### 3.2 Core API

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `6276` | HTTP listener |
| `GRPC_PORT` | `16276` | Worker gRPC listener |
| `GRPC_BIND_HOST` | `0.0.0.0` | Bind address for gRPC |
| `GRPC_REFLECTION_ENABLED` | `false` | Leave off in production |
| `GRPC_TLS_ENABLED` | `false` | Enables mTLS to workers |
| `GRPC_TLS_CA_FILE` / `_CERT_FILE` / `_KEY_FILE` | — | **All three mandatory** when TLS is on |
| `BETTER_AUTH_URL` | `http://localhost:6276` | Public Core API URL for auth callbacks |
| `POSTGRES_HOST` / `_PORT` / `_USERNAME` / `_DB` / `_SSL` | `postgres` / `5432` / `postgres` / `open_asm` / `false` | Database connection |
| `GEO_IP_URL` | `geo-ip:4360` | Geo-IP proxy address |
| `RUSTFS_ENDPOINT` | `http://rustfs:9000` | S3 endpoint |

### 3.3 Worker

| Variable | Default | Notes |
|---|---|---|
| `WORKER_API_KEY` | — | Must equal `WORKER_ENROLLMENT_TOKEN` |
| `WORKER_GRPC_HOST` / `_PORT` | `core-api` / `16276` | Where to dial Core API |
| `WORKER_MAX_CONCURRENCY` | `10` | Simultaneous scanner processes per worker |
| `WORKER_TOOL_PATH` | `/app/oasm-tools` | Tool cache. **Mount the same named volume on every replica.** |
| `WORKER_JOB_TIMEOUT` | `30m` | Hard kill for a single scanner invocation |
| `WORKER_JOB_STDOUT_LIMIT_BYTES` | `16777216` | 16 MiB stdout cap |
| `WORKER_JOB_STDERR_LIMIT_BYTES` | `16777216` | 16 MiB stderr cap |
| `WORKER_NUCLEI_TEMPLATE_REFRESH_INTERVAL` | `6h` | Template staleness check cadence |
| `WORKER_NUCLEI_TEMPLATE_MAX_STALE` | `24h` | Age at which templates are considered stale |
| `WORKER_NUCLEI_TEMPLATE_SEED` | `/opt/oasm/nuclei-templates` | Baked template seed. Unset disables seeding. |
| `SUBFINDER_PROVIDER_CONFIG` | — | Path to the subfinder provider credentials file |
| `WORKER_GRPC_TLS_*` | — | mTLS material, mirrors the Core API settings |

> **Shared tool cache.** All worker replicas must mount the *same* named volume
> at `WORKER_TOOL_PATH`. Open-ASM serializes tool and template changes through
> that cache so exactly one worker downloads and validates an update while the
> others keep running the last-known-good set. Give each replica its own volume
> and every replica will download every update independently.

### 3.4 Console

| Variable | Notes |
|---|---|
| `VITE_API_URL` | Public Core API URL. Baked in **at image build time**, not at runtime. |

Because `VITE_API_URL` is compile-time, changing the API's public address means
rebuilding the console image, not just restarting it.

---

## 4. First administrator

There are two ways to create the first administrator. Which one you get depends
on how you deployed.

### 4.1 On the host (production path)

**With the installer:**

```bash
./install.sh
```

It prompts for email and password without echoing or logging either.

**Manually, against a running stack:**

```bash
docker compose --profile setup run --rm admin-provisioner
```

The `admin-provisioner` service runs `node dist/provision-admin.js`, reading
exactly two newline-delimited values from stdin. Requirements:

- Email must be a valid address; it is lowercased before storage.
- Password must be **8–128 characters**.
- Any third line is rejected outright.

The container runs `read_only`, with `cap_drop: ALL` and
`no-new-privileges`, on the `setup` profile so it never starts during a normal
`docker compose up`.

### 4.2 In the browser (first-run bootstrap)

The console also exposes a one-time bootstrap page at **`/init-admin`**.

It is gated on system metadata: Core API reports `isInit: true` as soon as *any*
user with the `admin` platform role exists, and the route then redirects to
`/login`. So the page is reachable **only on a deployment that has never had an
administrator.**

This matters operationally:

> **A freshly migrated stack with no administrator will hand the `admin` role to
> whoever loads `/init-admin` first.** If you bring up the stack before
> provisioning, do not expose the console publicly until an administrator
> exists. The `install.sh` path closes this window by provisioning during
> installation; a from-source `docker compose up` does not.

Verify the window is closed:

```bash
curl -fsS http://<host>:6276/api/metadata | grep -o '"isInit":[a-z]*'
```

`"isInit":true` means the bootstrap page is no longer reachable.

### 4.3 Recovering lost administrator access

Re-run the provisioner on the host:

```bash
docker compose --profile setup run --rm admin-provisioner
```

There is no password-reset email flow in this build. Users who still know their
current password can change it at **Settings → Security**; everyone else needs
re-provisioning. `/init-admin` will *not* help — it is closed as soon as any
administrator exists, including a locked-out one.

---

## 5. Identity and access

Open-ASM has **two independent authorization layers**. Confusing them is the
most common access-control mistake.

### 5.1 Platform roles

Set per user account, application-wide. Managed at **Admin → Users**.

| Role | Value | Capability |
|---|---|---|
| Platform Admin | `admin` | Full access to **every workspace** and every application setting, bypassing workspace membership entirely |
| User | `user` | Sees only workspaces where membership was explicitly granted |
| Bot | `bot` | Non-interactive account for automation |

A Platform Admin short-circuits every workspace permission check. Treat the
role as equivalent to root on the platform and grant it sparingly.

### 5.2 Workspace roles

Set per membership, scoped to one workspace. Managed at **Settings → Members**;
the full matrix is visible at **Settings → Roles & permissions**.

| Role | Permissions | Intended for |
|---|---|---|
| **Viewer** | 2 | Read-only stakeholders, auditors |
| **Analyst** | 6 | Triages findings, produces reports, creates targets |
| **Operator** | 8 | Analyst plus target management and scan execution |
| **Security Administrator** | 11 | Controls scans, workers, tools, templates, and secrets |
| **Owner** | 16 (all) | Workspace owner |

These five are **protected defaults** and cannot be edited. Use **Create custom
role** to combine permissions differently.

### 5.3 Permission matrix

| Action | Viewer | Analyst | Operator | Sec Admin | Owner |
|---|:-:|:-:|:-:|:-:|:-:|
| View workspace | ● | ● | ● | ● | ● |
| Manage workspace | | | | | ● |
| Manage members | | | | | ● |
| Manage roles | | | | | ● |
| Create targets | | ● | ● | | ● |
| Manage targets | | | ● | | ● |
| Run scans | | | ● | ● | ● |
| Triage findings | | ● | ● | ● | ● |
| Manage reports | | ● | ● | ● | ● |
| Manage secrets | | | | ● | ● |
| Use AI agent | | ● | ● | ● | ● |
| Manage AI agent | | | | ● | ● |
| View workers | ● | ● | ● | ● | ● |
| Manage workers | | | | ● | ● |
| Manage tools | | | | ● | ● |
| Manage templates | | | | ● | ● |

Two asymmetries are deliberate and worth knowing:

- **Analyst can create targets but not run scans.** An Analyst can register a
  domain; discovery for it must be started by an Operator, Security
  Administrator, or Owner.
- **Security Administrator cannot create or manage targets.** The role governs
  scanning infrastructure — workers, tools, templates, secrets — not inventory.

### 5.4 Creating users

**Admin → Users → Add**. Set the platform role there; grant workspace access
separately under **Settings → Members** in each workspace the user needs.

---

## 6. Workspaces

A workspace is the isolation boundary for targets, assets, findings, reports,
groups, and API keys. Every workspace-scoped API route requires a workspace
selection, supplied either as an `X-Workspace-Id` header or a `wid` cookie.
Requests without one fail with `Workspace id null or invalid`.

Fresh deployments ship with a single workspace named `default`.

Use separate workspaces to separate **data**, not to separate permissions
within one dataset — workspace roles already do the latter. Good reasons to add
a workspace: distinct business units, per-client engagements, or a
non-production sandbox.

**Settings → General** manages the current workspace's name and description and
allows archiving or deleting it.

### Workspace API keys

**Settings → API keys** exposes one key per workspace for programmatic access.
**Copy** puts it on the clipboard; **Rotate** invalidates the current key
immediately and issues a new one. Any integration using the old key breaks at
the moment of rotation, so rotate deliberately.

---

## 7. Workers

**Management → Workers** shows every enrolled worker as a card: identifier,
online state, tool badges, active job count, scanner-health badge, last
validation time, and creation time.

Workers are filtered by scope:

- **Global** — available to every workspace.
- **Workspace** — restricted to the current workspace.

Cards also carry a type badge (`External` for a worker enrolled over gRPC,
`Built-in` for one managed by the platform).

### 7.1 Enrollment

A worker enrolls by presenting `WORKER_API_KEY` over gRPC. If the value matches
Core API's `OASM_CLOUD_APIKEY` (set from `WORKER_ENROLLMENT_TOKEN` in Compose),
it registers and begins polling. There is no per-worker credential and no
approval step — **the enrollment token is the only thing standing between an
arbitrary host and your job queue.**

### 7.2 Scaling

```bash
docker compose up -d --scale oasm-worker=6
```

Sizing guidance:

- Each worker runs up to `WORKER_MAX_CONCURRENCY` (default 10) scanner
  processes concurrently.
- Nuclei and nmap are the memory-hungry stages. Budget roughly 2 GB RAM per
  worker at the default concurrency and adjust from observed usage.
- Scanning is network- and latency-bound far more than CPU-bound. More workers
  usually beats bigger workers.
- Every replica must mount the shared tool-cache volume (see §3.3).

### 7.3 Pause and resume

Each worker card carries a pause control. Pausing a worker stops it being
handed **new** jobs; jobs already running continue to completion.

Dispatch gating is cached for about 30 seconds, so a pause can take up to that
long to take effect through the queue. The worker-side `dispatch_paused` flag
from the control poll normally applies sooner.

Pause rather than kill a worker when you need to drain it for maintenance.

### 7.4 Scanner health

The **Scanner healthy** badge reflects the worker's last successful
self-validation: every expected engine present, executable, and returning a
version. A worker that is Online but not scanner-healthy has a broken or
partially-updated tool cache — check its logs and, if necessary, delete the
tool-cache volume and let it re-bootstrap.

---

## 8. Scanner tools and templates

**Management → Tools** is the control surface. The complete lifecycle is
documented in [`docs/tool-updates.md`](tool-updates.md); this section covers
what an operator needs day to day.

### 8.1 Shipped engines

| Tool | Category | Version at time of writing | Delivery |
|---|---|---|---|
| `subfinder` | Subdomains | 2.16.0 | Archive in the API image |
| `naabu` | Ports scanner | 2.6.1 | Archive in the API image |
| `httpx` | HTTP probe | 1.10.0 | Archive in the API image |
| `nuclei` | Vulnerabilities | 3.11.1 | Archive in the API image |
| `dnsx` | DNS resolution | — | Archive in the API image |
| `nmap` | Service discovery | 7.99 | Baked into the worker image |
| `screenshot` | Screenshot | 1.0.0 | Chromium, baked into the worker image |
| `nessus` | Vulnerabilities | — | **Provider-managed, not installed by default** |

`nessus` appears in the catalog as an optional provider integration and shows
**Offline / Installed Not reported** until you install and connect it.

`dnsx` ships and runs but is **not a catalog tool and not a pipeline stage.**
It executes inside the subfinder job as a two-pass `-wd` filter that strips
wildcard-DNS noise from passive results before they become assets. You will not
see it on the Tools page or in the Jobs Registry.

### 8.2 Three delivery paths

Which path applies decides how a version changes:

| Delivery | Tools | Changed by |
|---|---|---|
| Archive in the API image | `subfinder`, `dnsx`, `httpx`, `naabu`, `nuclei` | Bump `scripts/tool-versions.json`, rebuild the API image |
| Baked into the worker image | `nmap`, Chromium, the Nuclei template seed | Rebuild the worker image |
| Approved release at runtime | the five archive tools plus `nuclei-templates` | An administrator on the Tools page |

### 8.3 How a fresh worker gets its tools

Workers never fetch scanners from the internet on first start. On connect, a
worker asks Core API for the archives under
`core-api/public/archived/<os>_<arch>/`, addressed by the SHA-256 of their
contents. It downloads anything not already in its cache, verifies the digest,
smoke-tests the staged binary, and promotes it.

**Whatever is pinned in that archive is the version every newly deployed worker
runs.** Shipping upgraded tools is a matter of refreshing the archive, not of
upgrading workers afterwards.

`tool-manifest.json` declares the exact filename and SHA-256 of every archive
that may be served. An archive added out of band, or altered after the manifest
was generated, is never handed to a worker. An unreadable manifest **fails
closed** and serves nothing.

### 8.4 Runtime updates

Core API checks official stable releases once per day, and on demand when an
administrator clicks **Check for updates**. The check records release and
archive URLs plus GitHub-published SHA-256 digests. **It never installs
anything.**

An administrator then requests an update per component. Each eligible idle
worker downloads the approved archive, verifies its digest and layout,
smoke-tests the staged executable, and activates it atomically. A failed
post-activation smoke test restores the previous executable. Per-worker
progress and errors appear on the Tools page.

Updates are always administrator-initiated. Nothing self-upgrades.

### 8.5 Nuclei templates

The worker image bakes a pinned template release at
`WORKER_NUCLEI_TEMPLATE_SEED`. When a worker's cache holds no validated
template set, it activates that seed — validating with Nuclei, publishing the
version pointer, installing the ignore list. A fresh worker is scan-ready in
seconds with no template download and no outbound access. A seed that is
missing or fails validation is discarded and the worker falls back to the
updater.

Template updates follow the same approval path as engines, with rollback to the
last validated version if the update cannot be verified.

**Nuclei jobs are withheld while no validated template set exists.** Other
tools keep running, so a template outage degrades vulnerability scanning
without stopping subdomain, port, HTTP, or screenshot discovery.

### 8.6 Baking a newer version

```bash
scripts/update-tool-artifacts.sh                 # verify/refresh every pinned tool
scripts/update-tool-artifacts.sh nuclei          # one tool
scripts/update-tool-artifacts.sh nuclei=3.12.0   # bump the pin, then refresh
```

Nothing is written to the repository until every archive of every requested
tool passes verification, so a partial or tampered release cannot half-replace
the pinned set. Then rebuild and redeploy the API image
(`scripts/build-images.sh api`).

`.github/workflows/check-tool-updates.yml` runs this daily per tool and opens a
checksum-verified pull request against `dev` when upstream is ahead.

---

## 9. Job dispatch and scheduling

### 9.1 Job states

| State | Meaning |
|---|---|
| `pending` | Queued, not yet claimed |
| `in_progress` | Claimed by a worker and running |
| `completed` | Finished successfully |
| `failed` | Finished with an error |
| `cancelled` | Cancelled by an operator |
| `paused` | Held by an operator; excluded from dispatch until resumed |

### 9.2 Priority

Lower numeric value means more urgent: `CRITICAL=0`, `HIGH=1`, `MEDIUM=2`,
`LOW=3`, `BACKGROUND=4`.

Assigned per tool: `subfinder`, `naabu`, `nmap`, `httpx`, and `screenshot` all
run at **MEDIUM**; `nuclei` runs at **LOW**.

Dispatch sorts by priority ascending, then oldest-first (FIFO within a band).
The LOW priority on Nuclei is deliberate — it keeps a large vulnerability sweep
from starving the port and service scans that feed it.

### 9.3 Scan windows

A target may carry a scan window: start time, end time, timezone, and an
optional set of ISO weekdays. Jobs are only dispatched while the window is
open, evaluated in the target's own timezone. Windows crossing midnight
(for example 22:00–06:00) are handled correctly.

Targets without a window are always dispatchable. Jobs stay `pending` outside
the window rather than failing; already-running jobs are paused via the worker
control poll.

Use scan windows to keep active scanning inside an agreed maintenance period.

### 9.4 Recurring scans

Per-target schedules use a fixed set of cron expressions:

| Option | Cron |
|---|---|
| Disabled | — |
| Daily | `0 0 * * *` |
| Every 3 days | `0 0 */3 * *` |
| Weekly (Sunday) | `0 0 * * 0` |
| Bi-weekly | `0 0 */14 * *` |
| Monthly (1st) | `0 0 1 * *` |

All run at 00:00. Asset groups can carry their own workflow schedule using the
same set.

### 9.5 Pipeline fan-out

Discovery is a chained workflow. Each step is fanned out **target-wide**: when
a step drains, the next step is created for every asset in the target, not just
the asset whose job finished last.

A step that yields zero jobs does **not** terminate the pipeline — the walk
skips to the following step. This is why vulnerability scanning still runs
across the full attack surface even when, for example, the screenshot step
finds no web services to shoot.

Step transitions are serialized with a Postgres advisory lock so two jobs
finishing simultaneously cannot both fan out the next step.

---

## 10. Data, storage, and backups

### 10.1 What lives where

| Store | Volume | Contents |
|---|---|---|
| PostgreSQL | `pgdata` | Targets, assets, services, findings, issues, jobs, users, workspaces |
| RustFS | `rustfs-data` | Screenshots, report PDFs, scan artifacts |
| Redis | `redis-data` | Queues and cache — **rebuildable, not authoritative** |
| Geo-IP | `geoip-data` | Geolocation database |
| Worker tools | `worker-tools-cache` | Scanner binaries and Nuclei templates — **rebuildable** |

Back up `pgdata` and `rustfs-data`. The rest reconstructs itself.

### 10.2 Backup

```bash
docker exec oasm-postgres pg_dump -U postgres -Fc open_asm > oasm-$(date +%F).dump
```

Take RustFS with a filesystem-level snapshot or copy of its volume. Capture
both at the same point in time — a database referencing screenshots that the
object store does not have will render broken image links.

### 10.3 Restore

```bash
docker compose stop core-api
docker exec -i oasm-postgres pg_restore -U postgres -d open_asm --clean --if-exists < oasm-2026-08-28.dump
docker compose start core-api
```

Restore the RustFS volume from the matching snapshot before starting Core API.

### 10.4 Migrations

Migrations run in a dedicated one-shot `migration` container that must complete
successfully before Core API starts.

> **Known behaviour:** `NODE_ENV` is unset in the `oasm-api` container, which
> leaves TypeORM's `migrationsRun` false. Core API therefore does **not** apply
> migrations itself — the `migration` container is the only thing that does. If
> you start Core API without that container having run, the schema will be
> stale. Verify explicitly after any upgrade:

```bash
docker compose run --rm migration
docker exec oasm-api node node_modules/typeorm/cli.js migration:show -d dist/database/database-config.js
```

### 10.5 Connection pool

The Postgres pool size and the result-processor concurrency are both **10**.
This pairing matters when modifying Core API: never hold a transaction open
while requesting a second connection — ten waiters will pin the whole pool and
deadlock the service. Pass the active `EntityManager` down instead.

---

## 11. Integrations

### 11.1 Subfinder provider credentials

Subfinder uses every passive source available without credentials. Sources that
require an API key are enabled through a worker-local provider file, referenced
by `SUBFINDER_PROVIDER_CONFIG`.

Start from `worker/provider-config.example.yaml`; the full procedure is in
[`docs/subfinder-provider-credentials.md`](subfinder-provider-credentials.md).
Keep the file at mode `600` — it holds third-party API keys in plaintext.

Adding credentialed sources materially improves subdomain coverage and is the
single highest-value optional configuration on the platform.

### 11.2 AI providers

**Overview → New Chat** drives an AI assistant over collected asset data.
Nothing works until a provider is connected — the page shows **Connect an AI
Provider** until one is.

Supported providers:

| Provider | Notes |
|---|---|
| OpenAI | API key |
| Anthropic | API key |
| Google Gemini | API key |
| OpenRouter | Routed through an OpenAI-compatible endpoint |
| Kilo Gateway | Routed through an OpenAI-compatible endpoint |
| Custom (OpenAI-compatible) | Supply your own base URL and key |

Connect at **Agents → Providers → Connect**: give the provider a name, API URL
where applicable, and API key, then pick a model from the list the provider
returns.

The `AGENT_MANAGE` permission gates provider and model configuration;
`AGENT_USE` gates chatting. Analysts and Operators can use the assistant but
not reconfigure it.

Asset data is sent to whichever provider you connect. Choose one whose data
handling matches the sensitivity of your inventory.

### 11.3 Notifications

In-app notifications are delivered per user with `SYSTEM`, `USER`, and `GROUP`
scopes. Emitted types in this build:

- `WORKSPACE_CREATED`
- `VULNERABILITY_ANALYSIS_COMPLETED`
- `ASSET_NEW_DETECT`

There is no outbound email, Slack, or webhook channel in this build.
Notifications are console-only.

### 11.4 Branding

**Settings → Brand name and logo** (Platform Admin only) replaces the product
name and logo in the console.

---

## 12. Upgrades

### 12.1 Image channels

| Git branch | Mutable tag | Purpose |
|---|---|---|
| `dev` | `sil3ntcor3/myoasm-<service>:dev` | Integration testing |
| `main` | `sil3ntcor3/myoasm-<service>:latest` | Stable deployments |

Every build also publishes an immutable
`sil3ntcor3/myoasm-<service>:sha-<12-char-commit>` tag. Services are `console`,
`api`, and `worker`.

Pin production to a `sha-` tag rather than `latest` when you need reproducible
rollbacks.

### 12.2 Procedure

1. Back up Postgres and RustFS ([§10.2](#102-backup)).
2. Pull new images.
3. Run the `migration` container and confirm it exits 0.
4. Start Core API; wait for `(healthy)`.
5. Start console and workers.
6. Verify every worker returns Online and scanner-healthy.

```bash
docker compose pull
docker compose run --rm migration
docker compose up -d
docker compose ps
```

### 12.3 Console cache staleness

The console is a service-worker-backed SPA, and stale assets after a redeploy
have two independent causes:

1. **nginx caching `index.html` / `sw.js`** — addressed by no-cache headers on
   those two files.
2. **Workbox in prompt mode serving navigations from precache** — *not* fixed
   by the nginx headers.

If users report an old console after an upgrade, have them hard-reload or clear
site data. A visibly stale console with a current API is almost always cause 2.

### 12.4 Build reproducibility

`core-api` has **no lockfile**, so its Docker build re-resolves floating
dependencies at build time. A build that "works locally but fails in CI" is
usually this drift. Pin exact known-good versions when diagnosing a build that
changed without a code change.

---

## 13. Troubleshooting runbook

### Stack will not start

`credential-check` exits non-zero → a required secret is missing or too short.
Its output names the variable. Fix `.env` and re-run.

### Core API unhealthy

```bash
docker compose logs --tail=200 core-api
```

Check in order: Postgres reachable and healthy; `migration` completed
successfully; `REDIS_URL` password correct and URI-safe; RustFS reachable.

### Workers Online but no jobs run

1. Is the worker paused? Check the card control.
2. Is the target inside its scan window? Jobs sit `pending` outside it.
3. For Nuclei specifically: is there a validated template set? Nuclei jobs are
   withheld without one while other tools continue.
4. Check **Management → Jobs Registry** for the run's actual state.

### Workers not appearing at all

`WORKER_API_KEY` must equal `WORKER_ENROLLMENT_TOKEN`. Confirm the worker can
reach `WORKER_GRPC_HOST:WORKER_GRPC_PORT`. If `GRPC_TLS_ENABLED=true`, all
three certificate paths must be present on both sides, and
`WORKER_GRPC_TLS_SERVER_NAME` must match the certificate.

### Worker Online but not scanner-healthy

The tool cache is broken or half-updated. Inspect worker logs, then delete the
`worker-tools-cache` volume and restart to force a clean bootstrap from the API
image archives.

### Screenshots missing

Screenshots are **best-effort and non-fatal**. They are not gated on httpx
success, which matters because httpx sometimes marks genuine web services on
80/443 as failed in-pipeline. Missing screenshots do not indicate a broken
pipeline.

### Services attributed to the wrong port

A known upstream behaviour: `httpx -u host:443` can silently fall back to
`http://host:80` and file port 80's response under the `:443` service. Suspect
this when a service's evidence does not match its port.

### Wildcard DNS noise

Parked domains with wildcard DNS generate junk subdomains (`mx.mx.mx.…`). The
worker applies a two-pass `dnsx -wd` filter to suppress them. A flood of
nonsense subdomains on a new target usually means the filter did not engage —
check worker logs for the dnsx stage.

### CDN/WAF tarpits

Edge providers may answer on every port inside a scanned range, producing
thousands of phantom services. Detection relies on obscure control ports drawn
from the top-1000 list; random high ports are not a reliable signal.

### Useful commands

```bash
docker compose logs -f --tail=100 core-api
docker compose logs -f --tail=100 oasm-worker
docker exec -it oasm-postgres psql -U postgres -d open_asm
docker exec oasm-redis redis-cli --no-auth-warning -a "$REDIS_PASSWORD" info clients
curl -fsS http://<host>:6276/api/health
```

---

## 14. Security notes

**Authorization.** Only the login and health endpoints are unauthenticated.
Every workspace-scoped route enforces the permission matrix in §5.3, except for
Platform Admins, who bypass it entirely.

**Command execution.** Core API sends workers a typed, allowlisted tool name
plus a target value. Workers build fixed argument arrays and **never evaluate
scan jobs through a command shell.**

**Supply chain.** Engine archives are content-addressed by SHA-256, verified on
download, smoke-tested in staging, and promoted transactionally with rollback.
The manifest fails closed.

**Container hardening.** `credential-check`, `admin-provisioner`, and the RustFS
credential path run `read_only` with `cap_drop: ALL` and `no-new-privileges`.

**Secrets on disk.** `.env` and `provider-config.yaml` hold plaintext secrets.
Keep them at mode `600` and out of version control.

**Network exposure.** Publish only the console. Core API's HTTP port needs
exposure only if you use the API directly; its gRPC port needs exposure only
for workers outside the Compose network. Postgres, Redis, and RustFS should
never leave the internal network.

**gRPC mTLS.** `GRPC_TLS_ENABLED=false` by default, which is acceptable when
workers share a private Docker network. **Enable mTLS whenever a worker crosses
an untrusted network.** All three certificate paths become mandatory on both
sides.

**Enrollment token.** Any host holding `WORKER_ENROLLMENT_TOKEN` can enroll as
a worker and receive jobs. Treat it as a high-value credential; rotating it
requires updating every worker.

**Scanning authorization.** Open-ASM performs active reconnaissance —
port scanning, service fingerprinting, and vulnerability probing — against
whatever you point it at. Only scan infrastructure you own or are explicitly
authorized in writing to test.

---

## 15. Not enabled in this build

Documented here so you do not spend time looking for them.

| Feature | Status |
|---|---|
| **MCP server** | Present in the tree but **entirely commented out**. `McpModule` is not registered in `app.module.ts` and `mcp.tools.ts` contains no active code. The README and the MCP screenshot describe an inactive capability. |
| **MCP Connect settings tab** | Commented out in `console/src/pages/settings/settings.tsx`. |
| **Internal networks** | Routes exist under `console/src/routes/_authed/internal-networks/`, but the navigation entry is commented out in `menu-bar.tsx`. Not reachable through the UI. |
| **Nessus** | Listed in the tool catalog as a provider integration; not installed or connected by default. |
| **Outbound notification channels** | Only in-app notifications exist. No email, Slack, or webhook delivery. |

---

## Related documentation

- [User Guide](USER_GUIDE.md)
- [Developer Guide](../DEVELOPER_GUIDE.md)
- [Scanner tool lifecycle](tool-updates.md)
- [Subfinder provider credentials](subfinder-provider-credentials.md)
- [Reports](reports.md)
- [Versioning](versioning.md)
- [Screenshot worker](worker/screenshot.md)
