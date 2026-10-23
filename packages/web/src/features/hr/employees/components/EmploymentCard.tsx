import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Pencil, UserRoundX } from "lucide-react";
import { toast } from "sonner";
import type { EmployeeProfileView } from "@sfa/shared";
import { DataRow, DetailCard } from "@/components/common/DetailCard";
import { FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";
import { agencyTodayYmd } from "@/lib/dates";
import { terminateEmployee, updateEmployeeFacts } from "@/lib/hr-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { hrErrorMessage } from "../../settings/hr-error";
import { formatDay, formatMonthDay } from "../employee-display";

interface EmploymentCardProps {
  profile: EmployeeProfileView;
  onChanged: (next: EmployeeProfileView) => void;
}

/**
 * The employment facts (PAC-162): hire date, anniversary, termination, and
 * the birthday an admin may read and correct. Never a rule — those are the
 * rules panel's, with their own history.
 */
export function EmploymentCard({ profile, onChanged }: EmploymentCardProps) {
  const [editing, setEditing] = useState(false);
  const [terminating, setTerminating] = useState(false);

  return (
    <DetailCard
      title="Employment"
      icon={Briefcase}
      action={
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            Edit
          </Button>
          {profile.status === "active" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setTerminating(true)}
            >
              <UserRoundX className="size-4" />
              Terminate
            </Button>
          )}
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <DataRow label="Hire date" value={formatDay(profile.hireDate)} />
        <DataRow label="Work anniversary" value={formatMonthDay(profile.workAnniversary)} />
        <DataRow
          label="Termination date"
          value={profile.terminationDate ? formatDay(profile.terminationDate) : NOT_AVAILABLE}
        />
        <DataRow
          label="Date of birth"
          value={
            profile.dateOfBirth
              ? `${formatDay(profile.dateOfBirth)} · ${profile.showBirthday ? "on the calendar" : "kept private"}`
              : NOT_AVAILABLE
          }
        />
      </div>

      <FactsDialog
        open={editing}
        profile={profile}
        onClose={() => setEditing(false)}
        onSaved={(next) => {
          setEditing(false);
          onChanged(next);
        }}
      />
      <TerminateDialog
        open={terminating}
        profile={profile}
        onClose={() => setTerminating(false)}
        onSaved={(next) => {
          setTerminating(false);
          onChanged(next);
        }}
      />
    </DetailCard>
  );
}

function FactsDialog({
  open,
  profile,
  onClose,
  onSaved,
}: {
  open: boolean;
  profile: EmployeeProfileView;
  onClose: () => void;
  onSaved: (next: EmployeeProfileView) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const today = agencyTodayYmd(user?.timeZone);
  const [hireDate, setHireDate] = useState(profile.hireDate ?? "");
  const [anniversary, setAnniversary] = useState(profile.workAnniversary ?? "");
  const [dob, setDob] = useState(profile.dateOfBirth ?? "");
  const [showBirthday, setShowBirthday] = useState(profile.showBirthday);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      updateEmployeeFacts(profile.userId, {
        ...(hireDate && hireDate !== profile.hireDate ? { hireDate } : {}),
        ...(anniversary !== (profile.workAnniversary ?? "")
          ? { workAnniversary: anniversary || null }
          : {}),
        ...(dob !== (profile.dateOfBirth ?? "") ? { dateOfBirth: dob || null } : {}),
        ...(showBirthday !== profile.showBirthday ? { showBirthday } : {}),
      }),
    onSuccess: (next) => {
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
      toast.success("Details saved.");
      onSaved(next);
    },
    onError: (err) => setError(hrErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Employment details</DialogTitle>
          <DialogDescription>
            Facts about the person, not rules. Every change is logged with what it was before.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {profile.status !== "pending" && (
            <div className="space-y-2">
              <Label htmlFor="hr-facts-hire">Hire date</Label>
              <Input
                id="hr-facts-hire"
                type="date"
                max={today}
                value={hireDate}
                className="bg-card border-border"
                onChange={(e) => setHireDate(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="hr-facts-anniv">Work anniversary (MM-DD)</Label>
            <Input
              id="hr-facts-anniv"
              value={anniversary}
              placeholder="03-15"
              className="bg-card border-border"
              onChange={(e) => setAnniversary(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hr-facts-dob">Date of birth</Label>
            <Input
              id="hr-facts-dob"
              type="date"
              max={today}
              value={dob}
              className="bg-card border-border"
              onChange={(e) => setDob(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="hr-facts-show"
              checked={showBirthday}
              onCheckedChange={(checked) => setShowBirthday(checked === true)}
            />
            <Label htmlFor="hr-facts-show" className="font-normal">
              Show the birthday on the agency calendar (month and day only)
            </Label>
          </div>
          <FormError>{error}</FormError>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="brand" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TerminateDialog({
  open,
  profile,
  onClose,
  onSaved,
}: {
  open: boolean;
  profile: EmployeeProfileView;
  onClose: () => void;
  onSaved: (next: EmployeeProfileView) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(agencyTodayYmd(user?.timeZone));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const terminate = useMutation({
    mutationFn: () =>
      terminateEmployee(profile.userId, { terminationDate: date, reason: reason.trim() }),
    onSuccess: (next) => {
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
      toast.success("Terminated.");
      onSaved(next);
    },
    onError: (err) => setError(hrErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Terminate</DialogTitle>
          <DialogDescription>
            The last day may be in the future. Nothing is deleted: the history stays, and
            no time off can be dated after this day. Removing their account is a separate step
            under Agency Users.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hr-term-date">Last day</Label>
            <Input
              id="hr-term-date"
              type="date"
              min={profile.hireDate ?? undefined}
              value={date}
              className="bg-card border-border"
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="hr-term-reason">Reason</Label>
            <Input
              id="hr-term-reason"
              value={reason}
              placeholder="Resigned"
              className="bg-card border-border"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <FormError>{error}</FormError>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={terminate.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={terminate.isPending || !date || !reason.trim()}
            onClick={() => terminate.mutate()}
          >
            {terminate.isPending ? "Saving…" : "Terminate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
