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
import { getHousehold, type ContactSummary } from '@/lib/households-api';
import {
  addressLine,
  DrawerError,
  DrawerRow,
  DrawerSection,
  DrawerSkeleton,
  money,
  shortDate,
} from './drawer-primitives';

/** `null` rather than "Unnamed" so the caller's `??` chain can keep falling through. */
function fullName(contact: ContactSummary | undefined) {
  if (!contact) return null;
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') || null
  );
}

interface HouseholdDrawerProps {
  householdId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Summary of a household, opened from the ticket detail. Backed by
 * `GET /households/:id`, which accepts `clients:read` OR `crm_service:read` —
 * so a CSR can open this without holding the Clients page permission.
 */
export function HouseholdDrawer({
  householdId,
  open,
  onOpenChange,
}: HouseholdDrawerProps) {
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['household', householdId],
    queryFn: () => getHousehold(householdId as string),
    enabled: open && !!householdId,
  });

  const household = query.data;

  /*
   * The denormalized `primaryContactName` / `primaryEmails` / `primaryPhones`
   * on the household are written by lead intake but **not** by the SmartSuite
   * migration, so every migrated household leaves them empty and this drawer
   * rendered "—" for a client whose details it had already fetched. The primary
   * contact is right there in `contacts`; falling back to it is real data, not a
   * placeholder. `HouseholdProfile` (the full page) has always done this — the
   * drawer is what was inconsistent.
   */
  const primaryContact = household?.contacts.find((c) => c.isPrimary);
  const contactName =
    household?.primaryContactName ?? fullName(primaryContact) ?? '—';
  const email =
    household?.primaryEmails[0] ?? primaryContact?.emails[0] ?? '—';
  const phone =
    household?.primaryPhones[0] ?? primaryContact?.phones[0] ?? '—';
  /* Mailing address as the last resort — the drawer already fetches it. */
  const address = household?.propertyAddress ?? household?.mailingAddress;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{household?.name ?? 'Household'}</SheetTitle>
          <SheetDescription>
            {household ? contactName : 'Household details'}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-4">
          {query.isPending && <DrawerSkeleton />}
          {query.isError && <DrawerError />}

          {household && (
            <>
              <div>
                <DrawerRow label="Status" value={household.status ?? '—'} />
                <DrawerRow label="Primary contact" value={contactName} />
                <DrawerRow label="Email" value={email} />
                <DrawerRow label="Phone" value={phone} />
                <DrawerRow label="Address" value={addressLine(address)} />
                <DrawerRow
                  label="Active policies"
                  value={household.totalActivePolicies}
                />
              </div>

              <DrawerSection title={`Members (${household.contacts.length})`}>
                {household.contacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No contacts on file.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {household.contacts.map((contact) => (
                      <li
                        key={contact.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span>
                          {[contact.firstName, contact.lastName]
                            .filter(Boolean)
                            .join(' ') || 'Unnamed'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {contact.roleInHousehold ?? '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </DrawerSection>

              <DrawerSection title={`Policies (${household.policies.length})`}>
                {household.policies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No policies on file.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {household.policies.map((policy) => (
                      <li key={policy.id} className="text-sm">
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => navigate(`/policies/${policy.id}`)}
                        >
                          {policy.policyType} — {policy.policyNumber}
                        </button>
                        <span className="block text-xs text-muted-foreground">
                          {policy.carrier ?? '—'} · {money(policy.premium)} ·
                          renews {shortDate(policy.renewalDate)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </DrawerSection>
            </>
          )}
        </div>

        <SheetFooter>
          <Button
            disabled={!household}
            onClick={() => household && navigate(`/clients/${household.id}`)}
          >
            Open full page
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
