import { Tabs } from '@/components/ui/tabs';
import { useWorkspaceSelector } from '@/hooks/useWorkspaceSelector';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import CreateWorkspace from '../workspaces/create-workspace';
import AssetTabContent from './components/asset-tab';
import FilterFormInfinite from './components/filter-form-infinite';
import HostAssetsTab from './components/host-assets-tab';
import IpAssetsTab from './components/ip-assets-tab';
import PortAssetsTab from './components/port-assets-tab';
import StatusCodeAssetsTab from './components/status-code-assets-tab';
import TriggerList from './components/tab-trigger-list';
import TechnologyAssetsTab from './components/technology-assets-tab';
import TlsAssetsTab from './components/tls-assets-tab';

// Component references (not elements) so only the active tab is instantiated
// per render, instead of constructing all seven elements on every render.
const tabList: { value: string; text: string; tab: ComponentType }[] = [
  { value: 'service', text: 'Services', tab: AssetTabContent },
  { value: 'technology', text: 'Technologies', tab: TechnologyAssetsTab },
  { value: 'ip', text: 'IP Addresses', tab: IpAssetsTab },
  { value: 'port', text: 'Ports', tab: PortAssetsTab },
  { value: 'host', text: 'Hosts', tab: HostAssetsTab },
  { value: 'status-code', text: 'Status Code', tab: StatusCodeAssetsTab },
  { value: 'tls', text: 'TLS', tab: TlsAssetsTab },
];

export function ListAssets() {
  const { workspaces } = useWorkspaceSelector();
  const search = useSearch({ strict: false });
  const tab = (search as Record<string, string>).tab || 'service';
  const navigate = useNavigate();

  const handleTabChange = (value: string) => {
    navigate({
      search: ((prev: Record<string, unknown>) => ({
        ...prev,
        tab: value,
        page: 1,
      })) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });
  };

  if (workspaces.length === 0) return <CreateWorkspace />;

  const ActiveTab = tabList.find((t) => t.value === tab)?.tab;

  return (
    <div className="w-full space-y-2">
      <div className="flex justify-between items-center">
        <FilterFormInfinite />
        {/* <ExportDataButton api="api/assets/services/export" prefix="assets" /> */}
      </div>
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TriggerList tabTriggerList={tabList} />
        {ActiveTab && <ActiveTab />}
      </Tabs>
    </div>
  );
}
