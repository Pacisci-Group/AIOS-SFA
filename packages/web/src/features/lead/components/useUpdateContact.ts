import type { UpdateContactInput } from "@sfa/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updateContact } from "@/lib/contacts-api";
import { leadDetailKey } from "./useUpdateLead";

/**
 * The "Edit Primary Contact" modal (PAC-38).
 *
 * Deliberately **not** optimistic, unlike {@link useUpdateLead}. This is a modal
 * with an explicit Save, so the producer is already waiting on a result — and
 * the write also mirrors the corrected name onto the lead server-side, which an
 * optimistic patch could not reproduce faithfully. Refetching once is simpler
 * and cannot disagree with the server.
 *
 * The Leads list is invalidated too: the mirror means a corrected surname
 * changes the row there as well.
 */
export function useUpdateContact(leadId: string, contactId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateContactInput) => {
      if (!contactId) {
        throw new Error("This lead has no primary contact to edit.");
      }
      return updateContact(contactId, input);
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadDetailKey(leadId) });
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Contact updated");
    },

    onError: (error: Error) => {
      toast.error(error.message || "Couldn't update the contact");
    },
  });
}
