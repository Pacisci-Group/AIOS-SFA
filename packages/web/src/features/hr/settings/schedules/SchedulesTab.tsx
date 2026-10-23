import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_WORKWEEK,
  scheduleFromWorkweek,
  type WorkSchedule,
  type WorkScheduleTemplateView,
} from "@sfa/shared";
import { FormError, FormSection } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  archiveScheduleTemplate,
  createScheduleTemplate,
  getAgencyCalendar,
  hrKeys,
  listScheduleTemplates,
  updateScheduleTemplate,
} from "@/lib/hr-api";
import { ScheduleEditor, formatWeeklyHours } from "../../components/ScheduleEditor";
import { hrErrorMessage } from "../hr-error";

interface SchedulesTabProps {
  canWrite: boolean;
}

type Editing = { kind: "new" } | { kind: "edit"; template: WorkScheduleTemplateView } | null;

/**
 * Work schedule templates (PAC-162) — `/settings/hr?tab=schedules`. An
 * empty list is a state, not an error: everyone is then on the agency
 * workweek at 09:00–17:00, and a template exists to name a different week.
 */
export function SchedulesTab({ canWrite }: SchedulesTabProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: hrKeys.scheduleTemplates,
    queryFn: listScheduleTemplates,
  });
  const calendar = useQuery({
    queryKey: hrKeys.calendar(new Date().getFullYear()),
    queryFn: () => getAgencyCalendar(new Date().getFullYear()),
  });

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: hrKeys.scheduleTemplates });

  const archive = useMutation({
    mutationFn: (id: string) => archiveScheduleTemplate(id),
    onSuccess: (template) => {
      refresh();
      toast.success(`"${template.name}" archived.`);
    },
    onError: (error) => toast.error(hrErrorMessage(error)),
  });

  if (list.isPending) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (list.isError) {
    return <p className="text-sm text-destructive">{hrErrorMessage(list.error)}</p>;
  }

  if (editing) {
    const workweek = calendar.data?.workweek ?? [...DEFAULT_WORKWEEK];
    return (
      <ScheduleTemplateEditor
        key={editing.kind === "edit" ? `${editing.template.id}:${editing.template.version}` : "new"}
        template={editing.kind === "edit" ? editing.template : null}
        initialSchedule={
          editing.kind === "edit" ? editing.template.schedule : scheduleFromWorkweek(workweek)
        }
        serverError={serverError}
        onSaved={(template) => {
          refresh();
          setEditing(null);
          setServerError(null);
          toast.success(`"${template.name}" saved.`);
        }}
        onError={(error) => setServerError(hrErrorMessage(error))}
        onCancel={() => {
          setEditing(null);
          setServerError(null);
        }}
      />
    );
  }

  const templates = list.data.templates;
  const active = templates.filter((t) => t.status === "active");
  const archived = templates.filter((t) => t.status === "archived");

  const row = (template: WorkScheduleTemplateView) => (
    <li
      key={template.id}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{template.name}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatWeeklyHours(template.weeklyMinutes)} per week · {template.employeeCount} employee
          {template.employeeCount === 1 ? "" : "s"}
        </p>
      </div>
      {template.status === "archived" ? (
        <Badge variant="outline">Archived</Badge>
      ) : (
        canWrite && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setServerError(null);
                setEditing({ kind: "edit", template });
              }}
            >
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={template.employeeCount > 0 || archive.isPending}
              title={
                template.employeeCount > 0
                  ? `Move ${template.employeeCount} employee${template.employeeCount === 1 ? "" : "s"} to another schedule first`
                  : undefined
              }
              onClick={() => archive.mutate(template.id)}
            >
              <Archive className="size-4" />
              Archive
            </Button>
          </>
        )
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      {active.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
          No schedule templates yet. Everyone is on the agency workweek, 9 to 5.
          Add a template to name a different week — four tens, a half-day Friday —
          and put people on it from their HR profile.
        </div>
      ) : (
        <ul className="space-y-2">{active.map(row)}</ul>
      )}

      {canWrite && (
        <Button
          type="button"
          variant="brand"
          onClick={() => {
            setServerError(null);
            setEditing({ kind: "new" });
          }}
        >
          <Plus className="size-4" />
          New schedule
        </Button>
      )}

      {archived.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Archived
          </h3>
          <ul className="space-y-2">{archived.map(row)}</ul>
        </section>
      )}
    </div>
  );
}

function ScheduleTemplateEditor({
  template,
  initialSchedule,
  serverError,
  onSaved,
  onError,
  onCancel,
}: {
  template: WorkScheduleTemplateView | null;
  initialSchedule: WorkSchedule;
  serverError: string | null;
  onSaved: (template: WorkScheduleTemplateView) => void;
  onError: (error: unknown) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [schedule, setSchedule] = useState<WorkSchedule>(initialSchedule);

  const save = useMutation({
    mutationFn: () =>
      template
        ? updateScheduleTemplate(template.id, { name: name.trim(), schedule })
        : createScheduleTemplate({ name: name.trim(), schedule }),
    onSuccess: onSaved,
    onError,
  });

  const valid = name.trim().length > 0 && Object.values(schedule).some(Boolean);

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <FormSection title={template ? "Edit schedule" : "New schedule"}>
        <div className="space-y-2">
          <Label htmlFor="hr-schedule-name">Name</Label>
          <Input
            id="hr-schedule-name"
            value={name}
            placeholder="Four tens"
            autoComplete="off"
            className="bg-card border-border"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </FormSection>
      <FormSection
        title="Week"
        description="Tick a day to give it a shift; untick it for a day off. Times are on the agency's clock."
      >
        <ScheduleEditor value={schedule} onChange={setSchedule} idPrefix="hr-tpl" />
      </FormSection>
      <FormError>{serverError}</FormError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={save.isPending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="brand" disabled={!valid || save.isPending}>
          {save.isPending ? "Saving…" : template ? "Save changes" : "Create schedule"}
        </Button>
      </div>
    </form>
  );
}
