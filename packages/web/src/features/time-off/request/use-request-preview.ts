import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  previewRecordedTimeOff,
  previewTimeOffRequest,
  timeOffKeys,
} from "@/lib/time-off-api";
import {
  previewable,
  toRecordInput,
  toRequestInput,
  type RequestFormMode,
  type RequestFormValues,
} from "./request-form";

const PREVIEW_DEBOUNCE_MS = 300;

/**
 * What the form's current values amount to (PAC-165): the hours per date,
 * the balance lines and what stops the request being sent — asked of the
 * server as the form is filled in, because only the server knows the
 * person's schedule and balance. The same evaluation sending runs, so the
 * form cannot promise what sending refuses.
 *
 * Debounced, and the previous answer stays on screen while the next one
 * loads, so typing hours does not make the breakdown flicker.
 */
export function useRequestPreview(
  values: RequestFormValues,
  mode: RequestFormMode,
  requestId?: string,
) {
  const ready = previewable(values, mode);
  const input = ready
    ? mode === "record"
      ? toRecordInput(values)
      : { ...toRequestInput(values), ...(requestId ? { requestId } : {}) }
    : null;
  // The note changes nothing the preview computes.
  const key = input ? JSON.stringify({ ...input, note: null }) : "";

  const [settled, setSettled] = useState(key);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(key), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [key]);

  const query = useQuery({
    queryKey: timeOffKeys.preview(mode, settled),
    queryFn: () => {
      const body = JSON.parse(settled) as never;
      return mode === "record" ? previewRecordedTimeOff(body) : previewTimeOffRequest(body);
    },
    enabled: settled !== "",
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
  });

  return {
    preview: ready ? query.data : undefined,
    /** A newer answer is on its way; what is shown may be about to change. */
    pending: ready && (settled !== key || query.isFetching),
    error: ready ? query.error : null,
  };
}
