import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Stats } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

const PLATFORM_PART = /^[a-z0-9_-]+$/;
const ARTIFACT_ID = /^[a-f0-9]{64}(?:\.zip|\.tgz|\.tar\.gz)$/;

interface ToolArtifactDeclaration {
  file?: string;
  sha256?: string;
}

interface ToolArtifactManifest {
  tools?: Record<
    string,
    { artifacts?: Record<string, ToolArtifactDeclaration> }
  >;
}

@Injectable()
export class ToolArtifactService {
  private readonly logger = new Logger(ToolArtifactService.name);
  private readonly archiveRoot: string;
  private readonly artifacts = new Map<string, string>();
  private readonly reportedRejections = new Set<string>();

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
    const platform = `${normalizedOs}_${normalizedArch}`;
    const declarations = await this.declaredArtifacts(platform);
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

      // Only archives the pinned manifest declares for this platform, at the
      // exact digest it declares, are ever handed to a worker: an archive
      // dropped into the image out of band is inert.
      const contentHash = await this.hashArtifact(realCandidate);
      if (declarations.get(entry.name) !== contentHash) {
        this.reportRejection(platform, entry.name);
        continue;
      }
      const artifactId = `${contentHash}${extension}`;
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

  /**
   * Reads the pinned manifest that ships beside the archives and returns the
   * artifacts declared for one platform, keyed by file name. An unreadable
   * manifest declares nothing, which fails closed: workers receive no tools
   * rather than unverified ones.
   */
  private async declaredArtifacts(
    platform: string,
  ): Promise<Map<string, string>> {
    const declarations = new Map<string, string>();
    let manifest: ToolArtifactManifest;
    try {
      manifest = JSON.parse(
        await readFile(resolve(this.archiveRoot, 'tool-manifest.json'), 'utf8'),
      ) as ToolArtifactManifest;
    } catch (error) {
      this.reportOnce(
        'manifest',
        `Tool artifact manifest is unreadable, no tools will be served: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return declarations;
    }

    for (const tool of Object.values(manifest.tools ?? {})) {
      const declaration = tool.artifacts?.[platform];
      if (declaration?.file && declaration.sha256) {
        declarations.set(declaration.file, declaration.sha256.toLowerCase());
      }
    }
    return declarations;
  }

  private reportRejection(platform: string, fileName: string): void {
    this.reportOnce(
      `${platform}/${fileName}`,
      `Archive ${platform}/${fileName} is not declared in tool-manifest.json at its current digest and will not be served`,
    );
  }

  private reportOnce(key: string, message: string): void {
    if (this.reportedRejections.has(key)) {
      return;
    }
    this.reportedRejections.add(key);
    this.logger.warn(message);
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
    return extension === '.zip' || extension === '.tgz' ? extension : undefined;
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
