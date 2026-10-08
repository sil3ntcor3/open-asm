import type { ConfigService } from '@nestjs/config';

export const MINIMUM_WORKER_ENROLLMENT_TOKEN_LENGTH = 32;

export function validateWorkerEnrollmentConfiguration(
  configService: ConfigService,
): void {
  const enrollmentToken = configService.get<string>('OASM_CLOUD_APIKEY');
  if (
    !enrollmentToken ||
    enrollmentToken === 'change_me' ||
    enrollmentToken.length < MINIMUM_WORKER_ENROLLMENT_TOKEN_LENGTH
  ) {
    throw new Error(
      'OASM_CLOUD_APIKEY must be a non-default secret of at least 32 characters',
    );
  }
}
