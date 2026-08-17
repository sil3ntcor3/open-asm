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

  it('removes XML-invalid response bytes from XLSX text cells', () => {
    const workbook = buildXlsxExport('Hosts', columns, [
      { host: 'HTTP\u0000response\u000Bbody', services: 1 },
    ]);
    const files = unzipSync(new Uint8Array(workbook));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);

    expect(sheet).toContain('<t>HTTPresponsebody</t>');
    expect(sheet).not.toContain('\u0000');
    expect(sheet).not.toContain('\u000B');
  });

  it('keeps oversized response bodies within the Excel cell limit', () => {
    const workbook = buildXlsxExport('Hosts', columns, [
      { host: 'x'.repeat(40_000), services: 1 },
    ]);
    const files = unzipSync(new Uint8Array(workbook));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    const cellText = sheet.match(/<c r="A2"[^>]*><is><t>(.*?)<\/t>/s)?.[1];

    expect(cellText).toBeDefined();
    expect(cellText?.length).toBeLessThanOrEqual(32_767);
    expect(cellText).toContain('[Truncated for Excel]');
  });

  it.each([
    {
      expected: expect.objectContaining({ host: 'example.com', services: 0 }),
      source: { host: 'example.com', assetCount: 0 },
      view: AssetExportView.HOST,
    },
    {
      expected: expect.objectContaining({
        asn: 'AS64500',
        asnName: 'Example ASN',
        city: 'Chicago',
        country: 'United States',
        countryCode: 'US',
        ip: '203.0.113.10',
        isp: 'Example ISP',
        organization: 'Example Org',
        region: 'Illinois',
        services: 3,
      }),
      source: {
        assetCount: 3,
        geoIp: {
          as: 'AS64500',
          asname: 'Example ASN',
          city: 'Chicago',
          continent: 'North America',
          continentCode: 'NA',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          district: 'Cook County',
          isp: 'Example ISP',
          lat: 41.88,
          lon: -87.63,
          offset: -18000,
          org: 'Example Org',
          region: 'IL',
          regionName: 'Illinois',
          status: 'success',
          timezone: 'America/Chicago',
          zip: '60601',
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

  it('includes the selected service details in a Hosts export row', () => {
    const sheet = buildAssetExportSheet(AssetExportView.HOST, [
      {
        assetCount: 2,
        createdAt: '2026-08-17T12:00:00.000Z',
        detectedService: 'https',
        host: 'app.example.com',
        httpResponses: {
          body: '<html>Example</html>',
          raw_header: 'HTTP/1.1 200 OK',
          status_code: 200,
          tech: ['nginx:1.27', 'React:19'],
          techList: [
            {
              categoryNames: ['Web servers'],
              description: 'High performance web server',
              name: 'nginx',
              website: 'https://nginx.org',
            },
          ],
          title: 'Example application',
          tls: {
            cipher: 'TLS_AES_256_GCM_SHA384',
            fingerprint_hash: {
              md5: 'md5-value',
              sha1: 'sha1-value',
              sha256: 'sha256-value',
            },
            host: 'app.example.com',
            issuer_cn: 'Example Issuing CA',
            issuer_dn: 'CN=Example Issuing CA,O=Example Trust',
            issuer_org: ['Example Trust'],
            not_after: '2027-08-17T00:00:00Z',
            not_before: '2026-08-17T00:00:00Z',
            port: '443',
            probe_status: true,
            serial: '01:23:45',
            sni: 'app.example.com',
            subject_an: ['app.example.com', 'www.example.com'],
            subject_cn: 'app.example.com',
            subject_dn: 'CN=app.example.com',
            tls_connection: 'ctls',
            tls_version: 'tls13',
            wildcard_certificate: false,
          },
          url: 'https://app.example.com',
          webserver: 'nginx',
        },
        ipAddresses: ['203.0.113.10', '2001:db8::10'],
        isEnabled: true,
        port: 443,
        product: 'nginx 1.27',
        scheme: 'https',
        screenshotPath: 'http://localhost/screenshots/app.png',
        tags: [{ tag: 'internet-facing' }, { tag: 'production' }],
        value: 'https://app.example.com',
      },
    ]);

    expect(sheet.columns.map(({ header }) => header)).toEqual(
      expect.arrayContaining([
        'Host Name',
        'Service',
        'Port',
        'IP Addresses',
        'Technologies',
        'Certificate Common Name',
        'Certificate Alternative Names',
        'Certificate Issuer Organizations',
        'Certificate Fingerprint SHA-256',
      ]),
    );
    expect(sheet.columns.map(({ header }) => header)).not.toEqual(
      expect.arrayContaining([
        'Page Title',
        'Screenshot',
        'HTTP Response Headers',
        'HTTP Response Body',
      ]),
    );
    expect(sheet.rows[0]).toEqual(
      expect.objectContaining({
        certificateAlternativeNames: 'app.example.com; www.example.com',
        certificateCommonName: 'app.example.com',
        certificateFingerprintSha256: 'sha256-value',
        certificateIssuerOrganizations: 'Example Trust',
        detectedService: 'https',
        host: 'app.example.com',
        ipAddresses: '203.0.113.10; 2001:db8::10',
        port: 443,
        service: 'https://app.example.com',
        services: 2,
        tags: 'internet-facing; production',
        technologies: 'nginx:1.27; React:19',
      }),
    );
    expect(sheet.rows[0]).not.toHaveProperty('title');
    expect(sheet.rows[0]).not.toHaveProperty('screenshot');
    expect(sheet.rows[0]).not.toHaveProperty('httpResponseHeaders');
    expect(sheet.rows[0]).not.toHaveProperty('httpResponseBody');
  });

  it('includes the selected IP context and related service details in an IP Addresses export row', () => {
    const sheet = buildAssetExportSheet(AssetExportView.IP, [
      {
        assetCount: 1,
        geoIp: {
          as: 'AS64500',
          asname: 'Example ASN',
          city: 'Chicago',
          continent: 'North America',
          continentCode: 'NA',
          country: 'United States',
          countryCode: 'US',
          currency: 'USD',
          district: 'Cook County',
          isp: 'Example ISP',
          lat: 41.88,
          lon: -87.63,
          offset: -18000,
          org: 'Example Org',
          region: 'IL',
          regionName: 'Illinois',
          status: 'success',
          timezone: 'America/Chicago',
          zip: '60601',
        },
        host: 'app.example.com',
        httpResponses: {
          status_code: 200,
          tech: ['nginx:1.27'],
          tls: {
            issuer_org: ['Example Trust'],
            not_after: '2027-08-17T00:00:00Z',
            subject_cn: 'app.example.com',
          },
        },
        ip: '203.0.113.10',
        ipAddresses: ['203.0.113.10'],
        port: 443,
        value: 'https://app.example.com',
      },
    ]);

    expect(sheet.columns.map(({ header }) => header)).toEqual(
      expect.arrayContaining([
        'IP Address',
        'Continent',
        'Host Name',
        'Service',
        'Port',
        'Technologies',
        'Certificate Expires',
        'Timezone',
      ]),
    );
    expect(sheet.columns.map(({ header }) => header)).not.toEqual(
      expect.arrayContaining([
        'Geo-IP Lookup Status',
        'District',
        'Postal Code',
        'Latitude',
        'Longitude',
        'UTC Offset Seconds',
        'Currency',
        'Page Title',
        'Screenshot',
        'HTTP Response Headers',
        'HTTP Response Body',
      ]),
    );
    expect(sheet.rows[0]).toEqual(
      expect.objectContaining({
        asn: 'AS64500',
        certificateExpires: '2027-08-17T00:00:00Z',
        city: 'Chicago',
        continent: 'North America',
        host: 'app.example.com',
        ip: '203.0.113.10',
        port: 443,
        service: 'https://app.example.com',
        technologies: 'nginx:1.27',
        timezone: 'America/Chicago',
      }),
    );
    expect(sheet.rows[0]).not.toHaveProperty('lookupStatus');
    expect(sheet.rows[0]).not.toHaveProperty('district');
    expect(sheet.rows[0]).not.toHaveProperty('zip');
    expect(sheet.rows[0]).not.toHaveProperty('latitude');
    expect(sheet.rows[0]).not.toHaveProperty('longitude');
    expect(sheet.rows[0]).not.toHaveProperty('utcOffset');
    expect(sheet.rows[0]).not.toHaveProperty('currency');
    expect(sheet.rows[0]).not.toHaveProperty('title');
    expect(sheet.rows[0]).not.toHaveProperty('screenshot');
    expect(sheet.rows[0]).not.toHaveProperty('httpResponseHeaders');
    expect(sheet.rows[0]).not.toHaveProperty('httpResponseBody');
  });
});
