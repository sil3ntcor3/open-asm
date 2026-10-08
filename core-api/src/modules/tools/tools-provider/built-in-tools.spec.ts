import type { Vulnerability } from '@/modules/vulnerabilities/entities/vulnerability.entity';
import { builtInTools } from './built-in-tools';

describe('builtInTools nuclei parser', () => {
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
