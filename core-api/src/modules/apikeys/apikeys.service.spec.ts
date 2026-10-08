import { ApiKeyType } from '@/common/enums/enum';
import type { Repository } from 'typeorm';
import { ApiKeysService } from './apikeys.service';
import type { ApiKey } from './entities/apikey.entity';

describe('ApiKeysService', () => {
  it('returns null when no current API key exists', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as Repository<ApiKey>;
    const service = new ApiKeysService(repository);

    await expect(
      service.getCurrentApiKey(ApiKeyType.TOOL, 'tool-id'),
    ).resolves.toBeNull();
  });
});
