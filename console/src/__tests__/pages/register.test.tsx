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

  it('does not ask the user for a bootstrap token', async () => {
    renderWithProviders(<Register />, {
      routePath: '/init-admin',
      initialEntries: ['/init-admin'],
    });

    await screen.findByLabelText(/email/i);
    expect(screen.queryByLabelText(/bootstrap token/i)).not.toBeInTheDocument();
  });

  it('submits only the administrator credentials', async () => {
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
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            email: 'admin@example.com',
            password: 'correct horse battery staple',
          },
        }),
        expect.any(Object),
      );
    });
  });

  it('explains how to recover when setup authorization is missing or expired', async () => {
    mockMutate.mockImplementationOnce((_variables, options) => {
      options.onError({ response: { status: 401 } });
    });
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
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByText(/setup authorization expired.*new setup link/i),
    ).toBeInTheDocument();
  });
});
