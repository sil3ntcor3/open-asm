import { ToolsService } from './tools.service';

describe('ToolsService built-in tool synchronization', () => {
  it('refreshes stored commands when built-in definitions change', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const orUpdate = jest.fn().mockReturnThis();
    const queryBuilder = {
      insert: jest.fn().mockReturnThis(),
      orUpdate,
      values: jest.fn().mockReturnThis(),
      execute,
    };
    const toolsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    const service = new ToolsService(
      toolsRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.onModuleInit();

    expect(orUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        overwrite: expect.arrayContaining(['command']),
      }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
