# Administrator provisioning

Open-ASM creates its first administrator through a one-time container process
that is available only to an operator with access to the deployment host. The
public API does not expose an administrator-creation endpoint, and the browser
never accepts a bootstrap token or first-administrator credentials.

## Prerequisites

- Docker Engine with the Compose plugin
- Bash
- A local clone of the Open-ASM repository
- Permission to control Docker on the deployment host

Docker control is the authorization boundary for initial provisioning. Anyone
who can control the Docker daemon can already control the application
containers and their data, so provisioning must be run only by a trusted host
operator.

## Prepare the environment

From the repository root, create the service environment files:

```bash
cp core-api/example.env core-api/.env
cp console/example.env console/.env
cp worker/.example.env worker/.env
```

Configure these values in `core-api/.env` before running the installer:

- `BETTER_AUTH_SECRET`: a unique generated value of at least 32 characters
- `BETTER_AUTH_URL`: the public Core API URL used for authentication callbacks
- `POSTGRES_PASSWORD`: a unique generated value of at least 32 characters
- `REDIS_PASSWORD`: a unique URI-safe generated value of at least 32 characters
- `RUSTFS_ACCESS_KEY`: a unique value of at least 16 characters
- `RUSTFS_SECRET_KEY`: a unique generated value of at least 32 characters
- `WORKER_ENROLLMENT_TOKEN`: a unique generated value of at least 32 characters

For non-Compose local development, set `OASM_CLOUD_APIKEY` to the same worker
enrollment value. Do not commit any `.env` file.

## Install from source

Run:

```bash
./scripts/install.sh
```

The installer performs these operations in order:

1. Confirms all three service environment files exist and validates the
   rendered Compose configuration.
2. Builds the Core API, console, and worker images.
3. Starts PostgreSQL and Redis and waits for them to become healthy.
4. Applies all pending database migrations.
5. Prompts for the first administrator email, password, and password
   confirmation.
6. Pipes the email and password over standard input to the profile-gated
   `admin-provisioner` container.
7. Starts the complete Open-ASM stack after provisioning succeeds.

The password prompt is hidden. The password is not placed in a command-line
argument, environment variable, Compose file, URL, or Docker log. The
provisioner container has no published port, runs read-only without Linux
capabilities, exits after the account is created, and is removed by the
installer.

When installation completes, open `http://localhost:3000` and sign in with the
administrator credentials entered during installation.

## Install with pre-built images

Prepare the environment files exactly as described above, then run:

```bash
docker compose --env-file core-api/.env pull
./scripts/install.sh --no-build
```

`--no-build` skips local image builds and uses the images already present on the
host. All migration, provisioning, and startup checks remain enabled.

## Verify the installation

Check the running services:

```bash
docker compose --env-file core-api/.env ps
```

Check the API health endpoint:

```bash
curl -fsS http://localhost:6276/api/health
```

Check the initialization state:

```bash
curl -fsS http://localhost:6276/api/metadata
```

The metadata response must contain `"isInit":true`. A request to
`POST /api/init-admin` must return `404`; first-administrator creation is not an
HTTP operation.

## One-time and concurrent behavior

The provisioner acquires a PostgreSQL advisory transaction lock before it
checks for an administrator. Concurrent provisioning attempts are serialized,
and only the first can create an account. Once any administrator exists, every
later provisioning attempt is refused without changing the existing account.

Do not rerun the installer to start an existing deployment. Use:

```bash
docker compose --env-file core-api/.env up -d
```

## Failure and recovery

If the installer fails before reporting that the administrator was created,
correct the reported environment, image, database, or migration problem and
run the installer again.

If the administrator was created but a later service fails to start, do not
rerun provisioning. Start or troubleshoot the existing deployment with normal
Compose commands:

```bash
docker compose --env-file core-api/.env up -d
docker compose --env-file core-api/.env ps
docker compose --env-file core-api/.env logs core-api
```

If the provisioner reports that an administrator already exists, it will not
overwrite that account or create a second one. Sign in with the existing
credentials. Account recovery must use an authenticated administrator or a
verified backup/recovery procedure; there is intentionally no unauthenticated
bootstrap bypass.

For a brand-new disposable installation that has no data worth retaining, the
operator may choose to remove the deployment and its volumes and reinstall.
Removing volumes permanently deletes application data, so back up and verify
the exact Compose project before taking that action.

## Updates after installation

Updates do not run the administrator provisioner. Build or pull the new images,
apply migrations, and restart the services with the normal deployment process.
The existing administrator account remains in PostgreSQL.

For pre-built images:

```bash
docker compose --env-file core-api/.env pull
docker compose --env-file core-api/.env run --rm migration
docker compose --env-file core-api/.env up -d
```

## Security properties

- No public route creates the first administrator.
- Public email-and-password sign-up is disabled; authenticated administrators
  provision later users through the normal user-management API.
- Provisioning requires Docker-host control and runs on the private Compose
  network.
- Credentials travel only over the one-shot process standard input.
- PostgreSQL serialization prevents concurrent first-administrator creation.
- The provisioner refuses to run after initialization and never changes an
  existing administrator.
