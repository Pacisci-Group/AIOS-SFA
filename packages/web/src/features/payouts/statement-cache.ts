import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PayStatementView } from "@sfa/shared";
import {
  payoutRunsKey,
  payStatementKey,
  payStatementListsKey,
} from "@/lib/payouts-api";

/**
 * Put the statement an action returned where its page reads it, and refresh
 * the lists and runs that count it. Not the statement's PDF link or preview:
 * they belong to the version on screen, and a new version or a signed copy
 * gets a key of its own (see `payStatementListsKey`).
 */
export function useApplyStatement(): (
  updated: PayStatementView,
) => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(
    async (updated: PayStatementView) => {
      queryClient.setQueryData(payStatementKey(updated.id), updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: payStatementListsKey }),
        queryClient.invalidateQueries({ queryKey: payoutRunsKey }),
      ]);
    },
    [queryClient],
  );
}
