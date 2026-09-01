import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pageLevelMap, type PageLevelOverride } from '@sfa/shared';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/auth-context';
import { ApiError } from '@/lib/api-client';
import {
  deleteRole,
  listPermissions,
  listRoles,
  updateRoleLevels,
  type AgencyRole,
} from '@/lib/roles-api';
import { CreateRoleDialog } from './CreateRoleDialog';
import { PermissionCatalogEditor } from './PermissionCatalogEditor';

export default function RolePermissionsPage() {
  const queryClient = useQueryClient();
  const { user, refreshUser } = useAuth();
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: listRoles });

  // The capability catalog is global and effectively static, so it is worth
  // caching hard — it changes only when the code's permission constants do.
  const permissionsQuery = useQuery({
    queryKey: ['permissions'],
    queryFn: listPermissions,
    staleTime: 5 * 60_000,
  });

  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!selectedRoleId && rolesQuery.data?.length) {
      setSelectedRoleId(rolesQuery.data[0]._id);
    }
  }, [rolesQuery.data, selectedRoleId]);

  const selectedRole: AgencyRole | undefined = rolesQuery.data?.find(
    (r) => r._id === selectedRoleId,
  );

  const adminPermissions = (permissionsQuery.data ?? []).filter(
    (permission) => permission.kind === 'agency',
  );

  const mutation = useMutation({
    mutationFn: (input: {
      levels: PageLevelOverride[];
      adminPermissions?: string[];
    }) =>
      updateRoleLevels(selectedRoleId, input.levels, input.adminPermissions),
    onSuccess: async (updated) => {
      queryClient.setQueryData<AgencyRole[]>(['roles'], (prev) =>
        prev?.map((r) => (r._id === updated._id ? updated : r)),
      );
      // Editing a role you hold changes your own nav and route access. Without
      // this the sidebar keeps offering pages that have already started 403ing.
      if (user?.roles?.includes(updated.name)) await refreshUser();
    },
  });

  const remove = useMutation({
    mutationFn: () => deleteRole(selectedRoleId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role deleted');
      setConfirmDelete(false);
      setSelectedRoleId('');
    },
    onError: (error) => {
      // Three different 409s land here — system role, owner role, and "N users
      // still hold this". The server's message names which; showing it as-is is
      // the difference between an actionable error and "could not delete".
      toast.error(
        error instanceof ApiError ? error.message : 'Could not delete the role.',
      );
    },
  });

  if (rolesQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading roles…
      </div>
    );
  }

  if (!rolesQuery.data?.length || !selectedRole) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background text-slate-400 text-sm">
        <p>No roles found for this agency.</p>
        <Link to="/" className="text-primary">
          Back to navigator
        </Link>
      </div>
    );
  }

  const holders = selectedRole.userCount ?? 0;
  const deleteBlockedReason = selectedRole.isSystemTemplate
    ? 'System roles cannot be deleted.'
    : holders > 0
      ? `${holders} user${holders === 1 ? '' : 's'} still hold this role.`
      : null;

  const headerControls = (
    <div className="flex items-center gap-2">
      <Select value={selectedRoleId} onValueChange={setSelectedRoleId}>
        <SelectTrigger className="w-[150px] border-border bg-card text-sm sm:w-[200px]">
          <SelectValue placeholder="Select a role" />
        </SelectTrigger>
        <SelectContent>
          {rolesQuery.data.map((role) => (
            <SelectItem key={role._id} value={role._id}>
              {role.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="icon-sm"
        title="New role"
        aria-label="New role"
        onClick={() => setCreateOpen(true)}
        className="text-muted-foreground hover:text-foreground"
      >
        <Plus size={16} />
      </Button>

      {/*
        Rendered disabled rather than hidden when deletion is blocked: an owner
        looking for the button needs to learn *why* it is unavailable, and a
        missing control teaches nothing. The tooltip carries the reason.
      */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Delete role"
              aria-label="Delete role"
              disabled={!!deleteBlockedReason || remove.isPending}
              onClick={() => setConfirmDelete(true)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={16} />
            </Button>
          </span>
        </TooltipTrigger>
        {deleteBlockedReason && (
          <TooltipContent>{deleteBlockedReason}</TooltipContent>
        )}
      </Tooltip>
    </div>
  );

  return (
    <>
      <PermissionCatalogEditor
        key={selectedRole._id}
        title={`Edit Role — ${selectedRole.name}`}
        subtitle="Set Page Access"
        initialLevels={pageLevelMap(selectedRole.permissions)}
        adminPermissions={adminPermissions}
        initialAdminPermissions={selectedRole.permissions.filter((p) =>
          p.startsWith('agency:'),
        )}
        onSave={(levels, admin) =>
          mutation.mutate({ levels, adminPermissions: admin })
        }
        saving={mutation.isPending}
        saved={mutation.isSuccess}
        error={mutation.isError ? (mutation.error as Error).message : null}
        headerControl={headerControls}
        readOnly={selectedRole.grantsAllEnabledModules}
        readOnlyNotice={`The ${selectedRole.name} role automatically has full access to every enabled module. Its access is not controlled by per-page levels.`}
      />

      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(role) => setSelectedRoleId(role._id)}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{selectedRole.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The role and everything it grants are removed. Nobody currently
              holds it, so no one loses access. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                // Keep the dialog up while the request is in flight; Radix
                // closes on action click by default, which would hide a 409
                // behind a toast on a page that had already moved on.
                e.preventDefault();
                remove.mutate();
              }}
            >
              Delete role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
