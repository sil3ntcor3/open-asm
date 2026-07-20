import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useWorkspacePermissions } from '@/hooks/useWorkspacePermissions';
import { useWorkspaceSelector } from '@/hooks/useWorkspaceSelector';
import {
  addWorkspaceMember,
  getWorkspaceMembers,
  getWorkspaceRoles,
  rbacKeys,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  type WorkspaceMember,
} from '@/services/apis/rbac';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2Icon, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

/** Manages relational workspace memberships with one role per member. */
export default function WorkspaceMembers() {
  const queryClient = useQueryClient();
  const { selectedWorkspace, workspaces } = useWorkspaceSelector();
  const selected = workspaces.find(
    (workspace) => workspace.id === selectedWorkspace,
  );
  const { can } = useWorkspacePermissions();
  const canManage = can('member.manage');
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [memberToRemove, setMemberToRemove] =
    useState<WorkspaceMember | null>(null);

  const { data: members = [], isLoading } = useQuery({
    queryKey: rbacKeys.members(selectedWorkspace),
    queryFn: () => getWorkspaceMembers(selectedWorkspace),
    enabled: Boolean(selectedWorkspace),
  });
  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: rbacKeys.roles(selectedWorkspace),
    queryFn: () => getWorkspaceRoles(selectedWorkspace),
    enabled: Boolean(selectedWorkspace),
  });
  const assignableRoles = roles.filter((role) => role.key !== 'owner');

  useEffect(() => {
    if (!roleId && assignableRoles[0]) setRoleId(assignableRoles[0].id);
  }, [assignableRoles, roleId]);

  const refreshMembers = () =>
    queryClient.invalidateQueries({
      queryKey: rbacKeys.members(selectedWorkspace),
    });

  const { mutate: addMember, isPending: isAdding } = useMutation({
    mutationFn: () =>
      addWorkspaceMember(selectedWorkspace, {
        email: email.trim().toLowerCase(),
        roleId,
      }),
    onSuccess: () => {
      toast.success('Workspace member added.');
      setEmail('');
      setAddOpen(false);
      void refreshMembers();
    },
    onError: (error: Error) =>
      toast.error(error.message || 'Unable to add workspace member.'),
  });

  const { mutate: updateRole, isPending: isUpdating } = useMutation({
    mutationFn: ({ userId, nextRoleId }: { userId: string; nextRoleId: string }) =>
      updateWorkspaceMemberRole(selectedWorkspace, userId, nextRoleId),
    onSuccess: () => {
      toast.success('Workspace role updated.');
      void refreshMembers();
    },
    onError: (error: Error) =>
      toast.error(error.message || 'Unable to update workspace role.'),
  });

  const { mutate: removeMember, isPending: isRemoving } = useMutation({
    mutationFn: (userId: string) =>
      removeWorkspaceMember(selectedWorkspace, userId),
    onSuccess: () => {
      toast.success('Workspace member removed.');
      setMemberToRemove(null);
      void refreshMembers();
    },
    onError: (error: Error) =>
      toast.error(error.message || 'Unable to remove workspace member.'),
  });

  if (!selectedWorkspace) {
    return (
      <Card>
        <CardContent className="text-sm text-muted-foreground">
          Select a workspace to manage its members.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Platform accounts and workspace access are managed separately. Each
          member has one role in this workspace.
        </p>
        {canManage && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <UserPlus className="h-4 w-4" />
                Add member
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add workspace member</DialogTitle>
                <DialogDescription>
                  Give an existing platform account access to {selected?.name}.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="member-email">Account email</Label>
                  <Input
                    id="member-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="user@example.com"
                    disabled={isAdding}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="member-role">Workspace role</Label>
                  <Select
                    value={roleId}
                    onValueChange={setRoleId}
                    disabled={isAdding || rolesLoading}
                  >
                    <SelectTrigger id="member-role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignableRoles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAddOpen(false)}
                  disabled={isAdding}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => addMember()}
                  disabled={isAdding || !email.trim() || !roleId}
                >
                  {isAdding && (
                    <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Add member
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card className="gap-0 py-0">
        <CardContent className="px-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : members.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Member</TableHead>
                  <TableHead>Workspace role</TableHead>
                  {canManage && <TableHead className="w-14" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarImage
                            src={member.image ?? undefined}
                            alt={member.name}
                          />
                          <AvatarFallback>{initials(member.name)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{member.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {member.roleKey === 'owner' || !canManage ? (
                        <Badge variant="secondary">{member.roleName}</Badge>
                      ) : (
                        <Select
                          value={member.roleId}
                          onValueChange={(nextRoleId) =>
                            updateRole({ userId: member.id, nextRoleId })
                          }
                          disabled={isUpdating || isRemoving}
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {assignableRoles.map((role) => (
                              <SelectItem key={role.id} value={role.id}>
                                {role.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="pr-6 text-right">
                        {member.roleKey !== 'owner' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={`Remove ${member.name}`}
                            onClick={() => setMemberToRemove(member)}
                            disabled={isUpdating || isRemoving}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="p-6 text-sm text-muted-foreground">
              No workspace members found.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={memberToRemove !== null}
        onOpenChange={(nextOpen) => !nextOpen && setMemberToRemove(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove workspace access?</DialogTitle>
            <DialogDescription>
              {memberToRemove?.name} will lose access to {selected?.name}. Their
              platform account will remain active.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMemberToRemove(null)}
              disabled={isRemoving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isRemoving || !memberToRemove}
              onClick={() => memberToRemove && removeMember(memberToRemove.id)}
            >
              {isRemoving && (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              )}
              Remove access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
