import Register from '@/pages/register/register';
import { renderWithProviders, screen } from '@/test/utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/common/layout/auth-layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('Administrator setup page', () => {
  it('directs setup to the host installer without collecting credentials', async () => {
    renderWithProviders(<Register />, {
      routePath: '/init-admin',
      initialEntries: ['/init-admin'],
    });

    expect(
      await screen.findByText(
        /administrator setup must be completed on the host/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('./scripts/install.sh')).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /create account/i }),
    ).not.toBeInTheDocument();
  });
});
