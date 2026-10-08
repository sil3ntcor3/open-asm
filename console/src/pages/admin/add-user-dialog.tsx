import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkspaceSelector } from '@/hooks/useWorkspaceSelector';
import {
  getWorkspaceRoles,
  provisionPlatformUser,
  rbacKeys,
  type PlatformRole,
  type WorkspaceAssignment,
} from '@/services/apis/rbac';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2Icon, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

interface WorkspaceSummary {
  id: string;
  name: string;
}

function WorkspaceAssignmentRow({
  workspace,
  assignment,
  onChange,
}: {
  workspace: WorkspaceSummary;
  assignment: WorkspaceAssignment | undefined;
  onChange: (assignment: WorkspaceAssignment | null) => void;
}) {
  const { data: roles = [], isLoading } = useQuery({
    queryKey: rbacKeys.roles(workspace.id),
    queryFn: () => getWorkspaceRoles(workspace.id),
  });
  const assignableRoles = roles.filter((role) => role.key !== 'owner');

  useEffect(() => {
    if (assignment && !assignment.roleId && assignableRoles[0]) {
      onChange({
        workspaceId: workspace.id,
        roleId: assignableRoles[0].id,
      });
    }
  }, [assignableRoles, assignment, onChange, workspace.id]);

  return (
    <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_220px] sm:items-center">
      <div className="flex items-center gap-3">
        <Checkbox
          id={`workspace-${workspace.id}`}
          checked={Boolean(assignment)}
          onCheckedChange={(checked) =>
            onChange(
              checked
                ? {
                    workspaceId: workspace.id,
                    roleId: assignableRoles[0]?.id ?? '',
                  }
                : null,
            )
          }
        />
        <Label htmlFor={`workspace-${workspace.id}`}>{workspace.name}</Label>
      </div>
      {assignment && (
        <Select
          value={assignment.roleId}
          onValueChange={(roleId) =>
            onChange({ workspaceId: workspace.id, roleId })
          }
          disabled={isLoading || assignableRoles.length === 0}
        >
          <SelectTrigger aria-label={`${workspace.name} role`}>
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
      )}
    </div>
  );
}

/** Guided account creation with explicit platform and workspace access scopes. */
export function AddUserDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [platformRole, setPlatformRole] = useState<PlatformRole>('user');
  const [assignmentMode, setAssignmentMode] = useState<'none' | 'assign'>(
    'none',
  );
  const [assignments, setAssignments] = useState<WorkspaceAssignment[]>([]);
  const [validationMessage, setValidationMessage] = useState('');
  const { selectedWorkspace, workspaces } = useWorkspaceSelector();
  const queryClient = useQueryClient();

  const workspaceSummaries = workspaces as WorkspaceSummary[];
  const workspaceNames = useMemo(
    () => new Map(workspaceSummaries.map((workspace) => [workspace.id, workspace.name])),
    [workspaceSummaries],
  );

  const reset = () => {
    setStep(1);
    setName('');
    setEmail('');
    setPassword('');
    setPlatformRole('user');
    setAssignmentMode('none');
    setAssignments([]);
    setValidationMessage('');
  };

  const { mutate: createUser, isPending } = useMutation({
    mutationFn: (data: Parameters<typeof provisionPlatformUser>[0]) =>
      provisionPlatformUser(data),
    onSuccess: () => {
      toast.success('User created successfully.');
      setOpen(false);
      reset();
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create user.');
    },
  });

  const updateAssignment = (
    workspaceId: string,
    assignment: WorkspaceAssignment | null,
  ) => {
    setAssignments((current) => {
      const remaining = current.filter(
        (candidate) => candidate.workspaceId !== workspaceId,
      );
      return assignment ? [...remaining, assignment] : remaining;
    });
  };

  const continueFromIdentity = () => {
    if (!name.trim()) return setValidationMessage('Name is required.');
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return setValidationMessage('Enter a valid email address.');
    }
    if (password.length < 8) {
      return setValidationMessage('Password must be at least 8 characters.');
    }
    setValidationMessage('');
    if (platformRole === 'admin') {
      setAssignmentMode('none');
      setAssignments([]);
    }
    setStep(2);
  };

  const continueFromAccess = () => {
    if (
      platformRole === 'user' &&
      assignmentMode === 'assign' &&
      (assignments.length === 0 || assignments.some(({ roleId }) => !roleId))
    ) {
      return setValidationMessage(
        'Select at least one workspace and a role for each selection.',
      );
    }
    setValidationMessage('');
    setStep(3);
  };

  const handleModeChange = (mode: 'none' | 'assign') => {
    setAssignmentMode(mode);
    if (mode === 'none') {
      setAssignments([]);
      return;
    }
    if (assignments.length === 0 && selectedWorkspace) {
      setAssignments([{ workspaceId: selectedWorkspace, roleId: '' }]);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <UserPlus />
          Add
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4 pr-8">
            <DialogTitle>Create user</DialogTitle>
            <Badge variant="outline">Step {step} of 3</Badge>
          </div>
          <DialogDescription>
            {step === 1 && 'Set account identity and platform-wide access.'}
            {step === 2 && 'Choose which workspaces this account can access.'}
            {step === 3 && 'Review access before creating the account.'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-user-name">Name</Label>
              <Input
                id="new-user-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Jane Smith"
                disabled={isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-email">Email</Label>
              <Input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="jane@example.com"
                disabled={isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-password">Temporary password</Label>
              <Input
                id="new-user-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                disabled={isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-user-platform-role">Platform role</Label>
              <Select
                value={platformRole}
                onValueChange={(value) => setPlatformRole(value as PlatformRole)}
                disabled={isPending}
              >
                <SelectTrigger id="new-user-platform-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Platform Admin</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Platform Admins inherit full access to every workspace.
              </p>
            </div>
          </div>
        )}

        {step === 2 && platformRole === 'admin' && (
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            Platform Admins automatically have full access to every current and
            future workspace. No membership assignment is needed.
          </div>
        )}

        {step === 2 && platformRole === 'user' && (
          <div className="space-y-4 py-2">
            <RadioGroup
              value={assignmentMode}
              onValueChange={(value) =>
                handleModeChange(value as 'none' | 'assign')
              }
            >
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <RadioGroupItem value="none" id="access-none" />
                <Label htmlFor="access-none" className="grid gap-1">
                  <span>Create without workspace access</span>
                  <span className="font-normal text-muted-foreground">
                    The account can sign in but will not see workspace data.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <RadioGroupItem value="assign" id="access-assign" />
                <Label htmlFor="access-assign" className="grid gap-1">
                  <span>Assign workspace access now</span>
                  <span className="font-normal text-muted-foreground">
                    Select one role for each workspace.
                  </span>
                </Label>
              </div>
            </RadioGroup>
            {assignmentMode === 'assign' && (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {workspaceSummaries.map((workspace) => (
                  <WorkspaceAssignmentRow
                    key={workspace.id}
                    workspace={workspace}
                    assignment={assignments.find(
                      (candidate) => candidate.workspaceId === workspace.id,
                    )}
                    onChange={(assignment) =>
                      updateAssignment(workspace.id, assignment)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 py-2 text-sm">
            <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Account</p>
                <p className="font-medium">{name}</p>
                <p className="text-muted-foreground">{email}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Platform role</p>
                <p className="font-medium">
                  {platformRole === 'admin' ? 'Platform Admin' : 'User'}
                </p>
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <p className="mb-2 font-medium">Workspace access</p>
              {platformRole === 'admin' ? (
                <p className="text-muted-foreground">
                  All workspaces through Platform Admin inheritance
                </p>
              ) : assignments.length > 0 ? (
                <ul className="space-y-1 text-muted-foreground">
                  {assignments.map((assignment) => (
                    <li key={assignment.workspaceId}>
                      {workspaceNames.get(assignment.workspaceId)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No workspace access</p>
              )}
            </div>
          </div>
        )}

        {validationMessage && (
          <p role="alert" className="text-sm text-destructive">
            {validationMessage}
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {step > 1 && (
              <Button
                variant="ghost"
                onClick={() => {
                  setValidationMessage('');
                  setStep((current) => current - 1);
                }}
                disabled={isPending}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            {step < 3 ? (
              <Button
                onClick={step === 1 ? continueFromIdentity : continueFromAccess}
                disabled={isPending}
              >
                Continue
              </Button>
            ) : (
              <Button
                onClick={() =>
                  createUser({
                    name: name.trim(),
                    email: email.trim().toLowerCase(),
                    password,
                    platformRole,
                    workspaceAssignments:
                      platformRole === 'user' ? assignments : [],
                  })
                }
                disabled={isPending}
              >
                {isPending && (
                  <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create user
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
