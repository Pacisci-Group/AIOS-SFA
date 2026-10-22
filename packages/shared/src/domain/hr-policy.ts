/**
 * The "HR Policy" (PAC-148 §1) — three slots an owner is walked through at
 * onboarding: Leave & Attendance (PAC-161), Compensation and the Employee
 * Handbook (PAC-123, later).
 *
 * **A view, not a record** (Asad, 2026-10-22). The ticket first called for an
 * `hrPolicies` collection; everything it would have held already lives
 * elsewhere — whether the phase was skipped is `Agency.setup.hrPolicySkipped`,
 * and the leave policies are their own collection — and the two reserved
 * slots were constant placeholders. `GET /hr/policy` assembles this on read;
 * PAC-123 creates its own collections when it arrives.
 */
export type LeaveAndAttendanceSlotStatus = 'configured' | 'skipped' | 'none';

export interface HrPolicyView {
  leaveAndAttendance: {
    /**
     * `configured` — at least one active leave policy; `skipped` — the owner
     * skipped the onboarding phase and none has been added since; `none` —
     * no policy and the phase was never offered (a migrated agency).
     */
    status: LeaveAndAttendanceSlotStatus;
    activePolicyCount: number;
  };
  compensation: { status: 'reserved' };
  employeeHandbook: { status: 'reserved' };
}
