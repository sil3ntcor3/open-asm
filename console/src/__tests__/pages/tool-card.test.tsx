import ToolCard from '@/pages/tools/components/tool-card';
import type { Tool } from '@/services/apis/gen/queries';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useNavigateWithParams', () => ({
  useNavigateWithParams: () => vi.fn(),
}));

/** Creates the smallest complete generated Tool model needed by ToolCard. */
function createTool(version: string, templateVersions?: string[]): Tool {
  return {
    id: 'tool-1',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    name: 'nuclei',
    description: 'Vulnerability scanner',
    command: 'nuclei',
    category: 'vulnerabilities',
    version,
    logoUrl: '/static/images/nuclei.png',
    isBuiltIn: true,
    isInstalled: true,
    isOfficialSupport: true,
    type: 'built_in',
    providerId: '',
    availableWorkersCount: 1,
    templateVersions,
  };
}

describe('ToolCard', () => {
  it('shows the tool version with an explicit label', () => {
    render(<ToolCard tool={createTool('3.11.0')} />);

    expect(screen.getByText('Version: 3.11.0')).toBeInTheDocument();
  });

  it('shows a truthful fallback when a tool does not report a version', () => {
    render(<ToolCard tool={createTool('')} />);

    expect(screen.getByText('Version: Not reported')).toBeInTheDocument();
  });

  it('shows the single Nuclei template version reported by workers', () => {
    render(<ToolCard tool={createTool('3.11.0', ['v10.4.7'])} />);

    expect(screen.getByText('Templates: v10.4.7')).toBeInTheDocument();
  });

  it('shows mixed when workers report different Nuclei template versions', () => {
    render(<ToolCard tool={createTool('3.11.0', ['v10.4.6', 'v10.4.7'])} />);

    expect(screen.getByText('Templates: Mixed')).toBeInTheDocument();
  });

  it('shows a truthful fallback when workers have not reported a template version', () => {
    render(<ToolCard tool={createTool('3.11.0', [])} />);

    expect(screen.getByText('Templates: Not reported')).toBeInTheDocument();
  });
});
