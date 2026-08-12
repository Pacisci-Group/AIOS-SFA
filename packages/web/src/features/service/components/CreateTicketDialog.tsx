import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import {
  SERVICE_TICKET_CREATE_CATEGORIES,
  SERVICE_TICKET_CREATE_STATUSES,
  SERVICE_TICKET_STATUS_LABELS,
  type ServiceTicketCategory,
  type ServiceTicketStatus,
} from "@sfa/shared";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";
import { searchHouseholds } from "@/lib/households-api";
import { searchPolicies } from "@/lib/policies-api";
import {
  createServiceTicket,
  listServiceTicketAssignees,
} from "@/lib/service-tickets-api";

/**
 * What the opening page already knows about the ticket. Opened from the Service
 * Dashboard there is nothing to fill in; opened from a client's page the
 * household — and often the policy and CRM — are already on screen, and making
 * the user search for them again is busywork.
 *
 * The labels travel with the ids because the pickers are backed by *search*
 * endpoints: an id alone would select a record the combobox has no row for, and
 * render as the empty placeholder.
 */
export interface CreateTicketPrefill {
  householdId?: string | null;
  householdLabel?: string;
  policyId?: string | null;
  policyLabel?: string;
  assignedUserId?: string | null;
}

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new ticket's id once it is created. */
  onCreated?: (ticketId: string) => void;
  /** Seeded into the form every time the dialog opens. */
  prefill?: CreateTicketPrefill;
  /**
   * Restrict the Policy picker to the selected household's policies.
   *
   * Set by the household page, where the ticket is being filed *for that
   * client* and the whole agency's book is noise the user has to filter out —
   * and, worse, an opportunity to link a policy belonging to someone else.
   * Left off elsewhere (e.g. the Service Dashboard), where the user is
   * legitimately picking any policy.
   *
   * It follows the household *currently selected in the form*, not the
   * prefill, so changing the household re-scopes the list rather than leaving
   * a stale one behind.
   */
  restrictPolicyToHousehold?: boolean;
}

interface Option {
  value: string;
  label: string;
  hint?: string;
}

/** Wait for the user to stop typing before hitting the search endpoints. */
function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Combobox over a remote list. `onSearch` receives the typed term so the caller
 * can refetch; filtering therefore happens server-side, not in `Command`.
 */
function SearchableSelect({
  options,
  value,
  onChange,
  onSearch,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  loading,
  disabled,
  id,
}: {
  options: Option[];
  value: string | null;
  onChange: (value: string | null) => void;
  onSearch: (term: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  loading?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    // `modal` matters here: the popover is portaled outside the dialog, so
    // without its own modal layer the dialog's focus trap steals focus back
    // from the search input.
    <Popover open={open} onOpenChange={setOpen} modal>
      {/*
        Deliberately NOT `asChild` + <Button>. These shadcn components are the
        React-19 build (no forwardRef) while the app runs React 18, so slotting
        one in swallows Radix's ref — the popover then has no anchor and renders
        off-screen. Styling the primitive directly keeps the ref intact.
      */}
      <PopoverTrigger
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:border-input dark:bg-input/30 dark:hover:bg-input/50"
      >
        <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            onValueChange={onSearch}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Searching…
              </div>
            ) : (
              <CommandEmpty>{emptyLabel}</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    // Selecting the current value clears it.
                    onChange(option.value === value ? null : option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={`mr-2 h-3.5 w-3.5 ${
                      option.value === value ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.hint && (
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Put a prefilled record at the head of a search result list.
 *
 * The pickers render only what the search returned, so a prefilled household
 * that happens not to match the empty-term search would select an option that
 * does not exist and display as unselected. A no-op when the search already
 * found it, or when there is nothing prefilled.
 */
function pinOption(
  options: Option[],
  value?: string | null,
  label?: string,
): Option[] {
  if (!value || options.some((o) => o.value === value)) return options;
  return [{ value, label: label ?? value }, ...options];
}

const DEFAULT_STATUS: ServiceTicketStatus = "open";

/**
 * "New Service Ticket" popup. Policy / household / CRM are searchable pickers;
 * Created By is fixed to the signed-in user and shown read-only.
 */
export function CreateTicketDialog({
  open,
  onOpenChange,
  onCreated,
  prefill,
  restrictPolicyToHousehold = false,
}: CreateTicketDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [policyId, setPolicyId] = useState<string | null>(null);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [category, setCategory] = useState<ServiceTicketCategory | "">("");
  const [assignedUserId, setAssignedUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<ServiceTicketStatus>(DEFAULT_STATUS);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [policyTerm, setPolicyTerm] = useState("");
  const [householdTerm, setHouseholdTerm] = useState("");
  const [crmTerm, setCrmTerm] = useState("");
  const policyQ = useDebounced(policyTerm);
  const householdQ = useDebounced(householdTerm);

  // `null` outside restricted mode, so the query key and the request are
  // byte-identical to what every other caller has always sent.
  const policyHouseholdId = restrictPolicyToHousehold ? householdId : null;

  const policiesQuery = useQuery({
    queryKey: ["policies", "search", policyQ, policyHouseholdId],
    queryFn: () => searchPolicies(policyQ, 20, policyHouseholdId),
    // With no household chosen there is nothing to scope to; searching the
    // whole book is exactly what this mode exists to avoid.
    enabled: open && (!restrictPolicyToHousehold || !!householdId),
  });
  const householdsQuery = useQuery({
    queryKey: ["households", "search", householdQ],
    queryFn: () => searchHouseholds(householdQ),
    enabled: open,
  });
  const assigneesQuery = useQuery({
    queryKey: ["service-tickets", "assignees"],
    queryFn: listServiceTicketAssignees,
    enabled: open,
  });

  // The prefilled policy belongs to the prefilled household. Once the user has
  // switched to another household in restricted mode, pinning it would put a
  // foreign client's policy back into a list built to exclude exactly that.
  const canPinPolicy =
    !restrictPolicyToHousehold || householdId === prefill?.householdId;

  const policyOptions: Option[] = useMemo(
    () =>
      pinOption(
        (policiesQuery.data ?? []).map((p) => ({
          value: p.id,
          label: [p.policyNumber ?? "No number", p.policyType]
            .filter(Boolean)
            .join(" · "),
          hint: p.householdName ?? p.carrier ?? undefined,
        })),
        canPinPolicy ? prefill?.policyId : null,
        prefill?.policyLabel,
      ),
    [policiesQuery.data, canPinPolicy, prefill?.policyId, prefill?.policyLabel],
  );

  const householdOptions: Option[] = useMemo(
    () =>
      pinOption(
        (householdsQuery.data ?? []).map((h) => ({
          value: h.id,
          label: h.name ?? h.primaryContactName ?? "Unnamed household",
          hint: h.totalActivePolicies
            ? `${h.totalActivePolicies} active`
            : undefined,
        })),
        prefill?.householdId,
        prefill?.householdLabel,
      ),
    [householdsQuery.data, prefill?.householdId, prefill?.householdLabel],
  );

  // The CRM list is small, so it is fetched once and filtered in the browser.
  const assigneeOptions: Option[] = useMemo(() => {
    const term = crmTerm.trim().toLowerCase();
    return (assigneesQuery.data ?? [])
      .filter(
        (a) =>
          !term ||
          a.name.toLowerCase().includes(term) ||
          a.email.toLowerCase().includes(term),
      )
      .map((a) => ({ value: a.id, label: a.name, hint: a.email }));
  }, [assigneesQuery.data, crmTerm]);

  // Seed the linked records each time the dialog opens. Keyed on `open` rather
  // than done once, so reopening after a create starts from the prefill again
  // instead of the cleared form.
  useEffect(() => {
    if (!open) return;
    setHouseholdId(prefill?.householdId ?? null);
    setPolicyId(prefill?.policyId ?? null);
  }, [open, prefill?.householdId, prefill?.policyId]);

  // The CRM is seeded separately, and only once the assignee list can name it:
  // the picker renders from that list, so an id it does not contain would show
  // as the empty placeholder while still being submitted — assigning the ticket
  // to someone the user never saw.
  useEffect(() => {
    if (!open || !prefill?.assignedUserId) return;
    const known = (assigneesQuery.data ?? []).some(
      (a) => a.id === prefill.assignedUserId,
    );
    if (known) {
      setAssignedUserId(prefill.assignedUserId ?? null);
    }
  }, [open, prefill?.assignedUserId, assigneesQuery.data]);

  const resetForm = () => {
    setPolicyId(null);
    setHouseholdId(null);
    setCategory("");
    setAssignedUserId(null);
    setStatus(DEFAULT_STATUS);
    setNotes("");
    setError(null);
    setPolicyTerm("");
    setHouseholdTerm("");
    setCrmTerm("");
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createServiceTicket({
        category: category as ServiceTicketCategory,
        status,
        policyId: policyId ?? undefined,
        householdId: householdId ?? undefined,
        assignedUserId: assignedUserId ?? undefined,
        openingNote: notes.trim() || undefined,
      }),
    onSuccess: (ticket) => {
      queryClient.invalidateQueries({ queryKey: ["service-tickets"] });
      resetForm();
      onOpenChange(false);
      onCreated?.(ticket.id);
    },
    onError: (err: unknown) =>
      setError(
        err instanceof Error ? err.message : "Could not create the ticket.",
      ),
  });

  const handleSubmit = () => {
    setError(null);
    if (!category) {
      setError("Pick a category.");
      return;
    }
    if (!policyId && !householdId) {
      setError("Link a policy or a household so the ticket has a client.");
      return;
    }
    createMutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          resetForm();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Service Ticket</DialogTitle>
          <DialogDescription>
            Link the client records, pick a category, and assign it to a Client
            Relation Manager.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ticket-policy">Policy</Label>
            <SearchableSelect
              id="ticket-policy"
              options={policyOptions}
              value={policyId}
              onChange={setPolicyId}
              onSearch={setPolicyTerm}
              placeholder={
                restrictPolicyToHousehold && !householdId
                  ? "Pick a household first…"
                  : "Search a policy…"
              }
              searchPlaceholder="Policy number, type, or carrier"
              emptyLabel={
                restrictPolicyToHousehold
                  ? "This household has no matching policies."
                  : "No policies match."
              }
              loading={policiesQuery.isFetching}
              disabled={restrictPolicyToHousehold && !householdId}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ticket-household">Household</Label>
            <SearchableSelect
              id="ticket-household"
              options={householdOptions}
              value={householdId}
              onChange={(next) => {
                setHouseholdId(next);
                // In restricted mode the policy list is the household's, so a
                // policy chosen for the previous one would be submitted while
                // no longer visible in the picker.
                if (restrictPolicyToHousehold) {
                  setPolicyId(null);
                }
              }}
              onSearch={setHouseholdTerm}
              placeholder="Search a household…"
              searchPlaceholder="Household or contact name"
              emptyLabel="No households match."
              loading={householdsQuery.isFetching}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ticket-category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as ServiceTicketCategory)}
            >
              <SelectTrigger id="ticket-category">
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_TICKET_CREATE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ticket-crm">Assigned Client Relation Manager</Label>
            <SearchableSelect
              id="ticket-crm"
              options={assigneeOptions}
              value={assignedUserId}
              onChange={setAssignedUserId}
              onSearch={setCrmTerm}
              placeholder="Search a CRM…"
              searchPlaceholder="Name or email"
              emptyLabel="No CRMs found."
              loading={assigneesQuery.isLoading}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ticket-status">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as ServiceTicketStatus)}
            >
              <SelectTrigger id="ticket-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_TICKET_CREATE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SERVICE_TICKET_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Created By</Label>
            <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
              {user?.name || user?.email || "You"}
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ticket-notes">Notes</Label>
            <Textarea
              id="ticket-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What does this ticket need?"
              rows={4}
            />
          </div>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending && (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            )}
            Create Ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
