jest.mock('better-auth', () => ({
  betterAuth: (options: unknown) => ({ options }),
}));
jest.mock('better-auth/plugins', () => ({
  admin: () => ({ id: 'admin' }),
  openAPI: () => ({ id: 'open-api' }),
}));

import { auth } from './auth';

describe('authentication registration policy', () => {
  it('disables public email-and-password sign-up', () => {
    const configuredAuth = auth as {
      options: {
        emailAndPassword?: {
          disableSignUp?: boolean;
        };
      };
    };

    expect(configuredAuth.options.emailAndPassword?.disableSignUp).toBe(true);
  });
});
