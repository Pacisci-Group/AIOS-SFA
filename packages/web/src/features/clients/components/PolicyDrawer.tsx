import {
  isCanonicalPolicyType,
  itemCountLabel,
  policyTypeHasItemCount,
  premiumTermSuffix,
  termExpirationDate,
} from '@sfa/shared';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { getPolicy } from '@/lib/policies-api';
import {
  DrawerError,
  DrawerRow,
  DrawerSection,
  DrawerSkeleton,
  money,
  shortDate,
} from './drawer-primitives';
import { NOT_AVAILABLE } from '@/lib/not-available';

interface PolicyDrawerProps {
  policyId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Summary of a policy, opened from the ticket detail. Backed by
 * `GET /policies/:id`, gated on `clients:read` OR `crm_service:read`.
 */
export function PolicyDrawer({
  policyId,
  open,
  onOpenChange,
}: PolicyDrawerProps) {
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['policy', policyId],
    queryFn: () => getPolicy(policyId as string),
    enabled: open && !!policyId,
  });

  const policy = query.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {policy ? `${policy.policyType} Policy` : 'Policy'}
          </SheetTitle>
          <SheetDescription>{policy?.policyNumber ?? 'Policy details'}</SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-4">
          {query.isPending && <DrawerSkeleton />}
          {query.isError && <DrawerError />}

          {policy && (
            <>
              <div>
                <DrawerRow label="Policy number" value={policy.policyNumber ?? NOT_AVAILABLE} />
                <DrawerRow label="Type" value={policy.policyType ?? NOT_AVAILABLE} />
                <DrawerRow label="Carrier" value={policy.carrier ?? NOT_AVAILABLE} />
                <DrawerRow
                  label="Status"
                  value={policy.policyStatus ?? (policy.active ? 'Active' : 'Inactive')}
                />
                <DrawerRow
                  label="Premium"
                  value={`${money(policy.premium)}${premiumTermSuffix(policy.policyType)}`}
                />
                {/*
                  Shown only where the count means something: the vehicle
                  types, which are the only ones asked for it — plus any
                  uncatalogued migrated type, whose stored count we cannot
                  assume is the implied 1.
                */}
                {(policyTypeHasItemCount(policy.policyType) ||
                  !isCanonicalPolicyType(policy.policyType)) && (
                  <DrawerRow
                    label={itemCountLabel(policy.policyType)}
                    value={policy.items}
                  />
                )}
                <DrawerRow
                  label="Coverage began"
                  value={shortDate(policy.effectiveDate)}
                />
                <DrawerRow label="Renews" value={shortDate(policy.renewalDate)} />
                {/*
                  Derived one day back from the renewal, matching the household
                  policy card (PAC-126). The stored `expirationDate` is empty on
                  most migrated policies and, where set, describes the term that
                  was current when the import ran — so reading it here would
                  show a CSR an em dash, or a stale date, for a policy whose
                  card shows the real one.
                */}
                <DrawerRow
                  label="Expires"
                  value={shortDate(
                    termExpirationDate(policy.renewalDate)?.toISOString() ??
                      policy.expirationDate,
                  )}
                />
              </div>

              {policy.household && (
                <DrawerSection title="Household">
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline"
                    onClick={() => navigate(`/clients/${policy.household!.id}`)}
                  >
                    {policy.household.name ?? 'View household'}
                  </button>
                </DrawerSection>
              )}

              {policy.notes && (
                <DrawerSection title="Notes">
                  <p className="text-sm text-muted-foreground">{policy.notes}</p>
                </DrawerSection>
              )}
            </>
          )}
        </div>

        <SheetFooter>
          <Button
            disabled={!policy}
            onClick={() => policy && navigate(`/policies/${policy.id}`)}
          >
            Open full page
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
