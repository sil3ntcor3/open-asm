import type { ConfigService } from '@nestjs/config';
import { validateWorkerEnrollmentConfiguration } from './worker-enrollment';

describe('validateWorkerEnrollmentConfiguration', () => {
  it.each([undefined, '', 'change_me', 'too-short'])(
    'rejects missing or weak enrollment value %p',
    (value) => {
      const config = {
        get: jest.fn().mockReturnValue(value),
      } as unknown as ConfigService;

      expect(() => validateWorkerEnrollmentConfiguration(config)).toThrow(
        'OASM_CLOUD_APIKEY must be a non-default secret of at least 32 characters',
      );
    },
  );

  it('accepts an explicitly configured strong enrollment value', () => {
    const config = {
      get: jest
        .fn()
        .mockReturnValue('a-strong-worker-enrollment-token-1234567890'),
    } as unknown as ConfigService;

    expect(() => validateWorkerEnrollmentConfiguration(config)).not.toThrow();
  });
});
