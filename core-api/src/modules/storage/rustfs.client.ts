import { S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Explains why an access key cannot work, or returns undefined if it looks fine.
 *
 * The access key travels inside the SigV4 header as
 * `Credential=<key>/<date>/<region>/s3/aws4_request`, so a `/` in the key
 * shifts every field and RustFS rejects all requests with HTTP 403
 * "Invalid SigV4 authorization header". `openssl rand -base64` output
 * routinely contains one. The secret key is only used for signing and may
 * contain any character.
 */
export function describeAccessKeyProblem(
  accessKey: string,
): string | undefined {
  if (accessKey.includes('/')) {
    return (
      'RUSTFS_ACCESS_KEY contains "/", which RustFS cannot parse; every ' +
      'storage request will fail with HTTP 403. Use letters and digits only ' +
      '(e.g. `openssl rand -hex 16`) and recreate the api and rustfs containers.'
    );
  }
  return undefined;
}

@Injectable()
export class RustFsClient {
  private readonly logger = new Logger(RustFsClient.name);
  private readonly client: S3Client;

  /** Set when the configured credentials are known to be unusable. */
  readonly configProblem: string | undefined;

  constructor(private readonly configService: ConfigService) {
    const accessKeyId = this.configService.get<string>(
      'RUSTFS_ACCESS_KEY',
      'rustfsadmin',
    );

    this.configProblem = describeAccessKeyProblem(accessKeyId);
    if (this.configProblem) {
      // Not fatal: the rest of the API still works without object storage.
      this.logger.error(this.configProblem);
    }

    this.client = new S3Client({
      endpoint: this.configService.get<string>(
        'RUSTFS_ENDPOINT',
        'http://localhost:9000',
      ),
      region: 'us-east-1',
      credentials: {
        accessKeyId,
        secretAccessKey: this.configService.get<string>(
          'RUSTFS_SECRET_KEY',
          'rustfssecret',
        ),
      },
      forcePathStyle: true,
    });
  }

  getClient(): S3Client {
    return this.client;
  }
}
