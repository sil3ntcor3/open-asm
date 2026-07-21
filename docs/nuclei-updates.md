# Nuclei update lifecycle

Open-ASM manages the Nuclei engine and the community template set separately.

## Engine releases

The Core API serves pinned Nuclei archives from `core-api/public/archived`. The
canonical version and SHA-256 values are stored in
`core-api/public/archived/nuclei-manifest.json`, and the built-in tool metadata
reads its version from that manifest.

The `Check Nuclei Updates` GitHub Actions workflow runs daily against the
official `projectdiscovery/nuclei` release feed. When a newer semantic release
exists, it downloads the supported platform archives, verifies each official
checksum and archive layout, runs focused compatibility tests, and opens a pull
request against `dev`. It never merges or promotes a release to `main`.
The workflow uses the repository `GITHUB_TOKEN`; depending on repository
policy, checks on its pull request may require a maintainer to approve or
re-run them. The workflow's privileged third-party actions are pinned to full
commit SHAs.

To prepare a release manually from the repository root:

```bash
scripts/update-nuclei-artifacts.sh 3.11.0
scripts/update-nuclei-artifacts.test.sh
```

Review the resulting manifest, archive replacements, automated checks, and UAT
results before merging.

## Template releases

Workers share a persistent tool cache under `WORKER_TOOL_PATH`. At startup and
on a recurring cadence, the worker:

1. Reads the installed Nuclei engine version.
2. Validates the active templates with Nuclei itself.
3. Seeds a stable updater directory from the active templates, then asks
   Nuclei to update it. This preserves a complete candidate when upstream is
   already current and Nuclei performs a successful no-op update.
4. Copies the validated candidate to a new immutable version directory and
   atomically publishes a small pointer file. Each scan resolves this pointer
   once, so an update cannot remove templates from a running scan.
5. Keeps the previous validated version and recovers the newest ready version
   if the pointer is missing after a crash.
6. Reports engine version, template version, freshness, validation time, and
   update errors to Core API for display on the Workers page.

Nuclei jobs are withheld while no validated template set exists. Other tools
continue to run, so an upstream template outage does not stop subdomain, port,
HTTP, or screenshot discovery.

The defaults are a six-hour refresh interval and a 24-hour maximum-stale
threshold:

```dotenv
WORKER_NUCLEI_TEMPLATE_REFRESH_INTERVAL=6h
WORKER_NUCLEI_TEMPLATE_MAX_STALE=24h
```

The refresh interval must be at least as long as `WORKER_JOB_TIMEOUT`; this
guarantees the retained prior immutable version outlives any scan that resolved
it before a refresh.

All worker replicas should mount the same named volume at `WORKER_TOOL_PATH`.
Open-ASM serializes tool and template changes in that shared cache so one worker
downloads and validates an update while the other replicas continue using the
last-known-good set.

## Worker execution and artifact integrity

Core sends workers a typed, allowlisted tool name plus a target value. Workers
build fixed argument arrays and never evaluate scan jobs through a command
shell. Engine archives are downloaded to temporary storage, checked against
their SHA-256 content identifier, extracted and version-smoke-tested in
staging, and promoted transactionally with rollback to the prior executable
on failure.
