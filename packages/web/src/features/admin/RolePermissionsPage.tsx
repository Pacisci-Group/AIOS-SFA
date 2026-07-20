import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pageLevelMap, type PageLevelOverride } from '@sfa/shared';
import {
  listRoles,
  updateRoleLevels,
  type AgencyRole,
} from '@/lib/roles-api';
import { PermissionCatalogEditor } from './PermissionCatalogEditor';

export default function RolePermissionsPage() {
  const queryClient = useQueryClient();
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: listRoles });

  const [selectedRoleId, setSelectedRoleId] = useState<string>('');

  useEffect(() => {
    if (!selectedRoleId && rolesQuery.data?.length) {
      setSelectedRoleId(rolesQuery.data[0]._id);
    }
  }, [rolesQuery.data, selectedRoleId]);

  const selectedRole: AgencyRole | undefined = rolesQuery.data?.find(
    (r) => r._id === selectedRoleId,
  );

  const mutation = useMutation({
    mutationFn: (levels: PageLevelOverride[]) =>
      updateRoleLevels(selectedRoleId, levels),
    onSuccess: (updated) => {
      queryClient.setQueryData<AgencyRole[]>(['roles'], (prev) =>
        prev?.map((r) => (r._id === updated._id ? updated : r)),
      );
    },
  });

  if (rolesQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0F19] text-[#64748B] text-sm">
        Loading roles…
      </div>
    );
  }

  if (!rolesQuery.data?.length || !selectedRole) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-[#0B0F19] text-[#94A3B8] text-sm">
        <p>No roles found for this agency.</p>
        <Link to="/" className="text-[#38BDF8]">
          Back to navigator
        </Link>
      </div>
    );
  }

  const roleSelector = (
    <select
      value={selectedRoleId}
      onChange={(e) => setSelectedRoleId(e.target.value)}
      className="px-3 py-2 rounded-lg text-sm bg-[#161F30] text-[#E2E8F0] outline-none"
      style={{ border: '1px solid rgba(255,255,255,0.1)' }}
    >
      {rolesQuery.data.map((role) => (
        <option key={role._id} value={role._id}>
          {role.name}
        </option>
      ))}
    </select>
  );

  return (
    <PermissionCatalogEditor
      key={selectedRole._id}
      title={`Edit Role — ${selectedRole.name}`}
      subtitle="Set Page Access"
      initialLevels={pageLevelMap(selectedRole.permissions)}
      onSave={(levels) => mutation.mutate(levels)}
      saving={mutation.isPending}
      saved={mutation.isSuccess}
      error={mutation.isError ? (mutation.error as Error).message : null}
      headerControl={roleSelector}
      readOnly={selectedRole.grantsAllEnabledModules}
      readOnlyNotice={`The ${selectedRole.name} role automatically has full access to every enabled module. Its access is not controlled by per-page levels.`}
    />
  );
}
