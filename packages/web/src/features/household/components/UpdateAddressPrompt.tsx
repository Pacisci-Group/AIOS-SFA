import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * The question asked after every cancellation: does the address need updating?
 *
 * Asked every time rather than only for "Sold", on purpose. A client who
 * changed carrier may have moved too, and the cost of the prompt is one click
 * on "Not now" — whereas a stale address keeps renewal mail and the Clients
 * list's location pointing at a house the client has left.
 *
 * Owned by the page, not by the Cancel dialog — see `CancelPolicyDialog`'s
 * `onCancelled` for why. "Update address" hands over to the page's
 * `AddAddressDialog`, which defaults to making the new address primary.
 */
export function UpdateAddressPrompt({
  open,
  onOpenChange,
  onUpdateAddress,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateAddress: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Update the client&apos;s address?</AlertDialogTitle>
          <AlertDialogDescription>
            If the client sold their home or moved, add their new address now
            so mail and renewals reach them. The current address stays on the
            household as a previous address.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction onClick={onUpdateAddress}>
            Update address
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
