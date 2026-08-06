import { useState } from "react";
import type { KeyboardEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/hooks/usePermissions";
import { useLogActivity } from "./useLogActivity";

interface ActivityComposerProps {
  leadId: string;
}

/**
 * "Log a note" on the Lead Detail timeline (PAC-16).
 *
 * The mockup has always had this control. It was removed in PAC-38 because the
 * version inherited from the Figma export wrote to local state — notes appeared
 * and then vanished on the next render — and there was no endpoint behind it.
 * `POST /activities` is that endpoint.
 *
 * Notes written here are the same `activities` rows the dashboard's Hot Leads
 * panel reads for its narrative line, so a producer's next-step note shows up
 * on their priority list.
 *
 * Gated on `leads:write`: a read-only viewer sees the timeline without the box.
 */
export function ActivityComposer({ leadId }: ActivityComposerProps) {
  const [text, setText] = useState("");
  const { canWrite } = usePermissions();
  const logActivity = useLogActivity(leadId);

  if (!canWrite("leads")) return null;

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && !logActivity.isPending;

  const submit = () => {
    if (!canSubmit) return;
    logActivity.mutate(
      { type: "note", summary: trimmed },
      // Cleared only on success, so a failed note is not lost — the producer
      // can retry without retyping it.
      { onSuccess: () => setText("") },
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter submits; a bare Enter stays a newline, because these are
    // multi-sentence next-step notes rather than chat messages.
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-border px-5 py-3">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Log a note — what happened, and what's next?"
        rows={2}
        maxLength={500}
        className="resize-none text-sm"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[10px] text-muted-foreground">
          {/* Surfaced only as the limit approaches; a counter on an empty box is
              noise. 500 matches the API's own cap. */}
          {trimmed.length > 400 ? `${trimmed.length} / 500` : "⌘↵ to save"}
        </span>
        <Button size="sm" onClick={submit} disabled={!canSubmit}>
          {logActivity.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          Add note
        </Button>
      </div>
    </div>
  );
}
