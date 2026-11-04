import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck } from "lucide-react";
import type { PersonProfileView } from "@sfa/shared";
import { DetailCard } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * The person's role(s), and the way to the existing per-user permissions
 * page (PAC-162) for a viewer who may open it (`agency:roles:read`, the
 * permission that route demands). Roles are display names — nothing here
 * decides anything from them.
 */
export function RoleCard({
  profile,
  canUpdatePermissions,
}: {
  profile: PersonProfileView;
  canUpdatePermissions: boolean;
}) {
  const roles = profile.user.roles;
  return (
    <DetailCard
      title="Role & permissions"
      icon={ShieldCheck}
      action={
        canUpdatePermissions ? (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/settings/users/${profile.user.id}/permissions`}>
              Update permissions
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        ) : undefined
      }
    >
      {roles.length ? (
        <div className="flex flex-wrap gap-1.5">
          {roles.map((role) => (
            <Badge key={role.id} size="sm" className="bg-primary/12 font-normal text-primary">
              {role.name}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No role assigned.</p>
      )}
    </DetailCard>
  );
}
