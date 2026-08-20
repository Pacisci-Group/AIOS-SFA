import confetti from "canvas-confetti";

/**
 * A short confetti burst, for the one moment in the app worth celebrating
 * (PAC-65 #12 — booking a sale).
 *
 * ## Why this exists as a module
 *
 * One import site for the dependency, and one place the reduced-motion check
 * lives. Calling `confetti()` inline at the call site would work and would put
 * the accessibility guard somewhere it can be forgotten the second time
 * somebody wants a celebration.
 *
 * ## Why it survives an immediate navigate
 *
 * `canvas-confetti` appends its own fixed-position canvas to `document.body`,
 * outside React's tree, and removes it when the animation finishes. That is
 * what lets the sold flow fire this and then `navigate(..., { replace: true })`
 * on the same tick — a React-rendered animation would unmount mid-burst.
 *
 * ## The ticket said "lead review completion"
 *
 * There is no lead-review concept in this product; that was an error in the
 * 08-10 scrum notes, confirmed with Asad. The moment meant is **mark as sold**,
 * which is also the one the Aug-4 sold-notification precedent points at.
 */
export function celebrate(): void {
  // Someone who has asked their OS to reduce motion has asked for this
  // specifically. Nothing depends on the burst, so skipping it costs nothing.
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  // Two bursts from the lower corners rather than one from the centre: a
  // centred burst lands over the content the user is being navigated to.
  const shared = { particleCount: 60, spread: 70, startVelocity: 45, ticks: 120 };
  void confetti({ ...shared, origin: { x: 0.15, y: 0.9 }, angle: 60 });
  void confetti({ ...shared, origin: { x: 0.85, y: 0.9 }, angle: 120 });
}
