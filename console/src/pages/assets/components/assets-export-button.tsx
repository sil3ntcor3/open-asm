import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  assetsControllerExportAssets,
  type AssetsControllerExportAssetsFormat,
  type AssetsControllerExportAssetsParams,
  type AssetsControllerExportAssetsView,
} from '@/services/apis/gen/queries';
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAsset } from '../context/asset-context';

export type AssetExportFormat = AssetsControllerExportAssetsFormat;
export type AssetExportView = AssetsControllerExportAssetsView;

const viewLabels: Record<AssetExportView, string> = {
  host: 'Hosts',
  ip: 'IP Addresses',
  port: 'Ports',
  service: 'Services',
  'status-code': 'Status Codes',
  technology: 'Technologies',
  tls: 'TLS Certificates',
};

/**
 * Starts a browser download for a generated export and releases its temporary
 * object URL after the click has been dispatched.
 */
function downloadExport(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Renders an accessible format menu and exports every filtered row from the
 * currently active Assets view.
 */
export default function AssetsExportButton({
  view,
}: {
  view: AssetExportView;
}) {
  const { queryParams } = useAsset();
  const [exportingFormat, setExportingFormat] =
    useState<AssetExportFormat | null>(null);
  const viewLabel = viewLabels[view];

  /** Requests the selected export format and downloads the returned file. */
  const handleExport = async (format: AssetExportFormat): Promise<void> => {
    const toastId = toast.loading(`Exporting ${viewLabel.toLowerCase()}...`);
    setExportingFormat(format);

    try {
      const params: AssetsControllerExportAssetsParams = {
        endDate: queryParams.endDate,
        format,
        hosts: queryParams.hosts,
        ipAddresses: queryParams.ipAddresses,
        ports: queryParams.ports,
        sortBy: queryParams.sortBy,
        sortOrder: queryParams.sortOrder,
        startDate: queryParams.startDate,
        statusCodes: queryParams.statusCodes,
        targetIds: queryParams.targetIds,
        techs: queryParams.techs,
        tlsHosts: queryParams.tlsHosts,
        value: queryParams.value,
        view,
      };
      const blob = await assetsControllerExportAssets(params);

      if (!(blob instanceof Blob) || blob.size === 0) {
        throw new Error('The export did not contain any file data.');
      }

      const date = new Date().toISOString().slice(0, 10);
      downloadExport(blob, `assets-${view}-${date}.${format}`);
      toast.success(`${viewLabel} export downloaded.`, { id: toastId });
    } catch (error) {
      toast.error(`Unable to export ${viewLabel.toLowerCase()}.`, {
        description:
          error instanceof Error ? error.message : 'Please try again.',
        id: toastId,
      });
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Export ${viewLabel} data`}
          className="shrink-0"
          disabled={exportingFormat !== null}
          variant="outline"
        >
          {exportingFormat ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
          Export
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block">Export {viewLabel}</span>
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            Includes all rows matching current filters
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleExport('csv')}>
          <FileText aria-hidden="true" />
          <span className="flex flex-col">
            <span>CSV (.csv)</span>
            <span className="text-xs text-muted-foreground">
              Comma-separated values
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleExport('xlsx')}>
          <FileSpreadsheet aria-hidden="true" />
          <span className="flex flex-col">
            <span>Excel (.xlsx)</span>
            <span className="text-xs text-muted-foreground">
              Microsoft Excel workbook
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
