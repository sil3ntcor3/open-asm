import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { RustFsClient, describeAccessKeyProblem } from './rustfs.client';

const configWith = (values: Record<string, string>) =>
  ({
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  }) as unknown as ConfigService;

describe('RustFS access key check', () => {
  afterEach(() => jest.restoreAllMocks());

  it('flags a "/" in the access key, which RustFS rejects as an invalid SigV4 header', () => {
    expect(describeAccessKeyProblem('AbCd/Ef0123456789')).toMatch(
      /RUSTFS_ACCESS_KEY contains "\/"/,
    );
  });

  it.each(['AbCdEf0123456789', 'access-key_2026.x~', 'Ab+Cd=Ef0123456789'])(
    'accepts %s (verified to authenticate against RustFS)',
    (key) => {
      expect(describeAccessKeyProblem(key)).toBeUndefined();
    },
  );

  it('logs the problem at startup without printing the key', () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const client = new RustFsClient(
      configWith({ RUSTFS_ACCESS_KEY: 'Secret/KeyValue123' }),
    );

    expect(client.configProblem).toBeDefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain('Secret/KeyValue123');
  });

  it('stays quiet for a usable key', () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const client = new RustFsClient(
      configWith({ RUSTFS_ACCESS_KEY: 'AbCdEf0123456789' }),
    );

    expect(client.configProblem).toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });
});
