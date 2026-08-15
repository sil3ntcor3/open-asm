import Register from '@/pages/register/register';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMutate } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
}));

vi.mock('@/services/apis/gen/queries', () => ({
  getRootControllerGetMetadataQueryKey: () => ['root-metadata'],
  useRootControllerCreateFirstAdmin: () => ({ mutate: mockMutate }),
}));

vi.mock('@/components/common/layout/auth-layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-layout">{children}</div>
  ),
}));

describe('Register Page', () => {
  beforeEach(() => {
    mockMutate.mockReset();
  });

  it('requires the deployment bootstrap token for first-admin setup', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Register />, {
      routePath: '/init-admin',
      initialEntries: ['/init-admin'],
    });

    const bootstrapToken = await screen.findByLabelText(/bootstrap token/i);
    await user.type(bootstrapToken, 'too-short');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Bootstrap token must be at least 32 characters'),
      ).toBeInTheDocument();
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('submits the configured bootstrap token with valid account details', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Register />, {
      routePath: '/init-admin',
      initialEntries: ['/init-admin'],
    });

    await user.type(
      await screen.findByLabelText(/email/i),
      'admin@example.com',
    );
    await user.type(
      screen.getByLabelText(/^password$/i),
      'correct horse battery staple',
    );
    await user.type(
      screen.getByLabelText(/confirm password/i),
      'correct horse battery staple',
    );
    await user.type(
      screen.getByLabelText(/bootstrap token/i),
      'a-secure-bootstrap-token-with-32-chars',
    );
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bootstrapToken: 'a-secure-bootstrap-token-with-32-chars',
          }),
        }),
        expect.any(Object),
      );
    });
  });
});
