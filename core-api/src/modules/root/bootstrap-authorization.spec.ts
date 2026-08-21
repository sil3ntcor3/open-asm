import {
  createBootstrapAuthorizationUrl,
  createBootstrapLinkTicket,
  exchangeBootstrapLinkTicket,
  isValidBootstrapSession,
} from './bootstrap-authorization';

const BOOTSTRAP_SECRET = 'a-secure-bootstrap-token-with-32-chars';
const TEST_NOW = new Date('2026-08-20T12:00:00.000Z').getTime();

describe('bootstrap authorization', () => {
  it('builds an activation URL without exposing the deployment secret', () => {
    const activationUrl = new URL(
      createBootstrapAuthorizationUrl(
        'https://openasm.example.com',
        BOOTSTRAP_SECRET,
        TEST_NOW,
      ),
    );
    const ticket = activationUrl.searchParams.get('ticket');

    expect(activationUrl.origin).toBe('https://openasm.example.com');
    expect(activationUrl.pathname).toBe('/api/init-admin/authorize');
    expect(activationUrl.toString()).not.toContain(BOOTSTRAP_SECRET);
    expect(
      exchangeBootstrapLinkTicket(BOOTSTRAP_SECRET, ticket, TEST_NOW),
    ).not.toBeNull();
  });

  it('requires the configured public console origin', () => {
    expect(() =>
      createBootstrapAuthorizationUrl(undefined, BOOTSTRAP_SECRET, TEST_NOW),
    ).toThrow('OASM_CONSOLE_URL');
  });

  it('creates a short-lived setup link ticket that can be exchanged for a browser session', () => {
    const link = createBootstrapLinkTicket(BOOTSTRAP_SECRET, TEST_NOW);
    const session = exchangeBootstrapLinkTicket(
      BOOTSTRAP_SECRET,
      link,
      TEST_NOW,
    );

    expect(session).toEqual(expect.stringMatching(/^v1\./));
    expect(isValidBootstrapSession(BOOTSTRAP_SECRET, link, TEST_NOW)).toBe(
      false,
    );
    expect(isValidBootstrapSession(BOOTSTRAP_SECRET, session, TEST_NOW)).toBe(
      true,
    );
  });

  it('refuses to generate a link from the documented default secret', () => {
    expect(() => createBootstrapLinkTicket('change_me', TEST_NOW)).toThrow(
      'ADMIN_BOOTSTRAP_TOKEN',
    );
  });

  it('rejects a tampered setup link', () => {
    const link = createBootstrapLinkTicket(BOOTSTRAP_SECRET, TEST_NOW);
    const tamperedLink = `${link.slice(0, -1)}x`;

    expect(
      exchangeBootstrapLinkTicket(BOOTSTRAP_SECRET, tamperedLink, TEST_NOW),
    ).toBeNull();
  });
});
