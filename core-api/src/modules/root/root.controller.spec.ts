import type { Request, Response } from 'express';
import type { CreateFirstAdminDto } from './dto/root.dto';
import { RootController } from './root.controller';
import type { RootService } from './root.service';

const BOOTSTRAP_COOKIE_NAME = 'oasm_admin_bootstrap';

describe('RootController first-admin authorization', () => {
  let controller: RootController;
  let rootService: {
    authorizeFirstAdmin: jest.Mock;
    createFirstAdmin: jest.Mock;
  };

  beforeEach(() => {
    rootService = {
      authorizeFirstAdmin: jest.fn().mockResolvedValue({
        authorization: 'signed-browser-session',
        secure: true,
      }),
      createFirstAdmin: jest
        .fn()
        .mockResolvedValue({ message: 'Admin user created successfully' }),
    };
    controller = new RootController(rootService as unknown as RootService);
  });

  it('anchors the Secure cookie flag to the configured public origin', async () => {
    const response = {
      cookie: jest.fn(),
      setHeader: jest.fn(),
      redirect: jest.fn(),
    } as unknown as Response;
    const revisedController = controller as unknown as {
      authorizeFirstAdmin(
        dto: { ticket: string },
        response: Response,
      ): Promise<void>;
    };

    await revisedController.authorizeFirstAdmin(
      { ticket: 'signed-setup-link' },
      response,
    );

    expect(rootService.authorizeFirstAdmin).toHaveBeenCalledWith(
      'signed-setup-link',
    );
    expect(response.cookie).toHaveBeenCalledWith(
      BOOTSTRAP_COOKIE_NAME,
      'signed-browser-session',
      {
        httpOnly: true,
        maxAge: 15 * 60 * 1000,
        path: '/api/init-admin',
        sameSite: 'strict',
        secure: true,
      },
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Referrer-Policy',
      'no-referrer',
    );
    expect(response.redirect).toHaveBeenCalledWith(303, '/init-admin');
  });

  it('uses the HttpOnly authorization for account creation and clears it on success', async () => {
    const dto = {
      email: 'admin@example.com',
      password: 'correct horse battery staple',
    } as CreateFirstAdminDto;
    const request = {
      cookies: { [BOOTSTRAP_COOKIE_NAME]: 'signed-browser-session' },
      headers: { origin: 'https://openasm.example.com' },
    } as unknown as Request;
    const response = {
      clearCookie: jest.fn(),
    } as unknown as Response;
    const revisedController = controller as unknown as {
      createFirstAdmin(
        dto: CreateFirstAdminDto,
        request: Request,
        response: Response,
      ): Promise<{ message: string }>;
    };

    await expect(
      revisedController.createFirstAdmin(dto, request, response),
    ).resolves.toEqual({ message: 'Admin user created successfully' });

    expect(rootService.createFirstAdmin).toHaveBeenCalledWith(
      dto,
      'signed-browser-session',
      'https://openasm.example.com',
    );
    expect(response.clearCookie).toHaveBeenCalledWith(BOOTSTRAP_COOKIE_NAME, {
      httpOnly: true,
      path: '/api/init-admin',
      sameSite: 'strict',
    });
  });
});
