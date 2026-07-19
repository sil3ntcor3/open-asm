import type { ConfigService } from '@nestjs/config';
import { getGrpcServerCredentials } from './grpc-transport';

describe('getGrpcServerCredentials', () => {
  it('keeps TLS disabled unless the deployment variable explicitly enables it', () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    expect(getGrpcServerCredentials(config)).toBeUndefined();
  });

  it('fails closed when mTLS is enabled without certificate files', () => {
    const values: Record<string, string | undefined> = {
      GRPC_TLS_ENABLED: 'true',
    };
    const config = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    expect(() => getGrpcServerCredentials(config)).toThrow(
      'GRPC_TLS_ENABLED requires',
    );
  });
});
