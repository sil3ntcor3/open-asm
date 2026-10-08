import type { Response } from 'express';
import { AssetsController } from './assets.controller';
import type { AssetsService } from './assets.service';
import {
  AssetExportFormat,
  AssetExportView,
  ExportAssetsQueryDto,
} from './dto/export-assets.dto';

describe('AssetsController', () => {
  it('returns an XLSX attachment for the requested active view', async () => {
    const assetsService = {
      getAssetsForExport: jest.fn().mockResolvedValue({
        columns: [
          { key: 'host', header: 'Host' },
          { key: 'services', header: 'Services' },
        ],
        rows: [{ host: 'example.com', services: 1 }],
        sheetName: 'Hosts',
      }),
    } as unknown as AssetsService;
    const controller = new AssetsController(assetsService);
    const response = {
      send: jest.fn(),
      setHeader: jest.fn(),
    } as unknown as Response;
    const query = Object.assign(new ExportAssetsQueryDto(), {
      format: AssetExportFormat.XLSX,
      view: AssetExportView.HOST,
    });

    await controller.exportAssets(query, 'workspace-id', response);

    expect(assetsService.getAssetsForExport).toHaveBeenCalledWith(
      query,
      'workspace-id',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="assets-host-workspace-id.xlsx"',
    );
    const [body] = (response.send as jest.Mock).mock.calls[0] as [Buffer];
    expect(body.subarray(0, 2).toString('ascii')).toBe('PK');
  });

  it('neutralizes spreadsheet formulas in the legacy services CSV export', async () => {
    const assetsService = {
      exportServicesForCSV: jest.fn().mockResolvedValue([
        {
          ports: [443],
          techs: ['nginx'],
          tls: null,
          value: '=HYPERLINK("https://attacker.example")',
        },
      ]),
    } as unknown as AssetsService;
    const controller = new AssetsController(assetsService);
    const response = {
      send: jest.fn(),
      setHeader: jest.fn(),
    } as unknown as Response;

    await controller.exportServicesToCSV('workspace-id', response);

    const [body] = (response.send as jest.Mock).mock.calls[0] as [Buffer];
    expect(body.toString('utf8')).toContain(
      '"\'=HYPERLINK(""https://attacker.example"")"',
    );
  });
});
