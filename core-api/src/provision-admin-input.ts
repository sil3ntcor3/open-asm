import { z } from 'zod';

const provisioningSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

export interface AdminProvisioningInput {
  email: string;
  password: string;
}

/** Parses exactly two newline-delimited credentials without logging either. */
export function parseAdminProvisioningInput(
  input: string,
): AdminProvisioningInput {
  const firstNewline = input.indexOf('\n');
  if (firstNewline < 0) throw invalidCredentials();

  const email = input.slice(0, firstNewline).replace(/\r$/, '');
  const passwordInput = input.slice(firstNewline + 1);
  const secondNewline = passwordInput.indexOf('\n');
  const password = (
    secondNewline < 0
      ? passwordInput
      : passwordInput.slice(0, secondNewline)
  ).replace(/\r$/, '');
  const remainder =
    secondNewline < 0 ? '' : passwordInput.slice(secondNewline + 1);
  if (remainder.length > 0) throw invalidCredentials();

  const parsed = provisioningSchema.safeParse({ email, password });
  if (!parsed.success) throw invalidCredentials();
  return {
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
  };
}

function invalidCredentials(): Error {
  return new Error('Invalid administrator credentials');
}
