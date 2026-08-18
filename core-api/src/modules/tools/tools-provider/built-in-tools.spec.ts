import type { Vulnerability } from '@/modules/vulnerabilities/entities/vulnerability.entity';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { builtInTools } from './built-in-tools';

describe('builtInTools static assets', () => {
  it('ships the configured Nmap logo used by the tools and workers pages', () => {
    const nmap = builtInTools.find((tool) => tool.name === 'nmap');
    const relativeLogoPath = nmap?.logoUrl?.replace(/^\/static\//, '');

    expect(relativeLogoPath).toBe('images/nmap.png');
    expect(
      existsSync(join(process.cwd(), 'public', relativeLogoPath!)),
    ).toBe(true);
  });
});

describe('builtInTools subfinder parser', () => {
  const subfinder = builtInTools.find((tool) => tool.name === 'subfinder');

  it('shows that every available Subfinder source is enabled', () => {
    expect(subfinder?.command).toContain('subfinder -duc -all -d');
  });

  it('advertises the bundled Subfinder version', () => {
    expect(subfinder?.version).toBe('2.14.0');
  });

  it('marks SOA-only DNS output as unresolved', () => {
    const parsed = subfinder!.parser!(
      'www.remote.example.com [SOA] [ns-1.example.net]',
    );

    expect(parsed).toEqual([
      expect.objectContaining({
        value: 'www.remote.example.com',
        dnsResolutionStatus: 'unresolved',
      }),
    ]);
  });

  it('marks DNS output containing an address record as resolved', () => {
    const parsed = subfinder!.parser!(
      'remote.example.com [A] [192.0.2.10]',
    );

    expect(parsed).toEqual([
      expect.objectContaining({
        value: 'remote.example.com',
        dnsResolutionStatus: 'resolved',
      }),
    ]);
  });
});

describe('builtInTools nuclei parser', () => {
  it('uses the worker-managed persistent template directory', () => {
    const nuclei = builtInTools.find((tool) => tool.name === 'nuclei');

    expect(nuclei?.command).toContain('-t nuclei-templates');
    expect(nuclei?.version).toBe('3.11.0');
  });

  it('captures structured and raw evidence for grouped nuclei findings', () => {
    const nuclei = builtInTools.find((tool) => tool.name === 'nuclei');
    expect(nuclei?.parser).toBeDefined();

    const raw = [
      {
        'template-id': 'ssl-weak-cipher-suites',
        'template-path': 'ssl/ssl-weak-cipher-suites.yaml',
        type: 'ssl',
        host: 'example.com',
        ip: '192.0.2.10',
        port: '443',
        'matched-at': 'example.com:443',
        'matcher-name': 'weak-cipher',
        'extractor-name': 'cipher',
        'extracted-results': ['TLS_RSA_WITH_3DES_EDE_CBC_SHA'],
        info: {
          name: 'Weak Cipher Suites Detection',
          severity: 'low',
          description: 'Weak cipher suites were detected.',
          tags: ['ssl', 'tls'],
          reference: ['https://example.com/reference'],
          author: ['projectdiscovery'],
        },
      },
      {
        'template-id': 'ssl-weak-cipher-suites',
        'template-path': 'ssl/ssl-weak-cipher-suites.yaml',
        type: 'ssl',
        host: 'example.com',
        ip: '192.0.2.10',
        port: '443',
        'matched-at': 'example.com:443',
        'matcher-name': 'weak-cipher',
        'extractor-name': 'cipher',
        'extracted-results': ['TLS_RSA_WITH_RC4_128_SHA'],
        info: {
          name: 'Weak Cipher Suites Detection',
          severity: 'low',
          description: 'Weak cipher suites were detected.',
          tags: ['ssl', 'tls'],
          reference: ['https://example.com/reference'],
          author: ['projectdiscovery'],
        },
      },
    ]
      .map((finding) => JSON.stringify(finding))
      .join('\n');

    const parsed = nuclei!.parser!(raw) as Vulnerability[];

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      name: 'Weak Cipher Suites Detection',
      extractorName: 'cipher',
      extractedResults: [
        'TLS_RSA_WITH_3DES_EDE_CBC_SHA',
        'TLS_RSA_WITH_RC4_128_SHA',
      ],
      evidence: [
        {
          templateId: 'ssl-weak-cipher-suites',
          templatePath: 'ssl/ssl-weak-cipher-suites.yaml',
          type: 'ssl',
          matcherName: 'weak-cipher',
          extractorName: 'cipher',
          matchedAt: 'example.com:443',
          host: 'example.com',
          ip: '192.0.2.10',
          port: '443',
          extractedResults: ['TLS_RSA_WITH_3DES_EDE_CBC_SHA'],
          raw: expect.objectContaining({
            'template-id': 'ssl-weak-cipher-suites',
          }),
        },
        {
          extractedResults: ['TLS_RSA_WITH_RC4_128_SHA'],
          raw: expect.objectContaining({
            'template-id': 'ssl-weak-cipher-suites',
          }),
        },
      ],
    });
  });
});
