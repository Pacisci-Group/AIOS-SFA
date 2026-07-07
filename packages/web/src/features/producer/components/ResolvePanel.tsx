import { X, Upload, Phone, MessageSquare, CheckCircle2, FileText, AlertTriangle } from "lucide-react";
import { useState } from "react";

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

export function ResolvePanel({ deal, onClose, onResolved }: ResolvePanelProps) {
  const [uploaded, setUploaded] = useState(false);
  const [dragging, setDragging] = useState(false);

  if (!deal) return null;

  const handleResolve = () => {
    setUploaded(true);
    setTimeout(() => {
      onResolved(deal.id);
      onClose();
      setUploaded(false);
    }, 1200);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 transition-opacity"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-50 flex flex-col"
        style={{
          width: "420px",
          background: "#0D1628",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "-20px 0 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div>
            <p className="text-xs uppercase tracking-widest text-[#F59E0B] mb-1">Resolve Audit</p>
            <h3 className="text-[#E2E8F0]" style={{ fontWeight: 600 }}>
              {deal.client}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-[#64748B] hover:text-[#94A3B8] hover:bg-white/5 transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
          {/* Alert */}
          <div
            className="flex gap-3 p-4 rounded-xl"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}
          >
            <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: "#F59E0B" }} />
            <div>
              <p className="text-sm text-[#E2E8F0]" style={{ fontWeight: 500 }}>
                Missing: {deal.missing}
              </p>
              <p className="text-xs text-[#F59E0B] mt-0.5">
                Open for {deal.days} day{deal.days !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {/* Upload zone */}
          <div>
            <p className="text-xs uppercase tracking-wider text-[#64748B] mb-3">Upload Document</p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); handleResolve(); }}
              className="rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all"
              style={{
                border: `2px dashed ${dragging ? "#38BDF8" : "rgba(255,255,255,0.1)"}`,
                background: dragging ? "rgba(56,189,248,0.05)" : "rgba(255,255,255,0.02)",
              }}
            >
              {uploaded ? (
                <CheckCircle2 size={32} style={{ color: "#10B981" }} />
              ) : (
                <Upload size={32} style={{ color: "#64748B" }} />
              )}
              <div className="text-center">
                <p className="text-sm text-[#94A3B8]">
                  {uploaded ? "Document uploaded!" : "Drop file here or"}
                </p>
                {!uploaded && (
                  <button
                    onClick={handleResolve}
                    className="text-sm mt-1 transition-colors"
                    style={{ color: "#38BDF8", fontWeight: 500 }}
                  >
                    browse to upload
                  </button>
                )}
              </div>
              <p className="text-xs text-[#4B5563]">PDF, JPG, PNG up to 10MB</p>
            </div>
          </div>

          {/* Quick contact */}
          <div>
            <p className="text-xs uppercase tracking-wider text-[#64748B] mb-3">Quick Contact</p>
            <div className="flex gap-2">
              <button
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm transition-all hover:brightness-110"
                style={{ background: "rgba(16,185,129,0.12)", color: "#10B981", border: "1px solid rgba(16,185,129,0.2)", fontWeight: 500 }}
              >
                <Phone size={14} />
                Call
              </button>
              <button
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm transition-all hover:brightness-110"
                style={{ background: "rgba(56,189,248,0.12)", color: "#38BDF8", border: "1px solid rgba(56,189,248,0.2)", fontWeight: 500 }}
              >
                <MessageSquare size={14} />
                Text
              </button>
              <button
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm transition-all hover:brightness-110"
                style={{ background: "rgba(99,102,241,0.12)", color: "#818CF8", border: "1px solid rgba(99,102,241,0.2)", fontWeight: 500 }}
              >
                <FileText size={14} />
                Email
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs uppercase tracking-wider text-[#64748B] mb-2">Notes</p>
            <textarea
              placeholder="Add a note about this resolution..."
              rows={4}
              className="w-full rounded-lg px-3 py-2.5 text-sm text-[#E2E8F0] placeholder:text-[#4B5563] outline-none resize-none transition-all focus:ring-1"
              style={{
                background: "#111827",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "0.5rem",
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 flex gap-3"
          style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
        >
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg text-sm text-[#64748B] hover:text-[#94A3B8] hover:bg-white/5 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleResolve}
            className="flex-1 py-2.5 rounded-lg text-sm transition-all hover:brightness-110 active:scale-95"
            style={{
              background: "linear-gradient(135deg, #10B981, #059669)",
              color: "#0B0F19",
              fontWeight: 600,
              boxShadow: "0 0 16px rgba(16,185,129,0.25)",
            }}
          >
            Mark Resolved
          </button>
        </div>
      </div>
    </>
  );
}
