import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../../../../');
const textExtensions = new Set([
  '.json',
  '.md',
  '.ts',
  '.tsx',
  '.go',
  '.mod',
  '.sh',
  '.ps1',
  '.yml',
  '.yaml',
]);

/**
 * Lists the repository's *tracked* text files.
 *
 * Walking the filesystem instead (the previous approach) skipped only .git,
 * node_modules and dist, so it descended into any other untracked directory that
 * happened to exist in a developer's checkout — scratch dirs, build output, and
 * in particular `.claude/worktrees`, which holds checkouts of pre-fork commits
 * that legitimately still carry upstream references. That made the assertion
 * below fail locally while passing in CI, where only tracked files are present.
 *
 * Driving the list from `git ls-files` scopes the check to what the repository
 * actually ships, which is the only thing this assertion is about, and cannot be
 * fooled by whatever else is lying around on disk.
 */
const collectTextFiles = (): string[] =>
  execFileSync('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((entry) => entry !== '' && textExtensions.has(extname(entry)))
    .map((entry) => resolve(repositoryRoot, entry))
    // git lists files that are tracked but deleted in the working tree; reading
    // those would throw ENOENT rather than report a meaningful failure.
    .filter((path) => existsSync(path));

describe('fork release identity', () => {
  it('uses a repository-owned semantic version instead of inherited tags', () => {
    const versionPath = resolve(repositoryRoot, 'VERSION');
    expect(existsSync(versionPath)).toBe(true);
    if (!existsSync(versionPath)) return;

    expect(readFileSync(versionPath, 'utf8').trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const workflow = readFileSync(
      resolve(repositoryRoot, '.github/workflows/build-myoasm-images.yml'),
      'utf8',
    );
    expect(workflow).toContain('VERSION');
    expect(workflow).toContain('- "VERSION"');
    expect(workflow).not.toContain('git describe');
  });

  it('contains no source or documentation references to the upstream repository', () => {
    const upstreamRepository = ['oasm-platform', 'open-asm'].join('/');
    const offendingFiles = collectTextFiles().filter((path) =>
      readFileSync(path, 'utf8').includes(upstreamRepository),
    );

    expect(offendingFiles).toEqual([]);
  });
});
