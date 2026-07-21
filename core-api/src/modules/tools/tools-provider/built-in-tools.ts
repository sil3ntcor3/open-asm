/* eslint-disable */

import type { Severity } from '@/common/enums/enum';
import {
  DnsResolutionStatus,
  JobPriority,
  ToolCategory,
} from '@/common/enums/enum';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Asset } from '../../assets/entities/assets.entity';
import type {
  Vulnerability,
  VulnerabilityEvidence,
} from '../../vulnerabilities/entities/vulnerability.entity';
import { Tool } from '../entities/tools.entity';

type NucleiFinding = Record<string, unknown>;

const nucleiVersion = JSON.parse(
  readFileSync(
    join(process.cwd(), 'public/archived/nuclei-manifest.json'),
    'utf8',
  ),
)['version'] as string;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const stringValue = String(value);
  return stringValue.length > 0 ? stringValue : undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => asString(item))
      .filter((item): item is string => Boolean(item));
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function createNucleiEvidence(finding: NucleiFinding): VulnerabilityEvidence {
  const info = asRecord(finding.info);
  const metadata = asRecord(info?.metadata);

  return {
    templateId: asString(finding['template-id']),
    templatePath: asString(finding['template-path']),
    type: asString(finding.type),
    matcherName: asString(finding['matcher-name']),
    matcherStatus:
      typeof finding['matcher-status'] === 'boolean'
        ? finding['matcher-status']
        : undefined,
    extractorName: asString(finding['extractor-name']),
    extractedResults: asStringArray(finding['extracted-results']),
    matchedAt: asString(finding['matched-at']),
    host: asString(finding.host),
    ip: asString(finding.ip),
    port: asString(finding.port),
    scheme: asString(finding.scheme),
    request: asString(finding.request),
    response: asString(finding.response),
    curlCommand: asString(finding['curl-command']),
    timestamp: asString(finding.timestamp),
    metadata,
    raw: finding,
  };
}

export const builtInTools: Tool[] = [
  {
    name: 'subfinder',
    category: ToolCategory.SUBDOMAINS,
    description:
      'Subfinder is a subdomain discovery tool that returns valid subdomains for websites, using passive online sources.',
    logoUrl: '/static/images/subfinder.png',
    command:
      '(echo {{value}} && subfinder -duc -d {{value}}) | dnsx -duc -a -aaaa -cname -mx -ns -soa -txt -resp',
    parser: (result: string) => {
      const parsed = {};
      result.split('\n').forEach((line) => {
        const cleaned = line.replace(/\x1B\[[0-9;]*m/g, '').trim();
        const match = cleaned.match(/^([^\[]+)\s+\[([A-Z]+)\]\s+\[(.+)\]$/);
        if (!match) return;

        const [, domain, type, value] = match;
        if (!parsed[domain]) parsed[domain] = {};
        if (!parsed[domain][type]) parsed[domain][type] = [];
        parsed[domain][type].push(value);
      });

      return Object.keys(parsed).map((i) => ({
        id: randomUUID(),
        value: i,
        dnsRecords: parsed[i],
        dnsResolutionStatus:
          (parsed[i].A?.length ?? 0) > 0 ||
          (parsed[i].AAAA?.length ?? 0) > 0
            ? DnsResolutionStatus.RESOLVED
            : DnsResolutionStatus.UNRESOLVED,
      })) as Asset[];
    },
    version: '2.8.0',
    priority: JobPriority.MEDIUM,
  },
  {
    name: 'httpx',
    category: ToolCategory.HTTP_PROBE,
    description:
      'Httpx is a fast and multi-purpose HTTP toolkit that allows running multiple probes using the retryable http library. It is designed to maintain result reliability with an increased number of threads.',
    logoUrl: '/static/images/httpx.png',
    command:
      'httpx -duc -u {{value}} -status-code -favicon -asn -title -web-server -irr -tech-detect -ip -cname -location -tls-grab -cdn -probe -json -timeout 10 -retries 2 -threads 100 -silent',
    parser: JSON.parse,
    version: '1.7.1',
    priority: JobPriority.MEDIUM,
  },
  {
    name: 'screenshot',
    category: ToolCategory.SCREENSHOT,
    description: 'Take a screenshot of a website.',
    logoUrl: '/static/images/screenshot.png',
    parser: JSON.parse,
    version: '1.0.0',
    command: 'screenshot {{value}}',
    priority: JobPriority.MEDIUM,
  },
  {
    name: 'naabu',
    category: ToolCategory.PORTS_SCANNER,
    description:
      'A fast port scanner written in go with a focus on reliability and simplicity. Designed to be used in combination with other tools for attack surface discovery in bug bounties and pentests.',
    logoUrl: '/static/images/naabu.png',
    command: 'naabu -host {{value}} -silent -top-ports 1000 -rate 150',
    parser: (result: string) => {
      const parsed = result
        .trim()
        .split('\n')
        .filter((i) => i.includes(':'))
        .map((i) => Number(i.split(':')[1].replace(/\r/g, '')))
        .sort();
      return parsed;
    },
    version: '2.3.5',
    priority: JobPriority.MEDIUM,
  },
  {
    name: 'nmap',
    category: ToolCategory.SERVICE_DISCOVERY,
    description:
      'Nmap service detection (-sV) identifies the protocol and product running on each open port, reliably distinguishing web services (http/https, on any port) from non-web services (ftp, smtp, imap, pop3, ssh, ...). The worker returns parsed JSON, so this parser is a passthrough.',
    logoUrl: '/static/images/nmap.png',
    // Display only; the worker runs nmap against the (host, port) of each
    // asset_service and returns parsed service JSON.
    command: 'nmap -sV -Pn -T3 --version-intensity 2 -oG - -p {{port}} {{value}}',
    parser: JSON.parse,
    version: '7.99',
    priority: JobPriority.MEDIUM,
  },
  {
    name: 'nuclei',
    category: ToolCategory.VULNERABILITIES,
    description:
      'Nuclei is a fast, customizable vulnerability scanner powered by the global security community and built on a simple YAML-based DSL, enabling collaboration to tackle trending vulnerabilities on the internet. It helps you find vulnerabilities in your applications, APIs, networks, DNS, and cloud configurations.',
    logoUrl: '/static/images/nuclei.png',
    command: 'nuclei -duc -t nuclei-templates -u {{value}} -j --silent',
    parser: (result: string) => {
      const initialVulnerabilities = result
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const finding = JSON.parse(line.trim()) as NucleiFinding;
          const info = asRecord(finding.info) ?? {};
          const classification = asRecord(info.classification);
          const port = asString(finding.port);
          const evidence = createNucleiEvidence(finding);
          const vulId = randomUUID();
          const filePath = `${vulId}.json`;
          return {
            id: vulId,
            name:
              asString(info.name) ??
              asString(finding['template-id']) ??
              'Unknown Nuclei Finding',
            description: asString(info.description),
            severity: (
              asString(info.severity) ?? 'info'
            ).toLowerCase() as Severity,
            tags: asStringArray(info.tags),
            references: asStringArray(info.reference),
            authors: asStringArray(info.author),
            affectedUrl: finding['matched-at'] as string,
            ipAddress: finding['ip'] as string,
            host: finding['host'] as string,
            ports: port ? [port] : [],
            cvssMetric: classification?.['cvss-metrics'] as string,
            cvssScore: classification?.['cvss-score'] as number,
            cveId: asStringArray(classification?.['cve-id']),
            cweId: asStringArray(classification?.['cwe-id']),
            extractorName: asString(finding['extractor-name']),
            extractedResults: evidence.extractedResults ?? [],
            evidence: [evidence],
            filePath,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      const groupedVulnerabilities = new Map<
        string,
        (typeof initialVulnerabilities)[0]
      >();

      for (const vuln of initialVulnerabilities) {
        if (groupedVulnerabilities.has(vuln.name)) {
          const existingVuln = groupedVulnerabilities.get(vuln.name)!;
          existingVuln.tags = [
            ...new Set([...existingVuln.tags, ...vuln.tags]),
          ];
          existingVuln.references = [
            ...new Set([...existingVuln.references, ...vuln.references]),
          ];
          existingVuln.authors = [
            ...new Set([...existingVuln.authors, ...vuln.authors]),
          ];
          existingVuln.extractedResults = [
            ...new Set([
              ...existingVuln.extractedResults,
              ...vuln.extractedResults,
            ]),
          ];
          existingVuln.ports = [
            ...new Set([...existingVuln.ports, ...vuln.ports]),
          ];
          existingVuln.evidence = [
            ...(existingVuln.evidence ?? []),
            ...(vuln.evidence ?? []),
          ];
        } else {
          groupedVulnerabilities.set(vuln.name, { ...vuln });
        }
      }

      const data = Array.from(
        groupedVulnerabilities.values(),
      ) as Vulnerability[];
      return data;
    },

    version: nucleiVersion,
    priority: JobPriority.LOW,
  },
];
