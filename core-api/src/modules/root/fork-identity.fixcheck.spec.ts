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

// Only tracked files are inspected. Walking the filesystem instead would descend
// into untracked scratch directories such as .claude/worktrees, where checkouts of
// pre-fork commits legitimately still carry upstream references.
const collectTextFiles = (): string[] =>
  execFileSync('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((entry) => entry !== '' && textExtensions.has(extname(entry)))
    .map((entry) => resolve(repositoryRoot, entry))
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
