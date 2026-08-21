import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

export const BOOTSTRAP_AUTHORIZATION_TTL_MS = 15 * 60 * 1000;

const AUTHORIZATION_VERSION = 'v1';
const AUTHORIZATION_CLOCK_SKEW_MS = 5 * 1000;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

type AuthorizationContext = 'link' | 'session';

interface AuthorizationClaims {
  expiresAt: number;
  nonce: string;
}

/** Builds the browser activation URL without placing the deployment secret in it. */
export function createBootstrapAuthorizationUrl(
  publicUrl: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): string {
  if (!publicUrl) {
    throw new Error('OASM_CONSOLE_URL must be configured');
  }

  let activationUrl: URL;
  try {
    activationUrl = new URL(publicUrl);
  } catch {
    throw new Error('OASM_CONSOLE_URL must be a valid HTTP or HTTPS origin');
  }
  if (
    !['http:', 'https:'].includes(activationUrl.protocol) ||
    activationUrl.username ||
    activationUrl.password
  ) {
    throw new Error('OASM_CONSOLE_URL must be an HTTP or HTTPS origin');
  }

  activationUrl.pathname = '/api/init-admin/authorize';
  activationUrl.search = '';
  activationUrl.hash = '';
  activationUrl.searchParams.set(
    'ticket',
    createBootstrapLinkTicket(secret, now),
  );
  return activationUrl.toString();
}

/** Creates a short-lived link capability signed by the deployment secret. */
export function createBootstrapLinkTicket(
  secret: string | undefined,
  now = Date.now(),
): string {
  if (!isValidBootstrapSecret(secret)) {
    throw new Error(
      'ADMIN_BOOTSTRAP_TOKEN must be a non-default secret of at least 32 characters',
    );
  }

  return signAuthorization(
    secret,
    'link',
    now + BOOTSTRAP_AUTHORIZATION_TTL_MS,
    randomBytes(18).toString('base64url'),
  );
}

/** Exchanges a valid link capability for a context-separated browser session. */
export function exchangeBootstrapLinkTicket(
  secret: string | undefined,
  ticket: string | null | undefined,
  now = Date.now(),
): string | null {
  const claims = verifyAuthorization(secret, ticket, 'link', now);
  if (!claims || !secret) return null;

  return signAuthorization(secret, 'session', claims.expiresAt, claims.nonce);
}

/** Verifies that a browser session is authentic and has not expired. */
export function isValidBootstrapSession(
  secret: string | undefined,
  authorization: string | null | undefined,
  now = Date.now(),
): boolean {
  return Boolean(verifyAuthorization(secret, authorization, 'session', now));
}

function isValidBootstrapSecret(secret: string | undefined): secret is string {
  return Boolean(secret && secret.length >= 32 && secret !== 'change_me');
}

function signAuthorization(
  secret: string,
  context: AuthorizationContext,
  expiresAt: number,
  nonce: string,
): string {
  const signature = createHmac('sha256', secret)
    .update(`${context}:${expiresAt}:${nonce}`)
    .digest('base64url');
  return `${AUTHORIZATION_VERSION}.${expiresAt}.${nonce}.${signature}`;
}

function verifyAuthorization(
  secret: string | undefined,
  authorization: string | null | undefined,
  context: AuthorizationContext,
  now: number,
): AuthorizationClaims | null {
  if (!isValidBootstrapSecret(secret) || !authorization) return null;

  const [version, rawExpiresAt, nonce, signature, extra] =
    authorization.split('.');
  if (
    extra !== undefined ||
    version !== AUTHORIZATION_VERSION ||
    !/^\d+$/.test(rawExpiresAt) ||
    !NONCE_PATTERN.test(nonce) ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    return null;
  }

  const expiresAt = Number(rawExpiresAt);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < now ||
    expiresAt >
      now + BOOTSTRAP_AUTHORIZATION_TTL_MS + AUTHORIZATION_CLOCK_SKEW_MS
  ) {
    return null;
  }

  const expected = signAuthorization(secret, context, expiresAt, nonce);
  const expectedSignature = expected.slice(expected.lastIndexOf('.') + 1);
  const expectedBytes = Buffer.from(expectedSignature);
  const actualBytes = Buffer.from(signature);
  if (
    expectedBytes.length !== actualBytes.length ||
    !timingSafeEqual(expectedBytes, actualBytes)
  ) {
    return null;
  }

  return { expiresAt, nonce };
}
