/**
 * Per-form-session idempotency key, shared by every form that has a deduped
 * write path (New Lead, Quote Recap).
 *
 * The `crypto` guard is not defensive padding: the public lead form is
 * mobile-first and gets opened over `http://192.168.x.x:5173` during testing,
 * which is **not a secure context**, so `crypto.randomUUID` is `undefined`
 * there and the page would crash on mount.
 */
export function newSubmissionToken(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
