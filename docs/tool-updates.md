# Scanner tool lifecycle

Open-ASM ships scanners three different ways, and which one applies decides how
a version is changed.

| Delivery | Tools | Changed by |
| --- | --- | --- |
| Archive baked into the api image | `subfinder`, `dnsx`, `httpx`, `naabu`, `nuclei` | Bumping `scripts/tool-versions.json` and rebuilding the api image |
| Baked into the worker image | `nmap`, Chromium (screenshots), the Nuclei template seed | Rebuilding the worker image |
| Approved release directive at runtime | the five archive tools plus `nuclei-templates` | An administrator on the Tools page |

## Where a freshly deployed worker gets its tools

Workers never fetch scanners from the internet on first start. On connect a
worker calls `BuiltinToolRegistry`, and Core answers with the archives in
`core-api/public/archived/<os>_<arch>/`, addressed by the SHA-256 of their
contents. The worker downloads any archive it has not already cached in
`WORKER_TOOL_PATH/.tool_versions.json`, verifies the digest, smoke-tests the
staged binary and promotes it.

**Whatever is pinned in that archive is therefore the version every newly
deployed worker runs.** Shipping tools already upgraded is a matter of
refreshing the archive, not of upgrading workers after deployment.

## Baking a newer tool version into the images

1. Bump the version in `scripts/tool-versions.json`.
2. Run the refresher. It downloads every platform archive, verifies each one
   against the official ProjectDiscovery checksums file for that release,
   checks that the archive really contains the expected binary, smoke-tests the
   Linux build, promotes all platforms together, prunes superseded archives and
   regenerates `core-api/public/archived/tool-manifest.json`:

   ```bash
   scripts/update-tool-artifacts.sh                 # verify/refresh every pinned tool
   scripts/update-tool-artifacts.sh nuclei          # one tool
   scripts/update-tool-artifacts.sh nuclei=3.12.0   # bump the pin, then refresh
   ```

   Nothing is written into the repository until every archive of every
   requested tool has passed, so a partial or tampered release cannot half
   replace the pinned set.
3. Rebuild and redeploy the api image (`scripts/build-images.sh api`). Newly
   started workers bootstrap directly at the new version, and workers already
   running pick it up on their next reconnect because the refreshed archive
   hashes to a new artifact ID.

`.github/workflows/check-tool-updates.yml` runs this daily per tool and opens a
checksum-verified pull request against `dev` when upstream is ahead.

### Artifact integrity

`tool-manifest.json` declares, per platform, the exact file name and SHA-256 of
every archive that may be served. `ToolArtifactService` serves nothing else: an
archive added to the image out of band, or altered after the manifest was
generated, is never handed to a worker. An unreadable manifest fails closed and
serves nothing rather than serving unverified binaries.

The catalog versions shown on the Tools page are read from the same manifest,
so they cannot drift from what the image actually ships.

## Nuclei templates

The worker image bakes the template release pinned as `nucleiTemplates` in
`scripts/tool-versions.json` at `/opt/oasm/nuclei-templates`
(`WORKER_NUCLEI_TEMPLATE_SEED`; unset disables seeding). When a worker's tool
cache holds no validated template set, it activates that seed — copying it into
the same immutable, versioned layout a downloaded set uses, validating it with
Nuclei, publishing the version pointer and installing the release's ignore
list. A fresh worker is therefore scan-ready in seconds with no template
download and no outbound access. A seed that is missing or fails validation is
discarded and the worker falls back to the updater.

Nuclei resolves helper and payload files against its *configured* template
directory rather than the `-t` path, and denies them when that directory does
not exist. Both validation and scan invocations therefore pass
`-ud <active template set>`; without it a worker running a baked seed silently
loads a small fraction of helper-backed templates.

To bake a newer template release, bump `nucleiTemplates.version` and `.sha256`
in `scripts/tool-versions.json` and rebuild the worker image.
`scripts/update-tool-artifacts.test.sh` asserts that the `worker/Dockerfile`
build arguments still match the pin file.

## Runtime updates approved by an administrator

Core checks the official stable releases of each managed component once per day
and when an administrator selects **Check for updates** on the Tools page. The
check records the exact release URL, the platform archive URLs and the
GitHub-published SHA-256 digests. It never installs a release.

An administrator can then request an update per component. Each eligible idle
worker downloads the exact approved archive, verifies its digest and archive
layout, smoke-tests the staged executable and activates it atomically. A failed
post-activation smoke test restores the prior executable. Per-worker progress
and errors are shown on the Tools page.

Template updates follow the same approval path: the worker seeds a staging
directory from the active templates, invokes the Nuclei updater, validates the
candidate, atomically publishes a version pointer and verifies that the
installed version is the approved target. The previous validated version is
restored if the update cannot be verified. Workers never refresh an existing
template set on their own.

Nuclei jobs are withheld while no validated template set exists. Other tools
continue to run, so an upstream template outage does not stop subdomain, port,
HTTP or screenshot discovery.

All worker replicas should mount the same named volume at `WORKER_TOOL_PATH`.
Open-ASM serializes tool and template changes in that shared cache so one worker
downloads and validates an update while the other replicas keep using the
last-known-good set.

## Worker execution

Core sends workers a typed, allowlisted tool name plus a target value. Workers
build fixed argument arrays and never evaluate scan jobs through a command
shell. Engine archives are downloaded to temporary storage, checked against
their SHA-256 content identifier, extracted and version-smoke-tested in
staging, and promoted transactionally with rollback to the prior executable on
failure.
