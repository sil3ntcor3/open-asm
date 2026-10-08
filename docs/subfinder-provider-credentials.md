# Subfinder provider credentials

OASM runs Subfinder with `-all`, so every available passive source is eligible
for each domain discovery job. Sources that require credentials read them from
Subfinder's YAML provider configuration. The file stays on the worker: OASM
does not send provider secrets through Core, job payloads, or the console.
Subfinder stderr is suppressed at the worker boundary because upstream provider
errors can contain credential-bearing request URLs; DNS enrichment diagnostics
remain available.

ProjectDiscovery documents the current provider names and composite credential
formats in its [Subfinder installation guide](https://docs.projectdiscovery.io/opensource/subfinder/install#post-install-configuration).

## Native Linux and macOS workers

Subfinder automatically reads the conventional file used by native workers:

```text
~/.config/subfinder/provider-config.yaml
```

Create that file for the operating-system account that runs `oasm-worker` and
restrict it to that account:

```bash
install -d -m 700 "$HOME/.config/subfinder"
install -m 600 /path/to/provider-config.yaml "$HOME/.config/subfinder/provider-config.yaml"
```

No additional worker option is required for this standard location. To use an
alternate absolute path, set `SUBFINDER_PROVIDER_CONFIG` in `worker/.env` or in
the worker process environment:

```bash
SUBFINDER_PROVIDER_CONFIG=/run/secrets/subfinder-provider-config.yaml ./oasm-worker
```

## Docker Compose workers

The opt-in Compose overlay mounts one populated file read-only into every
worker replica and sets the supported `SUBFINDER_PROVIDER_CONFIG` path:

```bash
cp worker/provider-config.example.yaml worker/provider-config.yaml
chmod 600 worker/provider-config.yaml
# Edit worker/provider-config.yaml and add only the providers you use.

docker compose \
  -f docker-compose.yml \
  -f docker-compose.subfinder-providers.yml \
  up -d --build
```

`worker/provider-config.yaml` is gitignored. On native Linux Docker hosts, the
container runs as UID/GID 1000; ensure that account can read the bind-mounted
file without making it readable by unrelated users. To keep the secret outside
the repository, provide an absolute host path:

```bash
SUBFINDER_PROVIDER_CONFIG_PATH=/etc/oasm/subfinder/provider-config.yaml \
docker compose \
  -f docker-compose.yml \
  -f docker-compose.subfinder-providers.yml \
  up -d
```

For multi-host deployments, distribute the provider file with the platform's
secret manager and mount it at the path named by `SUBFINDER_PROVIDER_CONFIG` on
each worker. Rotate credentials in the secret store and recreate the affected
worker replicas so every host reads the replacement file.

## YAML examples

Simple providers accept one or more keys:

```yaml
securitytrails:
  - SECURITYTRAILS_KEY
github:
  - GITHUB_TOKEN_ONE
  - GITHUB_TOKEN_TWO
```

Providers that require multiple values use a single colon-delimited entry:

```yaml
censys:
  - API_ID:API_SECRET
fofa:
  - EMAIL:API_KEY
intelx:
  - 2.intelx.io:API_KEY
```

Do not add unused placeholder values. Subfinder selects configured keys at run
time, and a provider can reject or throttle invalid credentials.
