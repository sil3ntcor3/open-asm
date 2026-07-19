import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Stats } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

const PLATFORM_PART = /^[a-z0-9_-]+$/;
const ARTIFACT_ID = /^[a-f0-9]{64}(?:\.zip|\.tgz|\.tar\.gz)$/;

@Injectable()
export class ToolArtifactService {
  private readonly archiveRoot: string;
  private readonly artifacts = new Map<string, string>();

  constructor(configService: ConfigService) {
    this.archiveRoot = resolve(
      configService.get<string>('TOOL_ARCHIVE_ROOT') ??
        resolve(process.cwd(), 'public/archived'),
    );
  }

  async listArtifacts(os: string, arch: string): Promise<string[]> {
    const normalizedOs = os.toLowerCase();
    const normalizedArch = arch.toLowerCase();
    if (
      !PLATFORM_PART.test(normalizedOs) ||
      !PLATFORM_PART.test(normalizedArch)
    ) {
      return [];
    }

    let realArchiveRoot: string;
    let platformRoot: string;
    try {
      realArchiveRoot = await realpath(this.archiveRoot);
      platformRoot = await realpath(
        resolve(realArchiveRoot, `${normalizedOs}_${normalizedArch}`),
      );
    } catch {
      return [];
    }

    if (!this.isWithin(realArchiveRoot, platformRoot)) {
      return [];
    }

    const entries = await readdir(platformRoot, { withFileTypes: true });
    const artifactIds: string[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        continue;
      }

      const extension = this.archiveExtension(entry.name);
      if (!extension) {
        continue;
      }

      const candidate = resolve(platformRoot, entry.name);
      const candidateStats = await lstat(candidate);
      const realCandidate = await realpath(candidate);
      if (
        candidateStats.isSymbolicLink() ||
        !candidateStats.isFile() ||
        !this.isWithin(realArchiveRoot, realCandidate)
      ) {
        continue;
      }

      const artifactId = `${await this.hashArtifact(realCandidate)}${extension}`;
      for (const [existingId, existingPath] of this.artifacts) {
        if (existingPath === realCandidate && existingId !== artifactId) {
          this.artifacts.delete(existingId);
        }
      }
      this.artifacts.set(artifactId, realCandidate);
      artifactIds.push(artifactId);
    }

    return artifactIds.sort();
  }

  async resolveArtifact(artifactId: string): Promise<string> {
    if (!ARTIFACT_ID.test(artifactId)) {
      throw new Error('Unknown tool artifact');
    }

    const storedPath = this.artifacts.get(artifactId);
    if (!storedPath) {
      throw new Error('Unknown tool artifact');
    }

    let realArchiveRoot: string;
    let realCandidate: string;
    let candidateStats: Stats;
    let contentHash: string;
    try {
      [realArchiveRoot, realCandidate, candidateStats, contentHash] =
        await Promise.all([
          realpath(this.archiveRoot),
          realpath(storedPath),
          lstat(storedPath),
          this.hashArtifact(storedPath),
        ]);
    } catch {
      this.artifacts.delete(artifactId);
      throw new Error('Unknown tool artifact');
    }
    if (
      candidateStats.isSymbolicLink() ||
      !candidateStats.isFile() ||
      !this.isWithin(realArchiveRoot, realCandidate) ||
      !artifactId.startsWith(contentHash)
    ) {
      this.artifacts.delete(artifactId);
      throw new Error('Unknown tool artifact');
    }

    return realCandidate;
  }

  private archiveExtension(fileName: string): string | undefined {
    if (fileName.endsWith('.tar.gz')) {
      return '.tar.gz';
    }
    const extension = extname(fileName);
    return extension === '.zip' || extension === '.tgz'
      ? extension
      : undefined;
  }

  private hashArtifact(filePath: string): Promise<string> {
    return new Promise((resolveHash, rejectHash) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (chunk: Buffer) => hash.update(chunk));
      stream.on('end', () => resolveHash(hash.digest('hex')));
      stream.on('error', rejectHash);
    });
  }

  private isWithin(root: string, candidate: string): boolean {
    const pathFromRoot = relative(root, candidate);
    return (
      pathFromRoot !== '' &&
      pathFromRoot !== '..' &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !pathFromRoot.startsWith(sep)
    );
  }
}
