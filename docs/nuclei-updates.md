# Nuclei update lifecycle

Open-ASM manages the Nuclei engine and the community template set separately.

## Engine releases

Core checks the official stable `projectdiscovery/nuclei` GitHub release once
per day and when an administrator selects **Check for updates** on the Tools
page. The check records the exact release URL, platform archive URLs, and
GitHub-published SHA-256 digests. It never installs a release.

An administrator can request an update for the Nuclei engine independently of
its templates. Each eligible idle worker downloads the exact approved archive,
verifies its digest and archive layout, smoke-tests the staged executable, and
activates it atomically. A failed post-activation smoke test restores the prior
executable. Per-worker progress and errors are shown on the Tools page.

## Template releases

Workers share a persistent tool cache under `WORKER_TOOL_PATH`. At startup, a
worker:

1. Reads the installed Nuclei engine version.
2. Validates the active templates with Nuclei itself.
3. Bootstraps templates only if no validated template set exists.
4. Reports the installed engine and template versions to Core.

The worker does not refresh an existing template set automatically. Core checks
the official stable `projectdiscovery/nuclei-templates` release once per day,
but an administrator must request the template update from the Tools page.
During that rollout, the worker seeds a staging directory from the active
templates, invokes the Nuclei updater, validates the candidate, atomically
publishes a version pointer, and verifies that the installed version is the
administrator-approved target. The previous validated version is restored if
the update cannot be verified.

Nuclei jobs are withheld while no validated template set exists. Other tools
continue to run, so an upstream template outage does not stop subdomain, port,
HTTP, or screenshot discovery.

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
