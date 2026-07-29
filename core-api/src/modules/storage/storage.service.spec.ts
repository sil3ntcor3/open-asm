import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { RustFsClient } from './rustfs.client';
import { StorageService } from './storage.service';

/** An S3 error that means "the bucket is not there" — recoverable by creating it. */
const missingBucketError = () =>
  new S3ServiceException({
    name: 'NoSuchBucket',
    $fault: 'client',
    $metadata: { httpStatusCode: 404 },
  });

/**
 * What an unreachable backend actually looks like: a transport failure, not an
 * S3 error. This is the case that used to be misread as "nothing to do".
 */
const unreachableError = () =>
  Object.assign(new Error('getaddrinfo ENOTFOUND rustfs'), {
    code: 'ENOTFOUND',
  });

const buildService = (send: jest.Mock) => {
  const rustFsClient = {
    getClient: () => ({ send }),
  } as unknown as RustFsClient;
  const configService = {
    get: jest.fn().mockReturnValue('test-secret'),
  } as unknown as ConfigService;

  return new StorageService(rustFsClient, configService);
};

const commandsOfType = (
  send: jest.Mock,
  type: abstract new (...args: never[]) => object,
): unknown[][] =>
  (send.mock.calls as unknown[][]).filter(
    ([command]) => command instanceof type,
  );

describe('StorageService bucket provisioning', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not fail startup when the storage backend is not up yet', async () => {
    const send = jest.fn().mockRejectedValue(unreachableError());
    const service = buildService(send);

    // Storage coming up after the API is normal in compose; it must not take
    // the API down, and it must not be the only chance to create the buckets.
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('provisions the bucket on first write after startup provisioning failed', async () => {
    // Boot with storage unreachable — the pre-fix failure mode, where buckets
    // were never created again for the lifetime of the process and every job
    // result upload then failed with NoSuchBucket.
    const send = jest.fn().mockRejectedValue(unreachableError());
    const service = buildService(send);
    await service.onModuleInit();

    // Storage comes up.
    send.mockReset();
    send.mockImplementation((command: unknown) => {
      if (command instanceof HeadBucketCommand) throw missingBucketError();
      return Promise.resolve({});
    });

    await expect(
      service.uploadFile('result.json', Buffer.from('{}'), 'job-results'),
    ).resolves.toEqual({ path: 'job-results/result.json' });

    expect(commandsOfType(send, CreateBucketCommand)).toHaveLength(1);
    expect(commandsOfType(send, PutObjectCommand)).toHaveLength(1);
  });

  it('keeps an unreachable backend retryable instead of caching it as ready', async () => {
    const send = jest.fn().mockRejectedValue(unreachableError());
    const service = buildService(send);

    await expect(
      service.uploadFile('result.json', Buffer.from('{}'), 'job-results'),
    ).rejects.toThrow(/Failed to save file/);

    // Recovery must not require a restart.
    send.mockReset();
    send.mockResolvedValue({});

    await expect(
      service.uploadFile('result.json', Buffer.from('{}'), 'job-results'),
    ).resolves.toEqual({ path: 'job-results/result.json' });
    expect(commandsOfType(send, HeadBucketCommand)).toHaveLength(1);
  });

  it('checks a bucket once and reuses the result for later writes', async () => {
    const send = jest.fn().mockResolvedValue({});
    const service = buildService(send);

    await service.uploadFile('a.json', Buffer.from('{}'), 'job-results');
    await service.uploadFile('b.json', Buffer.from('{}'), 'job-results');

    // The recovery path must not put a HeadBucket round trip in front of every
    // upload once the bucket is known to exist.
    expect(commandsOfType(send, HeadBucketCommand)).toHaveLength(1);
    expect(commandsOfType(send, PutObjectCommand)).toHaveLength(2);
  });

  it('treats a bucket created concurrently as success', async () => {
    const send = jest.fn().mockImplementation((command: unknown) => {
      if (command instanceof HeadBucketCommand) throw missingBucketError();
      if (command instanceof CreateBucketCommand) {
        throw new S3ServiceException({
          name: 'BucketAlreadyOwnedByYou',
          $fault: 'client',
          $metadata: { httpStatusCode: 409 },
        });
      }
      return Promise.resolve({});
    });
    const service = buildService(send);

    await expect(
      service.uploadFile('result.json', Buffer.from('{}'), 'job-results'),
    ).resolves.toEqual({ path: 'job-results/result.json' });
  });

  it('provisions each bucket only once across concurrent writes', async () => {
    const send = jest.fn().mockImplementation((command: unknown) => {
      if (command instanceof HeadBucketCommand) throw missingBucketError();
      return Promise.resolve({});
    });
    const service = buildService(send);

    await Promise.all([
      service.uploadFile('a.json', Buffer.from('{}'), 'job-results'),
      service.uploadFile('b.json', Buffer.from('{}'), 'job-results'),
      service.uploadFile('c.json', Buffer.from('{}'), 'job-results'),
    ]);

    expect(commandsOfType(send, CreateBucketCommand)).toHaveLength(1);
    expect(commandsOfType(send, PutObjectCommand)).toHaveLength(3);
  });
});
