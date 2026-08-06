import { Mail, MessageSquare, Phone } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LoggableActivityType } from "@/lib/activities-api";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePermissions } from "@/hooks/usePermissions";
import { useLogActivity } from "@/features/lead/components/useLogActivity";
import { cn } from "@/lib/utils";

interface LeadQuickActionsProps {
  leadId: string;
  phone: string | null;
  email: string | null;
}

interface Action {
  type: Extract<LoggableActivityType, "call" | "text" | "email">;
  label: string;
  icon: LucideIcon;
  /** Tailwind classes; the palette matches the mockup's accents. */
  tone: string;
  href: (contact: string) => string;
  missing: string;
}

const ACTIONS: readonly Action[] = [
  {
    type: "call",
    label: "Call",
    icon: Phone,
    tone: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    href: (phone) => `tel:${phone.replace(/[^\d+]/g, "")}`,
    missing: "No phone number on this lead",
  },
  {
    type: "text",
    label: "Text",
    icon: MessageSquare,
    tone: "bg-sky-400/10 text-sky-400 border-sky-400/20",
    href: (phone) => `sms:${phone.replace(/[^\d+]/g, "")}`,
    missing: "No phone number on this lead",
  },
  {
    type: "email",
    label: "Email",
    icon: Mail,
    tone: "bg-indigo-400/10 text-indigo-400 border-indigo-400/20",
    href: (email) => `mailto:${email}`,
    missing: "No email address on this lead",
  },
];

const BASE =
  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all hover:brightness-110 active:scale-95";

/**
 * Call / Text / Email on a lead row (PAC-16).
 *
 * **These log the touch; they do not perform it.** The `tel:`/`sms:`/`mailto:`
 * href hands off to the device, and the API call records that the producer made
 * contact. "Quick actions + activity log" reads like an integration; it isn't.
 *
 * Anchors rather than buttons with an `onClick`: on a desktop with no handset
 * registered, a JS handler would silently do nothing, whereas an unhandled
 * `tel:` is at least visibly inert and can be copied. The click both follows
 * the href and fires the log.
 *
 * Renders nothing without `leads:write` — the caller does not need its own gate.
 */
export function LeadQuickActions({
  leadId,
  phone,
  email,
}: LeadQuickActionsProps) {
  const { canWrite } = usePermissions();
  const logActivity = useLogActivity(leadId);

  if (!canWrite("leads")) return null;

  return (
    <div className="flex items-center gap-2">
      {ACTIONS.map((action) => {
        const contact = action.type === "email" ? email : phone;
        const Icon = action.icon;

        if (!contact) {
          return (
            <Tooltip key={action.type}>
              <TooltipTrigger asChild>
                {/* A span, not a disabled anchor: an <a> without href is not
                    focusable, so the tooltip would be unreachable by keyboard. */}
                <span
                  className={cn(
                    BASE,
                    "cursor-not-allowed border-border bg-muted text-muted-foreground opacity-60",
                  )}
                >
                  <Icon size={11} />
                  {action.label}
                </span>
              </TooltipTrigger>
              <TooltipContent>{action.missing}</TooltipContent>
            </Tooltip>
          );
        }

        return (
          <a
            key={action.type}
            href={action.href(contact)}
            className={cn(BASE, action.tone)}
            onClick={() => logActivity.mutate({ type: action.type })}
          >
            <Icon size={11} />
            {action.label}
          </a>
        );
      })}
    </div>
  );
}
