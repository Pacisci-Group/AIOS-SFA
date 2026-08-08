import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface PolicySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Add policy" or "Edit policy" — the drawer serves both. */
  title: string;
  description: string;
  /** "Save policy" on add, "Save changes" on edit. */
  saveLabel: string;
  onSave: () => void;
  children: React.ReactNode;
}

/**
 * The right-side drawer both intake forms open to capture one policy
 * (PAC-56 #15).
 *
 * Chosen over inline rows because the policy grew an address: a property row
 * inline is a type, a count, a toggle and four address fields stacked in the
 * middle of the page, repeated per policy — unreadable on a phone, and the
 * reason the address used to be pulled out into a single shared section that
 * could not describe two buildings. The drawer gives one policy the whole
 * panel, and the form behind it stays a short list of what has been added.
 *
 * Presentational only. The draft form lives in `children`, owned by whichever
 * feature opened the drawer — that is what lets the Quote Recap add a premium
 * field the New Lead form has no schema for.
 */
export function PolicySheet({
  open,
  onOpenChange,
  title,
  description,
  saveLabel,
  onSave,
  children,
}: PolicySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // Wider than the `sm:max-w-sm` default: four address fields in a
        // two-column grid need the room, and this is a data-entry surface
        // rather than a nav panel.
        className="w-full gap-0 overflow-y-auto sm:max-w-lg"
        // The drawer's own fields are the only thing in it — pulling focus to
        // the first one skips the close button, which is the escape hatch.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle className="text-sm">{title}</SheetTitle>
          <SheetDescription className="text-xs">{description}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 p-4">{children}</div>

        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {/*
            `type="button"`, always. The drawer renders in a portal so it is not
            a DOM descendant of the page's `<form>`, but a bare button inside
            one would submit the whole intake form rather than commit a policy.
          */}
          <Button type="button" variant="brand" size="sm" onClick={onSave}>
            {saveLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
