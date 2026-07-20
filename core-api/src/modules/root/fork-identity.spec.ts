import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

const collectTextFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    if (entry === '.git' || entry === 'node_modules' || entry === 'dist') {
      return [];
    }
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return collectTextFiles(path);
    return textExtensions.has(extname(path)) ? [path] : [];
  });

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
    const offendingFiles = collectTextFiles(repositoryRoot).filter((path) =>
      readFileSync(path, 'utf8').includes(upstreamRepository),
    );

    expect(offendingFiles).toEqual([]);
  });
});
