import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useWorkspacesControllerGetWorkspaceRolePermissions } from '@/services/apis/gen/queries';
import { Check, Minus } from 'lucide-react';

export default function WorkspaceRolePermissions() {
  const { data, isLoading, isError } =
    useWorkspacesControllerGetWorkspaceRolePermissions();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          The workspace permission catalog is currently unavailable.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="platform-roles-title">
        <div>
          <h4 id="platform-roles-title" className="font-medium">
            Platform roles
          </h4>
          <p className="text-sm text-muted-foreground">
            Platform roles control system administration. They do not override
            membership or permissions inside a workspace.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Admin</CardTitle>
              <CardDescription>
                Manages platform users, branding, and update checks. Workspace
                actions still require the account&apos;s workspace role.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">User</CardTitle>
              <CardDescription>
                Uses the application through explicitly assigned workspace
                memberships and permissions.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="workspace-roles-title">
        <div>
          <h4 id="workspace-roles-title" className="font-medium">
            Workspace roles
          </h4>
          <p className="text-sm text-muted-foreground">
            This matrix is returned by the API from the same policy used to
            authorize every protected workspace action.
          </p>
        </div>
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-64 pl-6">Action</TableHead>
                  {data.roles.map((role) => (
                    <TableHead key={role.role} className="min-w-40 align-top">
                      <div className="space-y-1 py-2">
                        <span className="font-medium text-foreground">
                          {role.label}
                        </span>
                        <p className="whitespace-normal text-xs font-normal text-muted-foreground">
                          {role.description}
                        </p>
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.actions.map((action, index) => {
                  const previousCategory = data.actions[index - 1]?.category;
                  return (
                    <TableRow key={action.action}>
                      <TableCell className="pl-6 align-top">
                        <div className="space-y-1">
                          {action.category !== previousCategory && (
                            <Badge variant="outline" className="mb-1">
                              {action.category}
                            </Badge>
                          )}
                          <p className="font-medium">{action.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {action.description}
                          </p>
                        </div>
                      </TableCell>
                      {data.roles.map((role) => {
                        const permitted = role.permissions.includes(
                          action.action,
                        );
                        return (
                          <TableCell
                            key={`${role.role}-${action.action}`}
                            className="text-center align-middle"
                          >
                            {permitted ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600">
                                <Check className="h-4 w-4" aria-hidden="true" />
                                <span className="sr-only">Permitted</span>
                              </span>
                            ) : (
                              <span className="inline-flex text-muted-foreground">
                                <Minus className="h-4 w-4" aria-hidden="true" />
                                <span className="sr-only">Not permitted</span>
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
