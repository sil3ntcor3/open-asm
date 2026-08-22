import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolArtifactService } from './tool-artifact.service';

describe('ToolArtifactService', () => {
  let archiveRoot: string;
  let platformRoot: string;
  let service: ToolArtifactService;

  const digestOf = (contents: string): string =>
    createHash('sha256').update(contents).digest('hex');

  const writeArchive = (fileName: string, contents: string): void => {
    writeFileSync(join(platformRoot, fileName), contents);
  };

  const declare = (
    declarations: Record<string, { file: string; sha256: string }>,
  ): void => {
    writeFileSync(
      join(archiveRoot, 'tool-manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        tools: Object.fromEntries(
          Object.entries(declarations).map(([tool, declaration]) => [
            tool,
            { version: '1.0.0', artifacts: { linux_amd64: declaration } },
          ]),
        ),
      }),
    );
  };

  beforeEach(() => {
    archiveRoot = mkdtempSync(join(tmpdir(), 'oasm-artifacts-'));
    platformRoot = join(archiveRoot, 'linux_amd64');
    mkdirSync(platformRoot);
    writeArchive('httpx_1.10.0_linux_amd64.zip', 'archive');
    symlinkSync('/etc/passwd', join(platformRoot, 'escape.zip'));
    declare({
      httpx: {
        file: 'httpx_1.10.0_linux_amd64.zip',
        sha256: digestOf('archive'),
      },
    });
    service = new ToolArtifactService({
      get: jest.fn().mockReturnValue(archiveRoot),
    } as unknown as ConfigService);
  });

  afterEach(() => {
    rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('returns opaque manifest IDs and resolves them beneath the archive root', async () => {
    const artifactIds = await service.listArtifacts('linux', 'amd64');

    expect(artifactIds).toHaveLength(1);
    expect(artifactIds[0]).toMatch(/^[a-f0-9]{64}\.zip$/);
    await expect(service.resolveArtifact(artifactIds[0])).resolves.toEqual(
      realpathSync(join(platformRoot, 'httpx_1.10.0_linux_amd64.zip')),
    );
  });

  it('rejects traversal strings, unknown IDs, and symlink artifacts', async () => {
    await service.listArtifacts('linux', 'amd64');

    await expect(service.resolveArtifact('../../etc/passwd')).rejects.toThrow(
      'Unknown tool artifact',
    );
    await expect(
      service.resolveArtifact('0'.repeat(64) + '.zip'),
    ).rejects.toThrow('Unknown tool artifact');
  });

  it('rejects an artifact changed after its manifest ID was issued', async () => {
    const [artifactId] = await service.listArtifacts('linux', 'amd64');
    writeArchive('httpx_1.10.0_linux_amd64.zip', 'tampered');

    await expect(service.resolveArtifact(artifactId)).rejects.toThrow(
      'Unknown tool artifact',
    );
  });

  it('serves every tool only at the filename and digest the manifest declares', async () => {
    writeArchive('nuclei_3.11.1_linux_amd64.zip', 'nuclei archive');

    // Present in the image but undeclared: never served.
    await expect(service.listArtifacts('linux', 'amd64')).resolves.toHaveLength(
      1,
    );

    declare({
      httpx: {
        file: 'httpx_1.10.0_linux_amd64.zip',
        sha256: digestOf('archive'),
      },
      nuclei: {
        file: 'nuclei_3.11.1_linux_amd64.zip',
        sha256: digestOf('nuclei archive'),
      },
    });
    await expect(service.listArtifacts('linux', 'amd64')).resolves.toHaveLength(
      2,
    );

    // Same declared filename, different bytes: dropped again.
    writeArchive('nuclei_3.11.1_linux_amd64.zip', 'tampered nuclei');
    await expect(service.listArtifacts('linux', 'amd64')).resolves.toHaveLength(
      1,
    );
  });

  it('serves nothing when the manifest is missing or unreadable', async () => {
    rmSync(join(archiveRoot, 'tool-manifest.json'));

    await expect(service.listArtifacts('linux', 'amd64')).resolves.toEqual([]);

    writeFileSync(join(archiveRoot, 'tool-manifest.json'), 'not json');
    await expect(service.listArtifacts('linux', 'amd64')).resolves.toEqual([]);
  });

  it('ignores declarations made for a different platform', async () => {
    writeFileSync(
      join(archiveRoot, 'tool-manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        tools: {
          httpx: {
            version: '1.10.0',
            artifacts: {
              linux_arm64: {
                file: 'httpx_1.10.0_linux_amd64.zip',
                sha256: digestOf('archive'),
              },
            },
          },
        },
      }),
    );

    await expect(service.listArtifacts('linux', 'amd64')).resolves.toEqual([]);
  });
});
