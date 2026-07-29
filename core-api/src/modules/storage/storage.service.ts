import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
  StreamableFile,
} from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { createHmac, randomBytes } from 'crypto';
import { DEFAULT_ENCRYPTION_KEY } from '@/common/constants/app.constants';
import { ConfigService } from '@nestjs/config';
import { RustFsClient } from './rustfs.client';
import { Readable } from 'stream';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly buckets = [
    'system',
    'screenshot',
    'nuclei-templates',
    'job-results',
    'cached-static',
    'reports',
    'default',
  ];

  private readonly privateBuckets = ['reports', 'job-results'];

  private readonly downloadSecret: string;

  constructor(
    private readonly rustFsClient: RustFsClient,
    private readonly configService: ConfigService,
  ) {
    this.downloadSecret = this.configService.get<string>('DEFAULT_ENCRYPTION_KEY', DEFAULT_ENCRYPTION_KEY);
  }

  /**
   * Buckets confirmed to exist. Purely a cache to keep the happy path free of
   * extra round trips — a bucket is only added here once it has been observed
   * or created, never optimistically.
   */
  private readonly readyBuckets = new Set<string>();

  /** In-flight provisioning per bucket, so concurrent writes check once. */
  private readonly bucketProvisioning = new Map<string, Promise<void>>();

  /**
   * Best-effort warm-up. Provisioning also happens lazily on first use, so a
   * storage backend that is slow to start, or not up yet, costs nothing here:
   * the failure is logged and the next write re-attempts it.
   *
   * This used to be the ONLY attempt. When storage was unreachable at boot the
   * error was not a 404, so it fell through to a bare log and the buckets were
   * never created again for the lifetime of the process — every job result
   * upload then failed with NoSuchBucket, surfacing to workers as an opaque
   * "Internal server error" while the container still reported healthy.
   */
  async onModuleInit() {
    await this.ensureBucketsExist();
  }

  public isPrivateBucket(bucket: string): boolean {
    return this.privateBuckets.includes(bucket);
  }

  private async ensureBucketsExist() {
    await Promise.all(
      this.buckets.map(async (bucket) => {
        try {
          await this.ensureBucket(bucket);
        } catch (error) {
          this.logger.warn(
            `Deferred provisioning of bucket ${bucket}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }),
    );
  }

  /**
   * Guarantees the bucket exists before it is written to, retrying on every
   * call until it succeeds. Resolves immediately once known-good.
   *
   * Throws when storage is unreachable rather than marking the bucket ready, so
   * a transient outage stays retryable instead of being cached as success.
   */
  private async ensureBucket(bucket: string): Promise<void> {
    if (this.readyBuckets.has(bucket)) {
      return;
    }

    const inFlight = this.bucketProvisioning.get(bucket);
    if (inFlight) {
      return inFlight;
    }

    const provisioning = this.provisionBucket(bucket).finally(() => {
      this.bucketProvisioning.delete(bucket);
    });
    this.bucketProvisioning.set(bucket, provisioning);
    return provisioning;
  }

  private async provisionBucket(bucket: string): Promise<void> {
    const client = this.rustFsClient.getClient();

    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      this.readyBuckets.add(bucket);
      return;
    } catch (error) {
      // Anything other than "it isn't there" (connection refused, DNS failure,
      // auth) says nothing about whether the bucket exists. Propagate so the
      // caller reports a retryable failure and we try again next time.
      if (!this.isMissingBucketError(error)) {
        throw error;
      }
    }

    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      this.logger.log(`Created bucket: ${bucket}`);
    } catch (createError) {
      // Another replica winning the race is success, not failure.
      if (!this.isBucketAlreadyPresentError(createError)) {
        throw createError;
      }
      this.logger.debug(`Bucket already exists: ${bucket}`);
    }

    this.readyBuckets.add(bucket);
  }

  private isMissingBucketError(error: unknown): boolean {
    return (
      error instanceof S3ServiceException &&
      (error.$metadata.httpStatusCode === 404 || error.name === 'NoSuchBucket')
    );
  }

  private isBucketAlreadyPresentError(error: unknown): boolean {
    return (
      error instanceof S3ServiceException &&
      (error.name === 'BucketAlreadyExists' ||
        error.name === 'BucketAlreadyOwnedByYou')
    );
  }

  public async uploadFile(
    fileName: string,
    buffer: Buffer,
    bucket: string = 'default',
  ) {
    try {
      // Provision on demand. Startup warm-up is best-effort, so this is what
      // actually guarantees the bucket exists — and what lets the service
      // recover on its own when storage comes up after the API does.
      await this.ensureBucket(bucket);

      const key = `${bucket}/${fileName}`;
      await this.rustFsClient.getClient().send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: fileName,
          Body: buffer,
        }),
      );
      return { path: key };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(
        `Failed to save file: ${errorMessage}`,
      );
    }
  }

  public async getFile(filePath: string, bucket: string = 'default'): Promise<StreamableFile> {
    const cleanPath = filePath.replace(/^[./\s]+/, '');

    if (!cleanPath || cleanPath.includes('..')) {
      throw new NotFoundException('File not found');
    }

    try {
      const response = await this.rustFsClient.getClient().send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: cleanPath,
        }),
      );

      if (!response.Body) {
        throw new NotFoundException('File not found');
      }

      const body = response.Body as Readable;
      return new StreamableFile(body);
    } catch (error: unknown) {
      if (error instanceof S3ServiceException && (error.name === 'NoSuchKey' || error.$metadata.httpStatusCode === 404)) {
        throw new NotFoundException('File not found');
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(
        `Failed to get file: ${errorMessage}`,
      );
    }
  }

  public generateDownloadToken(
    filePath: string,
    bucket: string = 'default',
    expiresIn: number = 900,
  ): string {
    const cleanPath = filePath.replace(/^[./\s]+/, '');

    if (!cleanPath || cleanPath.includes('..')) {
      throw new BadRequestException('Invalid file path');
    }

    const exp = Math.floor(Date.now() / 1000) + expiresIn;
    const nonce = randomBytes(16).toString('hex');
    const payload = `${bucket}:${cleanPath}:${exp}:${nonce}`;
    const signature = createHmac('sha256', this.downloadSecret)
      .update(payload)
      .digest('hex');

    return Buffer.from(`${payload}:${signature}`).toString('base64url');
  }

  public verifyDownloadToken(
    token: string,
  ): { bucket: string; filePath: string } {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const parts = decoded.split(':');
      if (parts.length !== 5) {
        throw new Error('Invalid token format');
      }

      const [bucket, filePath, expStr, nonce, signature] = parts;
      const exp = parseInt(expStr, 10);

      if (Math.floor(Date.now() / 1000) > exp) {
        throw new Error('Token expired');
      }

      const payload = `${bucket}:${filePath}:${expStr}:${nonce}`;
      const expectedSignature = createHmac('sha256', this.downloadSecret)
        .update(payload)
        .digest('hex');

      if (signature !== expectedSignature) {
        throw new Error('Invalid signature');
      }

      return { bucket, filePath };
    } catch {
      throw new BadRequestException('Invalid or expired download token');
    }
  }

  public async deleteFile(filePath: string, bucket: string = 'default'): Promise<void> {
    const cleanPath = filePath.replace(/^[./\s]+/, '');

    if (!cleanPath || cleanPath.includes('..')) {
      throw new NotFoundException('File not found');
    }

    try {
      await this.rustFsClient.getClient().send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: cleanPath,
        }),
      );
    } catch (error: unknown) {
      if (error instanceof S3ServiceException && (error.name === 'NoSuchKey' || error.$metadata.httpStatusCode === 404)) {
        throw new NotFoundException('File not found');
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(
        `Failed to delete file: ${errorMessage}`,
      );
    }
  }

  public async forwardImage(
    url: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    try {
      new URL(url);
    } catch (err) {
      Logger.error(err);
      throw new BadRequestException('Invalid URL format');
    }

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new NotFoundException('Image not found at the provided URL');
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        throw new BadRequestException(
          'The provided URL does not point to an image',
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return { buffer, contentType };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new BadRequestException(
        'Failed to fetch image from the provided URL',
      );
    }
  }

  public async readJsonFile<T>(
    filePath: string,
    bucket: string = 'default',
  ): Promise<T> {
    const cleanPath = filePath.replace(/^[./\s]+/, '');

    if (!cleanPath || cleanPath.includes('..')) {
      throw new NotFoundException('File not found');
    }

    try {
      const response = await this.rustFsClient.getClient().send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: cleanPath,
        }),
      );

      if (!response.Body) {
        throw new NotFoundException('File not found');
      }

      const body = response.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of body) {
        chunks.push(Buffer.from(chunk));
      }
      const content = Buffer.concat(chunks).toString('utf8');
      return JSON.parse(content) as T;
    } catch (error: unknown) {
      if (error instanceof S3ServiceException && (error.name === 'NoSuchKey' || error.$metadata.httpStatusCode === 404)) {
        throw new NotFoundException('File not found');
      }
      if (error instanceof SyntaxError) {
        throw new InternalServerErrorException(
          `Failed to parse JSON file: ${error.message}`,
        );
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      throw new InternalServerErrorException(
        `Failed to read or parse JSON file: ${errorMessage}`,
      );
    }
  }
}
