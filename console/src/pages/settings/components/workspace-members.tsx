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
import { useWorkspaceSelector } from '@/hooks/useWorkspaceSelector';
import {
  getWorkspacesControllerGetWorkspaceMembersQueryKey,
  type WorkspaceMemberResponseDto,
  useWorkspacesControllerAddWorkspaceMember,
  useWorkspacesControllerGetWorkspaceMembers,
  useWorkspacesControllerRemoveWorkspaceMember,
  useWorkspacesControllerUpdateWorkspaceMemberRole,
} from '@/services/apis/gen/queries';
import {
  workspaceRoleLabels,
  workspaceRoleOptions,
  type AssignableWorkspaceRole,
} from '@/utils/workspace-roles';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2Icon, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

export default function WorkspaceMembers() {
  const queryClient = useQueryClient();
  const { selectedWorkspace, workspaces } = useWorkspaceSelector();
  const selected = workspaces.find(
    (workspace) => workspace.id === selectedWorkspace,
  );
  const canManage = selected?.role === 'owner';
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableWorkspaceRole>('viewer');
  const [memberToRemove, setMemberToRemove] =
    useState<WorkspaceMemberResponseDto | null>(null);

  const membersQueryKey =
    getWorkspacesControllerGetWorkspaceMembersQueryKey(selectedWorkspace);
  const refreshMembers = () =>
    queryClient.invalidateQueries({ queryKey: membersQueryKey });

  const { data: members, isLoading } =
    useWorkspacesControllerGetWorkspaceMembers(selectedWorkspace, {
      query: { enabled: Boolean(selectedWorkspace) },
    });

  const { mutate: addMember, isPending: isAdding } =
    useWorkspacesControllerAddWorkspaceMember({
      mutation: {
        onSuccess: () => {
          toast.success('Workspace member added.');
          setEmail('');
          setRole('viewer');
          setAddOpen(false);
          void refreshMembers();
        },
        onError: () => toast.error('Unable to add workspace member.'),
      },
    });

  const { mutate: updateRole, isPending: isUpdating } =
    useWorkspacesControllerUpdateWorkspaceMemberRole({
      mutation: {
        onSuccess: () => {
          toast.success('Workspace role updated.');
          void refreshMembers();
        },
        onError: () => toast.error('Unable to update workspace role.'),
      },
    });

  const { mutate: removeMember, isPending: isRemoving } =
    useWorkspacesControllerRemoveWorkspaceMember({
      mutation: {
        onSuccess: () => {
          toast.success('Workspace member removed.');
          setMemberToRemove(null);
          void refreshMembers();
        },
        onError: () => toast.error('Unable to remove workspace member.'),
      },
    });

  const submitMember = () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !selectedWorkspace) return;
    addMember({
      id: selectedWorkspace,
      data: { email: normalizedEmail, role },
    });
  };

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
          Workspace roles control access independently of the Admin and User
          platform roles.
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
                  Add an existing platform account to {selected?.name}.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="member-email">Email</Label>
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
                    value={role}
                    onValueChange={(value) =>
                      setRole(value as AssignableWorkspaceRole)
                    }
                    disabled={isAdding}
                  >
                    <SelectTrigger id="member-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {workspaceRoleOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
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
                  onClick={submitMember}
                  disabled={isAdding || email.trim().length === 0}
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
          ) : members?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Member</TableHead>
                  <TableHead>Workspace role</TableHead>
                  {canManage && <TableHead className="w-14" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const image =
                    typeof member.image === 'string' ? member.image : undefined;
                  return (
                    <TableRow key={member.id}>
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={image} alt={member.name} />
                            <AvatarFallback>
                              {initials(member.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{member.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {member.role === 'owner' || !canManage ? (
                          <Badge variant="secondary">
                            {workspaceRoleLabels[member.role] ?? member.role}
                          </Badge>
                        ) : (
                          <Select
                            value={member.role}
                            onValueChange={(nextRole) =>
                              updateRole({
                                id: selectedWorkspace,
                                userId: member.id,
                                data: {
                                  role: nextRole as AssignableWorkspaceRole,
                                },
                              })
                            }
                            disabled={isUpdating || isRemoving}
                          >
                            <SelectTrigger className="w-48">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {workspaceRoleOptions.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      {canManage && (
                        <TableCell className="pr-6 text-right">
                          {member.role !== 'owner' && (
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
                  );
                })}
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
        onOpenChange={(open) => !open && setMemberToRemove(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove workspace member?</DialogTitle>
            <DialogDescription>
              {memberToRemove?.name} will lose access to {selected?.name}. Their
              platform account will not be deleted.
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
              onClick={() => {
                if (memberToRemove) {
                  removeMember({
                    id: selectedWorkspace,
                    userId: memberToRemove.id,
                  });
                }
              }}
            >
              {isRemoving && (
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              )}
              Remove member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
