import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspacePermissions } from '@/hooks/useWorkspacePermissions';
import { useWorkspaceSelector } from '@/hooks/useWorkspaceSelector';
import {
  createWorkspaceRole,
  deleteWorkspaceRole,
  getWorkspaceRoles,
  rbacKeys,
  updateWorkspaceRole,
  type WorkspaceAction,
  type WorkspaceRole,
} from '@/services/apis/rbac';
import { useWorkspacesControllerGetWorkspaceRolePermissions } from '@/services/apis/gen/queries';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, LockKeyhole, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface RoleEditorState {
  roleId: string | null;
  name: string;
  description: string;
  permissions: WorkspaceAction[];
}

/** Defines protected defaults and editable custom roles for one workspace. */
export default function WorkspaceRolePermissions() {
  const { selectedWorkspace } = useWorkspaceSelector();
  const { can } = useWorkspacePermissions();
  const canManageRoles = can('role.manage');
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<RoleEditorState | null>(null);

  const { data: catalog, isLoading: catalogLoading, isError } =
    useWorkspacesControllerGetWorkspaceRolePermissions();
  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: rbacKeys.roles(selectedWorkspace),
    queryFn: () => getWorkspaceRoles(selectedWorkspace),
    enabled: Boolean(selectedWorkspace),
  });

  const refreshRoles = () =>
    queryClient.invalidateQueries({ queryKey: rbacKeys.roles(selectedWorkspace) });

  const { mutate: saveRole, isPending: isSaving } = useMutation({
    mutationFn: (state: RoleEditorState) =>
      state.roleId
        ? updateWorkspaceRole(selectedWorkspace, state.roleId, {
            name: state.name.trim(),
            description: state.description.trim(),
            permissions: state.permissions,
          })
        : createWorkspaceRole(selectedWorkspace, {
            name: state.name.trim(),
            description: state.description.trim(),
            permissions: state.permissions,
          }),
    onSuccess: () => {
      toast.success(editor?.roleId ? 'Custom role updated.' : 'Custom role created.');
      setEditor(null);
      void refreshRoles();
    },
    onError: (error: Error) =>
      toast.error(error.message || 'Unable to save custom role.'),
  });

  const { mutate: removeRole, isPending: isDeleting } = useMutation({
    mutationFn: (roleId: string) =>
      deleteWorkspaceRole(selectedWorkspace, roleId),
    onSuccess: () => {
      toast.success('Custom role deleted.');
      void refreshRoles();
    },
    onError: (error: Error) =>
      toast.error(error.message || 'The role may still be assigned to members.'),
  });

  if (catalogLoading || (rolesLoading && Boolean(selectedWorkspace))) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isError || !catalog) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          The workspace permission catalog is currently unavailable.
        </CardContent>
      </Card>
    );
  }

  const actions = catalog.actions.map((action) => ({
    ...action,
    action: action.action as WorkspaceAction,
  }));

  const openNewRole = () =>
    setEditor({
      roleId: null,
      name: '',
      description: '',
      permissions: ['workspace.read'],
    });

  const openRole = (role: WorkspaceRole) =>
    setEditor({
      roleId: role.id,
      name: role.name,
      description: role.description,
      permissions: [...role.permissions],
    });

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="platform-roles-title">
        <div>
          <h4 id="platform-roles-title" className="font-medium">
            Platform roles
          </h4>
          <p className="text-sm text-muted-foreground">
            Platform roles control application-wide administration and are
            separate from workspace responsibilities.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Platform Admin</CardTitle>
              <CardDescription>
                Full access to every workspace and every application setting,
                including user and administrator management.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">User</CardTitle>
              <CardDescription>
                Sees only workspaces where membership has been explicitly
                granted, using one workspace role in each.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="workspace-roles-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 id="workspace-roles-title" className="font-medium">
              Workspace roles
            </h4>
            <p className="text-sm text-muted-foreground">
              Protected defaults provide a safe baseline. Custom roles combine
              the exact responsibilities your team needs.
            </p>
          </div>
          {canManageRoles && (
            <Button variant="outline" onClick={openNewRole}>
              <Plus className="mr-2 h-4 w-4" />
              Create custom role
            </Button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.id} className="gap-4">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{role.name}</CardTitle>
                    <CardDescription>{role.description}</CardDescription>
                  </div>
                  {role.protected ? (
                    <Badge variant="secondary" className="gap-1">
                      <LockKeyhole className="h-3 w-3" />
                      Protected default
                    </Badge>
                  ) : (
                    <Badge variant="outline">Custom</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {role.permissions.length} permissions
                </span>
                {!role.protected && canManageRoles && (
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${role.name}`}
                      onClick={() => openRole(role)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <ConfirmDialog
                      title="Delete custom role?"
                      description={`${role.name} can be deleted only when no members are assigned to it.`}
                      onConfirm={() => removeRole(role.id)}
                      confirmText="Delete role"
                      cancelText="Cancel"
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Delete ${role.name}`}
                          disabled={isDeleting}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      }
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="permission-matrix-title">
        <div>
          <h4 id="permission-matrix-title" className="font-medium">
            Permission matrix
          </h4>
          <p className="text-sm text-muted-foreground">
            Owner and Platform Admin access always includes every workspace
            permission. Role management cannot be delegated to a custom role.
          </p>
        </div>
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-64 pl-6">Action</TableHead>
                  {roles.map((role) => (
                    <TableHead key={role.id} className="min-w-40">
                      {role.name}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.map((action) => (
                  <TableRow key={action.action}>
                    <TableCell className="pl-6 align-top">
                      <p className="font-medium">{action.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {action.description}
                      </p>
                    </TableCell>
                    {roles.map((role) => {
                      const permitted = role.permissions.includes(action.action);
                      return (
                        <TableCell key={`${role.id}-${action.action}`}>
                          {permitted ? (
                            <Check
                              className="mx-auto h-4 w-4 text-emerald-600"
                              aria-label="Permitted"
                            />
                          ) : (
                            <Minus
                              className="mx-auto h-4 w-4 text-muted-foreground"
                              aria-label="Not permitted"
                            />
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editor?.roleId ? 'Edit custom role' : 'Create custom role'}
            </DialogTitle>
            <DialogDescription>
              Custom roles belong only to this workspace. Select the actions
              members assigned to this role may perform.
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="role-name">Role name</Label>
                <Input
                  id="role-name"
                  value={editor.name}
                  onChange={(event) =>
                    setEditor({ ...editor, name: event.target.value })
                  }
                  placeholder="Discovery Lead"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role-description">Description</Label>
                <Textarea
                  id="role-description"
                  value={editor.description}
                  onChange={(event) =>
                    setEditor({ ...editor, description: event.target.value })
                  }
                  placeholder="Describe when this role should be assigned."
                />
              </div>
              <div className="space-y-2">
                <Label>Permissions</Label>
                <div className="grid max-h-72 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
                  {actions.map((action) => {
                    const nonDelegable = action.action === 'role.manage';
                    const checked = editor.permissions.includes(action.action);
                    return (
                      <div key={action.action} className="flex items-start gap-3 rounded-md p-2">
                        <Checkbox
                          id={`permission-${action.action}`}
                          checked={checked}
                          disabled={nonDelegable}
                          onCheckedChange={(nextChecked) =>
                            setEditor({
                              ...editor,
                              permissions: nextChecked
                                ? [...editor.permissions, action.action]
                                : editor.permissions.filter(
                                    (permission) => permission !== action.action,
                                  ),
                            })
                          }
                        />
                        <Label htmlFor={`permission-${action.action}`} className="grid gap-1">
                          <span>{action.label}</span>
                          <span className="font-normal text-muted-foreground">
                            {nonDelegable
                              ? 'Reserved for the Workspace Owner and Platform Admins.'
                              : action.description}
                          </span>
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              onClick={() => editor && saveRole(editor)}
              disabled={isSaving || !editor?.name.trim()}
            >
              Save role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
