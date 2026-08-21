import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const installerSource = path.join(repositoryRoot, 'scripts', 'install.sh');
const fixtures = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('installer passes credentials only through the provisioner stdin', () => {
  assert.ok(existsSync(installerSource), 'scripts/install.sh is missing');

  const fixture = mkdtempSync(path.join(tmpdir(), 'open-asm-install-test-'));
  fixtures.push(fixture);
  const scriptsDirectory = path.join(fixture, 'scripts');
  const fakeBinDirectory = path.join(fixture, 'bin');
  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(fakeBinDirectory, { recursive: true });
  for (const service of ['core-api', 'console', 'worker']) {
    const serviceDirectory = path.join(fixture, service);
    mkdirSync(serviceDirectory, { recursive: true });
    writeFileSync(path.join(serviceDirectory, '.env'), '');
  }

  const installer = path.join(scriptsDirectory, 'install.sh');
  copyFileSync(installerSource, installer);
  chmodSync(installer, 0o755);

  const dockerLog = path.join(fixture, 'docker.log');
  const provisionerInput = path.join(fixture, 'provisioner-input');
  const fakeDocker = path.join(fakeBinDirectory, 'docker');
  writeFileSync(
    fakeDocker,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$OASM_TEST_DOCKER_LOG"
case "$*" in
  *admin-provisioner*) cat > "$OASM_TEST_PROVISIONER_INPUT" ;;
esac
`,
  );
  chmodSync(fakeDocker, 0o755);

  const password = 'correct horse battery staple';
  const result = spawnSync(installer, ['--no-build'], {
    cwd: fixture,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBinDirectory}:${process.env.PATH ?? ''}`,
      OASM_TEST_DOCKER_LOG: dockerLog,
      OASM_TEST_PROVISIONER_INPUT: provisionerInput,
    },
    input: `admin@example.com\n${password}\n${password}\n`,
  });

  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const commands = readFileSync(dockerLog, 'utf8');
  assert.doesNotMatch(commands, new RegExp(password));
  assert.match(
    commands,
    /compose .*--profile setup run --rm -T --no-deps admin-provisioner/,
  );
  assert.equal(
    readFileSync(provisionerInput, 'utf8'),
    `admin@example.com\n${password}\n`,
  );
});
