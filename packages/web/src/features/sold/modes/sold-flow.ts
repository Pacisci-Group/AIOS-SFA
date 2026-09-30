import type {
  CarrierOption,
  SoldDealLeadContext,
  SoldStaffOption,
} from "@sfa/shared";
import { useQuery } from "@tanstack/react-query";
import { carriersKey, getCarriers } from "@/lib/carriers-api";
import type { UploadScope } from "@/lib/sold-deals-api";
import type {
  SoldDealFormValues,
  WizardVariant,
} from "../components/sold-deal-schema";

/** `24` hex characters — anything else cannot be a Mongo id. */
export const OBJECT_ID = /^[a-f0-9]{24}$/i;

/**
 * A load that failed and can be retried — the carrier catalog, or whichever
 * record anchors the flow.
 *
 * Separate from {@link FlowBlock} because the two are different news: this one
 * says "try again", that one says "you cannot do this at all".
 */
export interface FlowError {
  title: string;
  detail: string;
  retry?: () => void;
}

/** A reason the wizard will not mount, with the way out. */
export interface FlowBlock {
  title: string;
  detail: string;
}

/** Everything the wizard needs, present only once every guard has passed. */
export interface FlowReady {
  context: SoldDealLeadContext;
  carriers: CarrierOption[];
  staff: SoldStaffOption[];
  /**
   * Where in-progress documents upload to. Each mode names its own anchor — the
   * wizard used to infer it and got the rewrite wrong, so it is data now.
   */
  uploadScope: UploadScope;
  /** Shown above the wizard — the rewrite's "nothing is cancelled yet" note. */
  notice?: string;
}

/**
 * One of the three ways a policy gets written, reduced to what the page renders.
 *
 * A sale and a replacement (a Cancel Rewrite or Company Transfer on a lead
 * created for it) ask for the same information through the same wizard, block
 * for the same *kinds* of reason, and fail the same way. That shared shape is
 * this interface, and `SoldDealPage` is the single page that renders it.
 *
 * Before PAC-126 the transfer and the rewrite each had a page and an endpoint
 * of their own, and the three had drifted apart while doing the same job. A
 * mode returns data now, so a change to the shell reaches every flow at once.
 */
export interface SoldFlow {
  variant: WizardVariant;
  /** Page heading, e.g. "Mark as sold". */
  title: string;
  /** The line under it, upper-cased by the header. */
  subtitle: string;
  backTo: string;
  /** For the back arrow's `aria-label`, e.g. "Back to lead". */
  backLabel: string;
  /**
   * Where to send a caller whose anchor id is missing or malformed, or null when
   * it is usable. Only ever a typed or stale URL, so the page redirects rather
   * than explaining.
   */
  redirect: string | null;
  /** Label for the loading card, or null once the anchor record has arrived. */
  loading: string | null;
  errors: FlowError[];
  blocked: FlowBlock | null;
  ready: FlowReady | null;
  submitting: boolean;
  errorMessage: string | null;
  onSubmit: (values: SoldDealFormValues) => void;
}

/**
 * The carrier catalog (PAC-56 #19), which the wizard needs before it can render
 * the carrier select or validate a policy number against its rule.
 *
 * Reference data that only an admin surface can change, so a long `staleTime`
 * keeps it out of the way of someone moving between leads. Shared by all three
 * modes: every flow blocks on it, and blocks for the same reason.
 */
export function useCarrierCatalog() {
  return useQuery({
    queryKey: carriersKey,
    queryFn: getCarriers,
    staleTime: 30 * 60_000,
  });
}

/** The carrier failure, worded identically in all three flows. */
export function carrierError(
  query: ReturnType<typeof useCarrierCatalog>,
): FlowError[] {
  /*
   * A failed carrier fetch **blocks**, rather than falling through to free text.
   * Falling through would mean one network blip silently removes the carrier
   * vocabulary and its policy-number rules; a delayed sale is better than a sale
   * recorded against a mistyped carrier with an unvalidated number.
   */
  if (!query.isError) return [];
  return [
    {
      title: "Couldn't load the carrier list.",
      detail: query.error.message,
      retry: () => void query.refetch(),
    },
  ];
}
