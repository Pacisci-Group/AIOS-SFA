import { PoliciesTab } from "@/features/hr/settings/policies/PoliciesTab";

/**
 * The HR Policy phase of the owner's first-run setup (PAC-161).
 *
 * Starts empty on purpose (Asad, 2026-10-22): no policy is seeded and none
 * is a default. "Add a policy" opens the editor pre-filled from the spec
 * values; skipping leaves the agency with none, which means HR is a
 * calendar and nothing more until a policy is added under Settings.
 */
export function HrPolicyStep() {
  return (
    <PoliciesTab
      canWrite
      emptyMessage={
        <>
          Add a leave policy if your team will request time off and report
          attendance here — one for everyone, or one per role. Skip this and
          the app simply won&apos;t use that feature until you add one under
          Settings → HR.
        </>
      }
    />
  );
}
