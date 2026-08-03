import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Users } from "lucide-react";
import { getPolicy } from "@/lib/policies-api";
import { PolicyCard } from "@/features/household/components/PolicyPortfolio";
import { toDisplayPolicy } from "@/features/household/components/policy-display";

/**
 * Read-only policy detail at `/policies/:id`. Reuses the household page's
 * `PolicyCard` styling so a policy looks the same wherever it is shown.
 */
export default function PolicyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(true);

  const query = useQuery({
    queryKey: ["policy", id],
    queryFn: () => getPolicy(id as string),
    enabled: !!id,
  });

  const policy = query.data;

  return (
    <div
      className="flex flex-col h-full overflow-y-auto"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      <div
        className="px-6 py-4 border-b shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs mb-2 hover:underline"
          style={{ color: "var(--muted-foreground)" }}
        >
          <ArrowLeft size={12} /> Back
        </button>
        <h1 className="text-lg font-semibold">
          {policy ? `${policy.policyType} Policy` : "Policy"}
        </h1>
        <p
          className="text-xs font-mono"
          style={{
            color: "var(--muted-foreground)",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {policy?.policyNumber ?? "—"}
        </p>
      </div>

      <div className="p-6 max-w-2xl flex flex-col gap-4">
        {query.isPending && (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Loading policy…
          </p>
        )}

        {query.isError && (
          <div>
            <p className="text-sm text-red-400">Policy not found.</p>
            <p
              className="text-xs mt-1"
              style={{ color: "var(--muted-foreground)" }}
            >
              It may have been removed, or it is outside your branch.
            </p>
          </div>
        )}

        {policy && (
          <>
            <PolicyCard
              policy={toDisplayPolicy(policy)}
              isSelected={expanded}
              onClick={() => setExpanded((v) => !v)}
            />

            {policy.household && (
              <button
                type="button"
                onClick={() => navigate(`/clients/${policy.household!.id}`)}
                className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm transition-colors hover:bg-white/5 text-left"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                }}
              >
                <Users size={14} style={{ color: "#3b82f6" }} />
                <span>
                  <span className="block">{policy.household.name ?? "Household"}</span>
                  <span
                    className="block text-xs"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {policy.household.totalActivePolicies} active policies · view
                    household
                  </span>
                </span>
              </button>
            )}

            {policy.notes && (
              <div
                className="rounded-xl p-4"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                }}
              >
                <p
                  className="text-xs uppercase tracking-widest mb-2"
                  style={{
                    color: "var(--muted-foreground)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  Notes
                </p>
                <p className="text-sm">{policy.notes}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
