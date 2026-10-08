import type { INestApplication } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import type { AddressInfo } from 'net';
import { WORKSPACE_HEADER_NAME } from '../constants/app.constants';
import { WorkspaceId } from './workspace-id.decorator';

@Controller('workspace-id-probe')
class WorkspaceIdProbeController {
  @Get()
  read(@WorkspaceId() workspaceId: string) {
    return { workspaceId };
  }
}

/**
 * Driven over a real HTTP request rather than a hand-built request object.
 * That is the whole point: Node lowercases every incoming header name before
 * Express exposes `req.headers`, so a mock that files the header under the
 * casing the client sent hides exactly the defect these tests cover — which is
 * how a header the API documents and the console sends came to be dead code
 * while every unit test around it passed.
 */
describe('WorkspaceId decorator', () => {
  const workspaceId = 'd7d343db-7b4f-4d03-9c1c-fd17099e6052';
  const otherWorkspaceId = '3579afb6-d960-4fa6-8fdd-65bb72f77477';
  let app: INestApplication;
  let baseUrl: string;

  const probe = (headers: Record<string, string>) =>
    fetch(`${baseUrl}/workspace-id-probe`, { headers });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkspaceIdProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.listen(0);

    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves the workspace from the documented header casing', async () => {
    const response = await probe({ [WORKSPACE_HEADER_NAME]: workspaceId });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ workspaceId });
  });

  it('resolves the workspace whatever casing the client sends', async () => {
    const response = await probe({
      [WORKSPACE_HEADER_NAME.toLowerCase()]: workspaceId,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ workspaceId });
  });

  it('falls back to the wid cookie when no header is sent', async () => {
    const response = await probe({ cookie: `wid=${workspaceId}` });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ workspaceId });
  });

  it('prefers the header over a cookie naming another workspace', async () => {
    const response = await probe({
      [WORKSPACE_HEADER_NAME]: workspaceId,
      cookie: `wid=${otherWorkspaceId}`,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ workspaceId });
  });

  it('rejects a header that is not a workspace id', async () => {
    const response = await probe({
      [WORKSPACE_HEADER_NAME]: 'not-a-workspace-id',
    });

    expect(response.status).toBe(400);
  });

  it('rejects a request that selects no workspace at all', async () => {
    const response = await probe({});

    expect(response.status).toBe(400);
  });
});
