import { PATH_METADATA } from '@nestjs/common/constants';
import { RootController } from './root.controller';

describe('RootController provisioning boundary', () => {
  it('does not expose first-admin provisioning over HTTP', () => {
    const routePaths = Object.getOwnPropertyNames(RootController.prototype)
      .map((methodName) => {
        const method = RootController.prototype[
          methodName as keyof RootController
        ] as unknown;
        return typeof method === 'function'
          ? (Reflect.getMetadata(PATH_METADATA, method) as string | undefined)
          : undefined;
      })
      .filter((path): path is string => path !== undefined);

    expect(routePaths).not.toContain('init-admin');
    expect(routePaths).not.toContain('init-admin/authorize');
  });
});
