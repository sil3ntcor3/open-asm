# Scanner tool lifecycle

Open-ASM ships scanners three different ways, and which one applies decides how
a version is changed.

| Delivery | Tools | Changed by |
| --- | --- | --- |
| Archive baked into the api image | `subfinder`, `dnsx`, `httpx`, `naabu`, `nuclei` | Bumping `scripts/tool-versions.json` and rebuilding the api image |
| Baked into the worker image | `nmap`, Chromium (screenshots), the Nuclei template seed | Rebuilding the worker image |
| Approved release directive at runtime | the five archive tools plus `nuclei-templates` | An administrator on the Tools page |

## Update running workers from the Tools page

Use this flow to upgrade the scanners already running in your deployment:

1. Sign in with the application-wide **admin** role and open **Management → Tools**.
   A workspace Security Administrator role alone does not grant update access.
2. Click **Check for updates**. This checks official stable releases without
   installing anything; scheduled checks also run daily.
3. Find the component showing **Update available**, review **Installed**, **Latest**
   and **Release notes**, then click **Update**.
4. Review the target version and click **Start update**. The request applies to
   all currently connected eligible workers across the deployment.
5. Click **Details** to monitor each worker. Busy workers stay pending until their
   active jobs finish. Completion is shown as **Update complete**; if a worker
   fails, inspect its error in **Details** and use **Retry update** when offered.

The managed components are `subfinder`, `dnsx`, `httpx`, `naabu`, `nuclei`, and
`nuclei-templates`. The `dnsx` control is labeled **DNS resolver** on the
subfinder card; Nuclei engine and template updates have separate controls.

If the Update button is absent, check that you are signed in as an application
admin and that a newer release is available. **Check failed** means the release
check failed; inspect its error and retry **Check for updates**. **Not reported**
means workers have not reported an installed version yet. Components labeled
**Managed by worker image** (`nmap` and Chromium) require an image rebuild, while
**Managed by provider** components are updated through their provider.

Runtime updates change the worker tool cache. They do not change the source
version pins or the archives bundled in the API image. To make a newer version
available when workers bootstrap from the image, also follow the image process
below. A restarted worker checks the API archive's artifact ID during bootstrap;
keep the bundled versions aligned with the versions you intend to deploy.

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

Run these commands from the **open-asm repository root**. You need Bash,
Python 3, curl, unzip, a SHA-256 utility (`shasum` or `sha256sum`), outbound
access to GitHub, and Docker for the image build.

1. Set the desired stable versions under `tools` in
   [`scripts/tool-versions.json`](../scripts/tool-versions.json).
2. Refresh the archives for those pins:

   ```bash
   bash scripts/update-tool-artifacts.sh          # refresh all pinned tools
   # Or refresh selected tools after editing their pins:
   bash scripts/update-tool-artifacts.sh nuclei httpx
   ```

   Alternatively, `bash scripts/update-tool-artifacts.sh TOOL=X.Y.Z` changes
   one pin and refreshes that tool in one command. Replace `TOOL` and `X.Y.Z`
   with a supported tool name and an existing stable release, without a `v` prefix.

   The script verifies every requested platform archive against the official
   ProjectDiscovery release checksums, checks the binary's presence, smoke-tests
   newly downloaded Linux amd64 binaries when run on Linux amd64, then promotes
   archives, prunes superseded files and regenerates
   `core-api/public/archived/tool-manifest.json`. Archive promotion waits until
   all requested downloads pass. The `TOOL=X.Y.Z` form writes the pin before
   downloading, so inspect or revert the pin if the refresh fails.
3. Review the changes together: `scripts/tool-versions.json`, the regenerated
   manifest, and the added/deleted platform archives under
   `core-api/public/archived/`. Do not edit the generated manifest manually.
4. Build the API image:

   ```bash
   bash scripts/build-images.sh api
   ```

   This builds locally only. For a deployment that pulls images from a registry,
   build and publish using its configured namespace and tag:

   ```bash
   REGISTRY=sil3ntcor3 TAG=latest bash scripts/build-images.sh --push api
   ```

   Replace the namespace and tag if your deployment uses different values.
5. On the **deployment host**, from the **oasm-docker repository root**, pull and
   recreate the stack:

   ```bash
   make update
   ```

   This stops and recreates the stack and causes a brief service interruption.
   It retains named volumes, including the worker tool cache. Workers check the
   refreshed API archives on reconnect and install changed artifact IDs.
6. Return to **Management → Tools** and confirm the reported installed versions
   and worker health. An API image build alone does not change a running deployment.

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

### Update the template seed for new workers

1. Choose a stable template release and download its exact tag archive from
   `https://github.com/projectdiscovery/nuclei-templates/archive/refs/tags/vX.Y.Z.tar.gz`.
   Compute the SHA-256 of that archive with `shasum -a 256` (or `sha256sum`).
2. Update `nucleiTemplates.version` and `nucleiTemplates.sha256` in
   `scripts/tool-versions.json`. Keep the default `NUCLEI_TEMPLATES_VERSION` and
   `NUCLEI_TEMPLATES_SHA256` build arguments in
   [`worker/Dockerfile`](../worker/Dockerfile) in sync; the artifact test checks them.
3. Build and publish the worker image with your deployment's namespace and tag:

   ```bash
   REGISTRY=sil3ntcor3 TAG=latest bash scripts/build-images.sh --push worker
   ```

4. Run `make update` from the oasm-docker repository on the deployment host.

`build-images.sh` passes the template pin and checksum into the worker build.
The scanner archive refresher does not download template seeds. A worker with an
existing validated template set keeps that set; changing the seed only affects
bootstrap when there is no validated set. Use the Tools-page template update to
upgrade existing caches.

### Update Nmap and Chromium

These packages are installed by apt in the worker image. Rebuild with fresh base
images and without cached package-install layers to pick up versions available
from the configured Debian repositories (from the open-asm root):

```bash
docker build --pull --no-cache --platform linux/amd64 -f worker/Dockerfile \
  -t sil3ntcor3/myoasm-worker:latest .
docker push sil3ntcor3/myoasm-worker:latest
```

Adjust the platform, namespace and tag to match your deployment. This direct
build uses the Dockerfile's template-seed defaults, which must match the pin
file. Redeploy with `make update` on the deployment host, then check the installed
Nmap and Screenshot engine (Chromium) versions on the Tools page.

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
