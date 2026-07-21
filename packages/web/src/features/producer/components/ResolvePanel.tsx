import {
  Upload,
  Phone,
  MessageSquare,
  CheckCircle2,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Deal {
  id: number;
  client: string;
  type: "Auto" | "Home" | "Bundle";
  missing: string;
  days: number;
}

interface ResolvePanelProps {
  deal: Deal | null;
  onClose: () => void;
  onResolved: (id: number) => void;
}

const quickContact =
  "flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium border transition-all hover:brightness-110";

export function ResolvePanel({ deal, onClose, onResolved }: ResolvePanelProps) {
  const [uploaded, setUploaded] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleResolve = () => {
    if (!deal) return;
    setUploaded(true);
    setTimeout(() => {
      onResolved(deal.id);
      onClose();
      setUploaded(false);
    }, 1200);
  };

  return (
    <Sheet open={!!deal} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-[420px] sm:max-w-[420px] p-0 gap-0 flex flex-col bg-[#0D1628] border-l border-white/[0.08]"
      >
        {deal && (
          <>
            {/* Header */}
            <SheetHeader className="px-6 py-5 border-b border-border gap-1">
              <SheetDescription className="text-xs uppercase tracking-widest text-amber-500">
                Resolve Audit
              </SheetDescription>
              <SheetTitle className="text-foreground font-semibold">
                {deal.client}
              </SheetTitle>
            </SheetHeader>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
              {/* Alert */}
              <div className="flex gap-3 p-4 rounded-xl bg-amber-500/8 border border-amber-500/20">
                <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
                <div>
                  <p className="text-sm text-foreground font-medium">
                    Missing: {deal.missing}
                  </p>
                  <p className="text-xs text-amber-500 mt-0.5">
                    Open for {deal.days} day{deal.days !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              {/* Upload zone */}
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  Upload Document
                </p>
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    handleResolve();
                  }}
                  className={cn(
                    "rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all border-2 border-dashed",
                    dragging
                      ? "border-sky-400 bg-sky-400/5"
                      : "border-white/10 bg-white/[0.02]",
                  )}
                >
                  {uploaded ? (
                    <CheckCircle2 size={32} className="text-emerald-500" />
                  ) : (
                    <Upload size={32} className="text-muted-foreground" />
                  )}
                  <div className="text-center">
                    <p className="text-sm text-slate-400">
                      {uploaded ? "Document uploaded!" : "Drop file here or"}
                    </p>
                    {!uploaded && (
                      <button
                        onClick={handleResolve}
                        className="text-sm mt-1 transition-colors text-sky-400 font-medium"
                      >
                        browse to upload
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-600">PDF, JPG, PNG up to 10MB</p>
                </div>
              </div>

              {/* Quick contact */}
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  Quick Contact
                </p>
                <div className="flex gap-2">
                  <button className={cn(quickContact, "bg-emerald-500/12 text-emerald-500 border-emerald-500/20")}>
                    <Phone size={14} />
                    Call
                  </button>
                  <button className={cn(quickContact, "bg-sky-400/12 text-sky-400 border-sky-400/20")}>
                    <MessageSquare size={14} />
                    Text
                  </button>
                  <button className={cn(quickContact, "bg-indigo-400/12 text-indigo-400 border-indigo-400/20")}>
                    <FileText size={14} />
                    Email
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Notes
                </p>
                <Textarea
                  placeholder="Add a note about this resolution..."
                  rows={4}
                  className="bg-gray-900 border-border resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 flex gap-3 border-t border-border">
              <Button
                variant="ghost"
                onClick={onClose}
                className="flex-1 text-muted-foreground hover:text-slate-300 hover:bg-white/5"
              >
                Cancel
              </Button>
              <Button
                onClick={handleResolve}
                className="flex-1 bg-gradient-to-br from-emerald-500 to-emerald-600 text-primary-foreground font-semibold hover:brightness-110 active:scale-95 shadow-[0_0_16px_rgba(16,185,129,0.25)]"
              >
                Mark Resolved
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
