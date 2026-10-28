import { ROLE_METADATA_KEY } from '@/common/constants/app.constants';
import { Role } from '@/common/enums/enum';
import type { ToolUpdateService } from './tool-update.service';
import { ToolsController } from './tools.controller';
import type { ToolsService } from './tools.service';

describe('ToolsController update authorization', () => {
  it.each(['checkForUpdates', 'requestToolUpdate'])(
    'restricts %s to platform administrators',
    (methodName) => {
      const handler = ToolsController.prototype[
        methodName as keyof ToolsController
      ] as unknown;

      expect(handler).toBeDefined();
      expect(Reflect.getMetadata(ROLE_METADATA_KEY, handler as object)).toEqual(
        [Role.ADMIN],
      );
    },
  );

  it('creates a component-scoped rollout without accepting a workspace scope', async () => {
    const updateService = {
      requestUpdate: jest.fn().mockResolvedValue({
        requestId: '019ca5a9-2bc5-7fc0-bf20-1975d6ac7002',
      }),
    } as unknown as ToolUpdateService;
    const controller = Reflect.construct(ToolsController, [
      {} as ToolsService,
      updateService,
    ]);

    const result = await (
      controller as unknown as {
        requestToolUpdate(
          id: string,
          component: string,
          userId: string,
        ): Promise<{ requestId: string }>;
      }
    ).requestToolUpdate('tool-1', 'httpx', 'admin-1');

    expect(result.requestId).toBe('019ca5a9-2bc5-7fc0-bf20-1975d6ac7002');
    expect(updateService.requestUpdate).toHaveBeenCalledWith(
      'tool-1',
      'httpx',
      'admin-1',
    );
  });
});
