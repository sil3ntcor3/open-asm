import {
  buildAssetExportSheet,
  buildCsvExport,
  buildXlsxExport,
  type AssetExportColumn,
} from './asset-export.util';
import { strFromU8, unzipSync } from 'fflate';
import { AssetExportView } from '../dto/export-assets.dto';

describe('asset export utilities', () => {
  const columns: AssetExportColumn[] = [
    { key: 'host', header: 'Host' },
    { key: 'services', header: 'Services' },
  ];

  it('creates an Excel-compatible CSV and neutralizes formula injection', () => {
    const csv = buildCsvExport(columns, [
      {
        host: '=HYPERLINK("https://attacker.example")',
        services: 2,
      },
      { host: 'safe,"host"', services: 0 },
    ]).toString('utf8');

    expect(csv).toBe(
      '\uFEFF"Host","Services"\r\n' +
        '"\'=HYPERLINK(""https://attacker.example"")","2"\r\n' +
        '"safe,""host""","0"',
    );
  });

  it('creates a valid XLSX package with inert text and typed numeric cells', () => {
    const workbook = buildXlsxExport('Hosts / discovery', columns, [
      {
        host: '=HYPERLINK("https://attacker.example")',
        services: 2,
      },
    ]);
    const files = unzipSync(new Uint8Array(workbook));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    const workbookXml = strFromU8(files['xl/workbook.xml']);

    expect(workbook.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/styles.xml',
        'xl/worksheets/sheet1.xml',
      ]),
    );
    expect(workbookXml).toContain('name="Hosts - discovery"');
    expect(sheet).toContain(
      "<t>'=HYPERLINK(&quot;https://attacker.example&quot;)</t>",
    );
    expect(sheet).toContain('<c r="B2" t="n"><v>2</v></c>');
    expect(sheet).not.toContain('<f>');
  });

  it.each([
    {
      expected: { host: 'example.com', services: 0 },
      source: { host: 'example.com', assetCount: 0 },
      view: AssetExportView.HOST,
    },
    {
      expected: {
        asn: 'AS64500',
        asnName: 'Example ASN',
        city: 'Chicago',
        country: 'United States',
        countryCode: 'US',
        ip: '203.0.113.10',
        isp: 'Example ISP',
        latitude: 41.88,
        longitude: -87.63,
        organization: 'Example Org',
        region: 'Illinois',
        services: 3,
      },
      source: {
        assetCount: 3,
        geoIp: {
          as: 'AS64500',
          asname: 'Example ASN',
          city: 'Chicago',
          country: 'United States',
          countryCode: 'US',
          isp: 'Example ISP',
          lat: 41.88,
          lon: -87.63,
          org: 'Example Org',
          regionName: 'Illinois',
        },
        ip: '203.0.113.10',
      },
      view: AssetExportView.IP,
    },
    {
      expected: { port: '443', services: 7 },
      source: { port: '443', assetCount: 7 },
      view: AssetExportView.PORT,
    },
    {
      expected: {
        categories: 'Web servers; Reverse proxies',
        description: 'Web server',
        services: 4,
        technology: 'nginx',
        version: '1.27',
        website: 'https://nginx.org',
      },
      source: {
        assetCount: 4,
        technology: {
          categoryNames: ['Web servers', 'Reverse proxies'],
          description: 'Web server',
          name: 'nginx',
          version: '1.27',
          website: 'https://nginx.org',
        },
      },
      view: AssetExportView.TECHNOLOGY,
    },
    {
      expected: { services: 5, statusCode: '200' },
      source: { assetCount: 5, statusCode: '200' },
      view: AssetExportView.STATUS_CODE,
    },
    {
      expected: expect.objectContaining({
        expires: '2027-01-01T00:00:00Z',
        host: 'example.com',
        subjectAltNames: 'example.com; www.example.com',
        tlsVersion: 'tls13',
      }),
      source: {
        cipher: 'TLS_AES_256_GCM_SHA384',
        host: 'example.com',
        issuer_dn: 'CN=Example CA',
        not_after: '2027-01-01T00:00:00Z',
        not_before: '2026-01-01T00:00:00Z',
        sni: 'example.com',
        subject_an: ['example.com', 'www.example.com'],
        subject_cn: 'example.com',
        subject_dn: 'CN=example.com',
        tls_connection: 'ctls',
        tls_version: 'tls13',
      },
      view: AssetExportView.TLS,
    },
    {
      expected: expect.objectContaining({
        enabled: true,
        ipAddresses: '203.0.113.10',
        port: 443,
        service: 'https://example.com',
        statusCode: 200,
        technologies: 'nginx:1.27',
        tlsHost: 'example.com',
      }),
      source: {
        createdAt: '2026-01-01T00:00:00Z',
        httpResponses: {
          status_code: 200,
          tech: ['nginx:1.27'],
          title: 'Example',
          tls: { host: 'example.com', tls_version: 'tls13' },
          webserver: 'nginx',
        },
        ipAddresses: ['203.0.113.10'],
        isEnabled: true,
        port: 443,
        value: 'https://example.com',
      },
      view: AssetExportView.SERVICE,
    },
  ])('maps $view data into export rows', ({ expected, source, view }) => {
    const sheet = buildAssetExportSheet(view, [source]);

    expect(sheet.rows).toEqual([expected]);
  });
});
