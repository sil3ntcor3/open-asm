import Page from '@/components/common/page';
import { useIpLocationData } from '@/hooks/useIpLocationData';
import { useWorkspaceSelector } from '@/hooks/useWorkspaceSelector';
import { useStatisticControllerGetAssetLocations } from '@/services/apis/gen/queries';
import { lazy, Suspense, useState } from 'react';
import CreateWorkspace from '../workspaces/create-workspace';
import { AssetTrends } from './components/asset-trends';
// Lazy-loaded: this card pulls in echarts (the heaviest chart dependency),
// which is only used for the map. Splitting it keeps it out of the dashboard's
// initial chunk so the rest of the page can paint first.
const IpLocationsCard = lazy(() => import('./components/ip-locations-card'));
import IssuesTimeline from './components/issues-timeline';
import Statistic from './components/statistic';
import TlsStatistics from './components/tls-statistics';
import TopAssetsVulnerabilitiesChart from './components/top-assets-vulnerabilities-chart';
import VulnerabilityStatistic from './components/vulnerabilities-statistic';

export default function Dashboard() {
  const { workspaces, isLoading: workspacesLoading } = useWorkspaceSelector();
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  const { data: locations, isLoading: locationsLoading } =
    useStatisticControllerGetAssetLocations();

  const { data: ipLocationData, totalIps } = useIpLocationData({
    locations,
    isLoading: locationsLoading,
  });

  if (workspacesLoading) return <Page title="Dashboard" />;

  if (workspaces.length === 0) {
    return (
      <Page title="Dashboard">
        <CreateWorkspace />
      </Page>
    );
  }

  return (
    <Page title="Dashboard">
      <div className="space-y-4">
        <div className="grid grid-cols-1 2xl:grid-cols-4 gap-4">
          <div className="col-span-1 2xl:col-span-3 order-2 2xl:order-0 flex flex-col gap-4">
            <div className="flex-1">
              <Statistic />
            </div>
            <div className="flex-1">
              <Suspense
                fallback={
                  <div className="h-full min-h-80 animate-pulse rounded-lg bg-muted/40" />
                }
              >
                <IpLocationsCard
                  data={ipLocationData}
                  totalIps={totalIps}
                  selectedCountry={selectedCountry}
                  onCountrySelect={setSelectedCountry}
                />
              </Suspense>
            </div>
          </div>
          <div className="col-span-1 order-1 2xl:order-0 flex flex-col gap-4">
            <div className="flex-1">
              <VulnerabilityStatistic />
            </div>
            <div className="flex-1">
              <TlsStatistics />
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 2xl:grid-cols-6 gap-4">
            <div className="2xl:col-span-4">
              <AssetTrends />
            </div>
            <div className="2xl:col-span-2">
              <TopAssetsVulnerabilitiesChart />
            </div>
          </div>
          <IssuesTimeline />
        </div>
      </div>
    </Page>
  );
}
