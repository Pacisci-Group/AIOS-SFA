/**
 * The **layout tier** of the forms foundation — deliberately library-agnostic.
 *
 * Nothing in this directory imports a form library. That is the seam: when the
 * binding layer moves (react-hook-form → TanStack Form), this tier does not
 * change. Field binding lives in `./fields`, which is the only place that knows
 * which library is in use.
 *
 * See `AGENTS.md` §11 (Conventions → UI) for why these are app composites in
 * `components/form/` rather than primitives in `components/ui/`.
 */
export { FormSection } from "./FormSection";
export { FormSubPanel } from "./FormSubPanel";
export { FormGrid } from "./FormGrid";
export { FormError } from "./FormError";
