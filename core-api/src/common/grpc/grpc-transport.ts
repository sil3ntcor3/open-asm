import { ServerCredentials } from '@grpc/grpc-js';
import type { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';

const REQUIRED_MTLS_FILES = [
  'GRPC_TLS_CA_FILE',
  'GRPC_TLS_CERT_FILE',
  'GRPC_TLS_KEY_FILE',
] as const;

export function getGrpcServerCredentials(
  configService: ConfigService,
): ServerCredentials | undefined {
  if (configService.get<string>('GRPC_TLS_ENABLED') !== 'true') {
    return undefined;
  }

  const missing = REQUIRED_MTLS_FILES.filter(
    (name) => !configService.get<string>(name),
  );
  if (missing.length > 0) {
    throw new Error(
      `GRPC_TLS_ENABLED requires ${REQUIRED_MTLS_FILES.join(', ')}`,
    );
  }

  const ca = readFileSync(
    configService.getOrThrow<string>('GRPC_TLS_CA_FILE'),
  );
  const certificate = readFileSync(
    configService.getOrThrow<string>('GRPC_TLS_CERT_FILE'),
  );
  const privateKey = readFileSync(
    configService.getOrThrow<string>('GRPC_TLS_KEY_FILE'),
  );

  return ServerCredentials.createSsl(
    ca,
    [{ cert_chain: certificate, private_key: privateKey }],
    true,
  );
}

export function isGrpcReflectionEnabled(
  configService: ConfigService,
): boolean {
  return configService.get<string>('GRPC_REFLECTION_ENABLED') === 'true';
}
