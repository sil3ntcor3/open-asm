import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { authClient } from '@/utils/authClient';
import { useWorkspaceSelector } from '@/hooks/useWorkspaceSelector';
import { workspacesControllerAddWorkspaceMember } from '@/services/apis/gen/queries';
import {
  workspaceRoleOptions,
  type AssignableWorkspaceRole,
} from '@/utils/workspace-roles';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2Icon, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

const formSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  platformRole: z.enum(['user', 'admin']),
  workspaceRole: z.enum(['viewer', 'analyst', 'operator', 'security_admin']),
});

type FormValues = z.infer<typeof formSchema>;

export function AddUserDialog() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { selectedWorkspace, workspaces } = useWorkspaceSelector();
  const currentWorkspace = workspaces.find(
    (workspace) => workspace.id === selectedWorkspace,
  );
  const canAssignWorkspaceRole = currentWorkspace?.role === 'owner';

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      platformRole: 'user',
      workspaceRole: 'viewer',
    },
  });

  const { mutate: createUser, isPending } = useMutation({
    mutationFn: async (values: FormValues) => {
      const result = await authClient.admin.createUser({
        name: values.name,
        email: values.email,
        password: values.password,
        role: values.platformRole,
      });

      if (result.error) {
        throw result.error;
      }

      if (selectedWorkspace && canAssignWorkspaceRole) {
        await workspacesControllerAddWorkspaceMember(selectedWorkspace, {
          email: values.email,
          role: values.workspaceRole as AssignableWorkspaceRole,
        });
      }

      return result;
    },
    onSuccess: () => {
      toast.success('User created successfully.');
      setOpen(false);
      form.reset();
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      return queryClient.invalidateQueries({
        queryKey: [`/api/workspaces/${selectedWorkspace}/members`],
      });
    },
    onError: () => {
      toast.error('Failed to create user.');
    },
  });

  function onSubmit(values: FormValues) {
    createUser(values);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      form.reset();
    }
    setOpen(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <UserPlus className="shrink-0" />
          <span>Add</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
          <DialogDescription>
            Create a new user account. They will be able to sign in immediately.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            id="add-user-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4 py-2"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Jane Smith"
                      {...field}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="jane@example.com"
                      {...field}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Min. 8 characters"
                      {...field}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="platformRole"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Platform role</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isPending}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="workspaceRole"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workspace role</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isPending || !canAssignWorkspaceRole}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a workspace role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {workspaceRoleOptions.map((role) => (
                        <SelectItem key={role.value} value={role.value}>
                          {role.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!canAssignWorkspaceRole && (
                    <p className="text-xs text-muted-foreground">
                      Only the workspace owner can assign workspace roles. The
                      account will be created without workspace access.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="add-user-form"
            disabled={isPending}
            className="gap-1.5"
          >
            {isPending && <Loader2Icon className="h-4 w-4 animate-spin" />}
            Create User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
