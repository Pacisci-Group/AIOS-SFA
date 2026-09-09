import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pageLevelMap, type PageLevelOverride } from '@sfa/shared';
import {
  getUser,
  updateUserPermissions,
  type AgencyUserDetail,
} from '@/lib/users-api';
import { PermissionCatalogEditor } from './PermissionCatalogEditor';

function displayName(user: AgencyUserDetail): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || user.email;
}

export default function UserPermissionsPage() {
  const { userId = '' } = useParams();
  const queryClient = useQueryClient();

  const userQuery = useQuery({
    queryKey: ['user', userId],
    queryFn: () => getUser(userId),
    enabled: !!userId,
  });

  const mutation = useMutation({
    mutationFn: (overrides: PageLevelOverride[]) =>
      updateUserPermissions(userId, overrides),
    onSuccess: (updated) => {
      queryClient.setQueryData(['user', userId], updated);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  if (userQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Loading user…
      </div>
    );
  }

  if (userQuery.isError || !userQuery.data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground text-sm">
        <p>User not found.</p>
        <Link to="/settings/users" className="text-primary">
          Back to users
        </Link>
      </div>
    );
  }

  const user = userQuery.data;

  return (
    <PermissionCatalogEditor
      title={`Permissions — ${displayName(user)}`}
      subtitle="Assign Page Access"
      initialLevels={pageLevelMap(user.effectivePermissions ?? [])}
      roleDefaults={pageLevelMap(user.roleDefaultPermissions ?? [])}
      onSave={(overrides) => mutation.mutate(overrides)}
      saving={mutation.isPending}
      saved={mutation.isSuccess}
      error={mutation.isError ? (mutation.error as Error).message : null}
      backTo="/settings/users"
    />
  );
}
