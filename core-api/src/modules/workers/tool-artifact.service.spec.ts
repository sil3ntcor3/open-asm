import type { ConfigService } from '@nestjs/config';
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
  let service: ToolArtifactService;

  beforeEach(() => {
    archiveRoot = mkdtempSync(join(tmpdir(), 'oasm-artifacts-'));
    const platformRoot = join(archiveRoot, 'linux_amd64');
    mkdirSync(platformRoot);
    writeFileSync(join(platformRoot, 'httpx.zip'), 'archive');
    symlinkSync('/etc/passwd', join(platformRoot, 'escape.zip'));
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
      realpathSync(join(archiveRoot, 'linux_amd64', 'httpx.zip')),
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

  it('changes the opaque ID when artifact contents change', async () => {
    const [firstId] = await service.listArtifacts('linux', 'amd64');
    writeFileSync(join(archiveRoot, 'linux_amd64', 'httpx.zip'), 'new archive');

    const [secondId] = await service.listArtifacts('linux', 'amd64');

    expect(secondId).not.toEqual(firstId);
    await expect(service.resolveArtifact(firstId)).rejects.toThrow(
      'Unknown tool artifact',
    );
  });

  it('rejects an artifact changed after its manifest ID was issued', async () => {
    const [artifactId] = await service.listArtifacts('linux', 'amd64');
    writeFileSync(join(archiveRoot, 'linux_amd64', 'httpx.zip'), 'tampered');

    await expect(service.resolveArtifact(artifactId)).rejects.toThrow(
      'Unknown tool artifact',
    );
  });

  it('serves Nuclei only when its filename and digest match the release manifest', async () => {
    const platformRoot = join(archiveRoot, 'linux_amd64');
    writeFileSync(
      join(platformRoot, 'nuclei_3.11.0_linux_amd64.zip'),
      'nuclei archive',
    );

    await expect(service.listArtifacts('linux', 'amd64')).resolves.toHaveLength(
      1,
    );

    const { createHash } = await import('node:crypto');
    const digest = createHash('sha256').update('nuclei archive').digest('hex');
    writeFileSync(
      join(archiveRoot, 'nuclei-manifest.json'),
      JSON.stringify({
        artifacts: {
          linux_amd64: {
            file: 'nuclei_3.11.0_linux_amd64.zip',
            sha256: digest,
          },
        },
      }),
    );

    await expect(service.listArtifacts('linux', 'amd64')).resolves.toHaveLength(
      2,
    );
    writeFileSync(
      join(platformRoot, 'nuclei_3.11.0_linux_amd64.zip'),
      'tampered nuclei',
    );
    await expect(service.listArtifacts('linux', 'amd64')).resolves.toHaveLength(
      1,
    );
  });
});
