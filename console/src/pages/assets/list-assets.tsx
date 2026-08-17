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
import AssetsExportButton, {
  type AssetExportView,
} from './components/assets-export-button';

// Component references (not elements) so only the active tab is instantiated
// per render, instead of constructing all seven elements on every render.
const tabList: {
  value: AssetExportView;
  text: string;
  tab: ComponentType;
}[] = [
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
  // Default to the Hosts tab: it lists every discovered asset (including
  // subdomains with no open service yet), so a completed discovery run is
  // visible immediately. The Services tab only shows hosts with a live probed
  // service and can look empty right after discovery.
  const tab = (search as Record<string, string>).tab || 'host';
  const navigate = useNavigate();

  /** Keeps the active asset view in the URL and resets its pagination. */
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

  const activeTabDefinition = tabList.find((item) => item.value === tab);
  const ActiveTab = activeTabDefinition?.tab;
  const activeView = activeTabDefinition?.value ?? 'host';

  return (
    <div className="w-full space-y-2">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <FilterFormInfinite />
        </div>
        <AssetsExportButton view={activeView} />
      </div>
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TriggerList tabTriggerList={tabList} />
        {ActiveTab && <ActiveTab />}
      </Tabs>
    </div>
  );
}
