import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test, { after } from "node:test";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const primaryComposeSource = path.join(repositoryRoot, "docker-compose.yml");
const developmentComposeSource = path.join(
  repositoryRoot,
  "docker-compose.dev.yml",
);
const credentialValidator = path.join(
  repositoryRoot,
  "scripts",
  "validate-compose-secrets.sh",
);
const composeFixtureRoot = mkdtempSync(
  path.join(tmpdir(), "open-asm-compose-security-"),
);
const primaryCompose = path.join(composeFixtureRoot, "docker-compose.yml");
const developmentCompose = path.join(
  composeFixtureRoot,
  "docker-compose.dev.yml",
);

for (const serviceDirectory of ["console", "core-api", "worker"]) {
  const directory = path.join(composeFixtureRoot, serviceDirectory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, ".env"), "");
}
copyFileSync(primaryComposeSource, primaryCompose);
copyFileSync(developmentComposeSource, developmentCompose);

after(() => {
  rmSync(composeFixtureRoot, { recursive: true, force: true });
});

const managedSecrets = [
  "POSTGRES_PASSWORD",
  "REDIS_PASSWORD",
  "RUSTFS_ACCESS_KEY",
  "RUSTFS_SECRET_KEY",
];

const generatedCredentials = {
  POSTGRES_PASSWORD: "p".repeat(40),
  REDIS_PASSWORD: "r".repeat(40),
  RUSTFS_ACCESS_KEY: "access-key-unique-2026",
  RUSTFS_SECRET_KEY: "s".repeat(40),
};

function testEnvironment(overrides = {}) {
  const environment = { ...process.env };
  for (const name of managedSecrets) {
    delete environment[name];
  }

  return {
    ...environment,
    WORKER_ENROLLMENT_TOKEN: "worker-token-".padEnd(40, "w"),
    ...overrides,
  };
}

function renderCompose(files, environment) {
  const args = ["compose", "--project-directory", composeFixtureRoot];
  for (const file of files) {
    args.push("--file", file);
  }
  args.push("config", "--format", "json");

  return spawnSync("docker", args, {
    cwd: composeFixtureRoot,
    encoding: "utf8",
    env: environment,
  });
}

function requireRenderedCompose(files, environment) {
  const result = renderCompose(files, environment);
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

function runCredentialValidator(credentials) {
  return spawnSync("/bin/sh", [credentialValidator], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: testEnvironment(credentials),
  });
}

test("primary Compose keeps stateful services off host interfaces", () => {
  const config = requireRenderedCompose(
    [primaryCompose],
    testEnvironment(generatedCredentials),
  );

  for (const serviceName of ["postgres", "redis", "rustfs"]) {
    assert.deepEqual(config.services[serviceName].ports ?? [], []);
  }
});

test("Compose requires deployment-specific stateful-service credentials", () => {
  for (const name of managedSecrets) {
    const incompleteCredentials = { ...generatedCredentials };
    delete incompleteCredentials[name];
    const result = renderCompose(
      [primaryCompose],
      testEnvironment(incompleteCredentials),
    );

    assert.notEqual(result.status, 0, `${name} was not required`);
    assert.match(result.stderr, new RegExp(name));
  }
});

test("credential policy rejects shipped defaults and accepts generated values", () => {
  const formerDefaults = {
    POSTGRES_PASSWORD: "postgres",
    REDIS_PASSWORD: "password",
    RUSTFS_ACCESS_KEY: "rustfsadmin",
    RUSTFS_SECRET_KEY: "rustfssecret",
  };

  const generatedResult = runCredentialValidator(generatedCredentials);
  assert.equal(
    generatedResult.status,
    0,
    generatedResult.stderr || generatedResult.error?.message,
  );

  for (const [name, value] of Object.entries(formerDefaults)) {
    const result = runCredentialValidator({
      ...generatedCredentials,
      [name]: value,
    });
    assert.notEqual(result.status, 0, `${name} accepted its shipped default`);
    assert.match(result.stderr, new RegExp(name));
  }
});

test("Compose shares injected credentials across legitimate service clients", () => {
  const config = requireRenderedCompose(
    [primaryCompose],
    testEnvironment(generatedCredentials),
  );
  const services = config.services;

  assert.equal(
    services.postgres.environment.POSTGRES_PASSWORD,
    generatedCredentials.POSTGRES_PASSWORD,
  );
  assert.equal(
    services["core-api"].environment.POSTGRES_PASSWORD,
    generatedCredentials.POSTGRES_PASSWORD,
  );
  assert.equal(
    services.postgres.environment.POSTGRES_HOST_AUTH_METHOD,
    undefined,
  );
  assert.equal(
    services.redis.environment.REDIS_PASSWORD,
    generatedCredentials.REDIS_PASSWORD,
  );
  assert.equal(
    services["core-api"].environment.REDIS_URL,
    `redis://:${generatedCredentials.REDIS_PASSWORD}@redis:6379/0`,
  );
  assert.equal(
    services.migration.environment.REDIS_URL,
    `redis://:${generatedCredentials.REDIS_PASSWORD}@redis:6379/0`,
  );
  assert.equal(
    services.rustfs.environment.RUSTFS_ACCESS_KEY,
    generatedCredentials.RUSTFS_ACCESS_KEY,
  );
  assert.equal(
    services.rustfs.environment.RUSTFS_SECRET_KEY,
    generatedCredentials.RUSTFS_SECRET_KEY,
  );
  assert.equal(
    services["core-api"].environment.RUSTFS_ACCESS_KEY,
    generatedCredentials.RUSTFS_ACCESS_KEY,
  );
  assert.equal(
    services["core-api"].environment.RUSTFS_SECRET_KEY,
    generatedCredentials.RUSTFS_SECRET_KEY,
  );

  for (const serviceName of ["postgres", "redis", "rustfs"]) {
    assert.equal(
      services[serviceName].depends_on["credential-check"].condition,
      "service_completed_successfully",
    );
  }
});

test("development Compose publishes stateful services on loopback only", () => {
  const config = requireRenderedCompose(
    [primaryCompose, developmentCompose],
    testEnvironment(generatedCredentials),
  );

  for (const serviceName of ["postgres", "redis", "rustfs"]) {
    assert.ok(config.services[serviceName].ports.length > 0);
    for (const port of config.services[serviceName].ports) {
      assert.equal(port.host_ip, "127.0.0.1");
    }
  }
});
