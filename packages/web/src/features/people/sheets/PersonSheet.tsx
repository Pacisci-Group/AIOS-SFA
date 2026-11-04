import type { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * The right-hand drawer every write on a person's profile opens in
 * (PAC-162) — the `TimeOffPolicyPage` section-drawer idiom: eyebrow, title,
 * a scrolling body, and a footer the caller renders at the bottom of its
 * own `<form>`.
 */
export function PersonSheet({
  eyebrow,
  title,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-2xl"
      >
        <SheetHeader className="gap-1 border-b border-border px-6 py-5">
          <SheetDescription className="text-xs uppercase tracking-widest text-muted-foreground">
            {eyebrow}
          </SheetDescription>
          <SheetTitle className="font-semibold text-foreground">{title}</SheetTitle>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}
