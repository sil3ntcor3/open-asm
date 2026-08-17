import { strToU8, zipSync } from 'fflate';
import { AssetExportView } from '../dto/export-assets.dto';

export interface AssetExportColumn {
  key: string;
  header: string;
}

export type AssetExportRow = Record<
  string,
  boolean | Date | number | string | null | undefined
>;

export interface AssetExportSheet {
  columns: AssetExportColumn[];
  rows: AssetExportRow[];
  sheetName: string;
}

const exportColumns: Record<AssetExportView, AssetExportColumn[]> = {
  [AssetExportView.HOST]: [
    { key: 'host', header: 'Host' },
    { key: 'services', header: 'Services' },
  ],
  [AssetExportView.IP]: [
    { key: 'ip', header: 'IP Address' },
    { key: 'country', header: 'Country' },
    { key: 'countryCode', header: 'Country Code' },
    { key: 'region', header: 'Region' },
    { key: 'city', header: 'City' },
    { key: 'asn', header: 'ASN' },
    { key: 'asnName', header: 'ASN Name' },
    { key: 'organization', header: 'Organization' },
    { key: 'isp', header: 'ISP' },
    { key: 'latitude', header: 'Latitude' },
    { key: 'longitude', header: 'Longitude' },
    { key: 'services', header: 'Services' },
  ],
  [AssetExportView.PORT]: [
    { key: 'port', header: 'Port' },
    { key: 'services', header: 'Services' },
  ],
  [AssetExportView.SERVICE]: [
    { key: 'service', header: 'Service' },
    { key: 'port', header: 'Port' },
    { key: 'ipAddresses', header: 'IP Addresses' },
    { key: 'statusCode', header: 'HTTP Status' },
    { key: 'title', header: 'Title' },
    { key: 'webServer', header: 'Web Server' },
    { key: 'technologies', header: 'Technologies' },
    { key: 'tlsHost', header: 'TLS Host' },
    { key: 'tlsVersion', header: 'TLS Version' },
    { key: 'tlsValidFrom', header: 'TLS Valid From' },
    { key: 'tlsExpires', header: 'TLS Expires' },
    { key: 'enabled', header: 'Enabled' },
    { key: 'discoveredAt', header: 'Discovered At' },
  ],
  [AssetExportView.STATUS_CODE]: [
    { key: 'statusCode', header: 'Status Code' },
    { key: 'services', header: 'Services' },
  ],
  [AssetExportView.TECHNOLOGY]: [
    { key: 'technology', header: 'Technology' },
    { key: 'version', header: 'Version' },
    { key: 'categories', header: 'Categories' },
    { key: 'description', header: 'Description' },
    { key: 'website', header: 'Website' },
    { key: 'services', header: 'Services' },
  ],
  [AssetExportView.TLS]: [
    { key: 'host', header: 'Host' },
    { key: 'sni', header: 'SNI' },
    { key: 'subjectDn', header: 'Subject DN' },
    { key: 'subjectCn', header: 'Subject CN' },
    { key: 'issuerDn', header: 'Issuer DN' },
    { key: 'subjectAltNames', header: 'Subject Alternative Names' },
    { key: 'validFrom', header: 'Valid From' },
    { key: 'expires', header: 'Expires' },
    { key: 'tlsVersion', header: 'TLS Version' },
    { key: 'cipher', header: 'Cipher' },
    { key: 'connection', header: 'Connection' },
  ],
};

const sheetNames: Record<AssetExportView, string> = {
  [AssetExportView.HOST]: 'Hosts',
  [AssetExportView.IP]: 'IP Addresses',
  [AssetExportView.PORT]: 'Ports',
  [AssetExportView.SERVICE]: 'Services',
  [AssetExportView.STATUS_CODE]: 'Status Codes',
  [AssetExportView.TECHNOLOGY]: 'Technologies',
  [AssetExportView.TLS]: 'TLS Certificates',
};

const FORMULA_PREFIX_PATTERN = /^[=+\-@]/;

/** Joins a list into a stable spreadsheet cell value. */
function joinValues(value: unknown): string {
  return Array.isArray(value) ? value.join('; ') : '';
}

/** Maps one API result into the flat columns for its active asset view. */
function mapAssetExportRow(
  view: AssetExportView,
  source: unknown,
): AssetExportRow {
  const row = source as Record<string, unknown>;

  switch (view) {
    case AssetExportView.HOST:
      return { host: row.host as string, services: row.assetCount as number };
    case AssetExportView.IP: {
      const geoIp = (row.geoIp ?? {}) as Record<string, unknown>;
      return {
        asn: geoIp.as as string,
        asnName: geoIp.asname as string,
        city: geoIp.city as string,
        country: geoIp.country as string,
        countryCode: geoIp.countryCode as string,
        ip: row.ip as string,
        isp: geoIp.isp as string,
        latitude: geoIp.lat as number,
        longitude: geoIp.lon as number,
        organization: geoIp.org as string,
        region: geoIp.regionName as string,
        services: row.assetCount as number,
      };
    }
    case AssetExportView.PORT:
      return { port: row.port as string, services: row.assetCount as number };
    case AssetExportView.SERVICE: {
      const response = (row.httpResponses ?? {}) as Record<string, unknown>;
      const tls = (response.tls ?? {}) as Record<string, unknown>;
      return {
        discoveredAt: row.createdAt as Date | string,
        enabled: row.isEnabled as boolean,
        ipAddresses: joinValues(row.ipAddresses),
        port: row.port as number,
        service: row.value as string,
        statusCode: response.status_code as number,
        technologies: joinValues(response.tech),
        title: response.title as string,
        tlsExpires: tls.not_after as string,
        tlsHost: tls.host as string,
        tlsValidFrom: tls.not_before as string,
        tlsVersion: tls.tls_version as string,
        webServer: response.webserver as string,
      };
    }
    case AssetExportView.STATUS_CODE:
      return {
        services: row.assetCount as number,
        statusCode: row.statusCode as string,
      };
    case AssetExportView.TECHNOLOGY: {
      const technology = (row.technology ?? {}) as Record<string, unknown>;
      return {
        categories: joinValues(technology.categoryNames),
        description: technology.description as string,
        services: row.assetCount as number,
        technology: technology.name as string,
        version: technology.version as string,
        website: technology.website as string,
      };
    }
    case AssetExportView.TLS:
      return {
        cipher: row.cipher as string,
        connection: row.tls_connection as string,
        expires: row.not_after as string,
        host: row.host as string,
        issuerDn: row.issuer_dn as string,
        sni: row.sni as string,
        subjectAltNames: joinValues(row.subject_an),
        subjectCn: row.subject_cn as string,
        subjectDn: row.subject_dn as string,
        tlsVersion: row.tls_version as string,
        validFrom: row.not_before as string,
      };
  }
}

/** Builds the flat export schema and rows for one Assets tab. */
export function buildAssetExportSheet(
  view: AssetExportView,
  rows: unknown[],
): AssetExportSheet {
  return {
    columns: exportColumns[view],
    rows: rows.map((row) => mapAssetExportRow(view, row)),
    sheetName: sheetNames[view],
  };
}

/** Escapes text for safe use in XML element and attribute values. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Converts an export value into text while neutralizing spreadsheet formulas
 * supplied through attacker-controlled asset data.
 */
function formatSpreadsheetValue(value: AssetExportRow[string]): string {
  if (value === null || value === undefined) return '';

  const text = value instanceof Date ? value.toISOString() : String(value);
  return FORMULA_PREFIX_PATTERN.test(text.trimStart()) ? `'${text}` : text;
}

/**
 * Produces an RFC 4180-style CSV buffer with a UTF-8 BOM for Excel and other
 * spreadsheet clients.
 */
export function buildCsvExport(
  columns: AssetExportColumn[],
  rows: AssetExportRow[],
): Buffer {
  const escapeCell = (value: AssetExportRow[string]): string =>
    `"${formatSpreadsheetValue(value).replace(/"/g, '""')}"`;

  const lines = [
    columns.map((column) => escapeCell(column.header)).join(','),
    ...rows.map((row) =>
      columns.map((column) => escapeCell(row[column.key])).join(','),
    ),
  ];

  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
}

/** Converts a zero-based column index to its Excel column reference. */
function getExcelColumnName(index: number): string {
  let value = index + 1;
  let result = '';

  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }

  return result;
}

/** Creates one typed worksheet cell without allowing formula evaluation. */
function buildWorksheetCell(
  reference: string,
  value: AssetExportRow[string],
  style = 0,
): string {
  const styleAttribute = style > 0 ? ` s="${style}"` : '';

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}" t="n"${styleAttribute}><v>${value}</v></c>`;
  }

  if (typeof value === 'boolean') {
    return `<c r="${reference}" t="b"${styleAttribute}><v>${value ? 1 : 0}</v></c>`;
  }

  const text = formatSpreadsheetValue(value);
  const preserveWhitespace = /^\s|\s$/.test(text)
    ? ' xml:space="preserve"'
    : '';
  return `<c r="${reference}" t="inlineStr"${styleAttribute}><is><t${preserveWhitespace}>${escapeXml(text)}</t></is></c>`;
}

/** Normalizes a worksheet name to Excel's 31-character naming rules. */
function normalizeSheetName(sheetName: string): string {
  return (
    sheetName
      .replace(/[:\\/?*[\]]/g, '-')
      .trim()
      .slice(0, 31) || 'Assets'
  );
}

/**
 * Produces a standards-compliant XLSX workbook with a frozen, styled header
 * row and typed data cells. Text values always use inline strings so an asset
 * can never become an executable spreadsheet formula.
 */
export function buildXlsxExport(
  sheetName: string,
  columns: AssetExportColumn[],
  rows: AssetExportRow[],
): Buffer {
  const normalizedSheetName = normalizeSheetName(sheetName);
  const headerCells = columns
    .map((column, index) =>
      buildWorksheetCell(`${getExcelColumnName(index)}1`, column.header, 1),
    )
    .join('');
  const dataRows = rows
    .map((row, rowIndex) => {
      const cells = columns
        .map((column, columnIndex) =>
          buildWorksheetCell(
            `${getExcelColumnName(columnIndex)}${rowIndex + 2}`,
            row[column.key],
          ),
        )
        .join('');
      return `<row r="${rowIndex + 2}">${cells}</row>`;
    })
    .join('');
  const lastColumn = getExcelColumnName(Math.max(columns.length - 1, 0));
  const lastRow = Math.max(rows.length + 1, 1);
  const tableRange = `A1:${lastColumn}${lastRow}`;
  const columnWidths = columns
    .map((column, columnIndex) => {
      const longestValue = rows.reduce((longest, row) => {
        const value = formatSpreadsheetValue(row[column.key]);
        return Math.max(longest, value.length);
      }, column.header.length);
      const width = Math.min(60, Math.max(12, longestValue + 2));
      const index = columnIndex + 1;
      return `<col min="${index}" max="${index}" width="${width}" customWidth="1"/>`;
    })
    .join('');

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${tableRange}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${columnWidths}</cols>
  <sheetData><row r="1">${headerCells}</row>${dataRows}</sheetData>
  <autoFilter ref="${tableRange}"/>
</worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(normalizedSheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
  const packageRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const archive = zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(packageRelationships),
      'xl/workbook.xml': strToU8(workbook),
      'xl/_rels/workbook.xml.rels': strToU8(workbookRelationships),
      'xl/styles.xml': strToU8(styles),
      'xl/worksheets/sheet1.xml': strToU8(worksheet),
    },
    { level: 6 },
  );

  return Buffer.from(archive);
}
