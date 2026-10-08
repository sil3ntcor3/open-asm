import { parseAdminProvisioningInput } from './provision-admin-input';

describe('first-admin provisioning input', () => {
  it('normalizes the email without changing the password', () => {
    expect(
      parseAdminProvisioningInput(
        '  Admin@Example.com  \ncorrect horse battery staple\n',
      ),
    ).toEqual({
      email: 'admin@example.com',
      password: 'correct horse battery staple',
    });
  });

  it.each([
    ['', 'missing credentials'],
    ['admin@example.com\nshort\n', 'short password'],
    ['not-an-email\ncorrect horse battery staple\n', 'invalid email'],
    [
      'admin@example.com\ncorrect horse battery staple\nunexpected\n',
      'additional input',
    ],
  ])('rejects %s (%s)', (input) => {
    expect(() => parseAdminProvisioningInput(input)).toThrow(
      'Invalid administrator credentials',
    );
  });
});
