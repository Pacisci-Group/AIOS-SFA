/**
 * A process-wide "at most `limit` starts per `periodMs`" gate.
 *
 * ## Why this exists beside Inngest's `throttle`
 *
 * Resend's default account limit is 2 requests/second **for the account**.
 * Inngest's `throttle` is per *function*: it bounds how many runs of
 * `send-notification-email` start per second, and says nothing about the
 * invite, password-reset, campaign-output and data-export mails that share
 * the same API key. A notification fan-out during a bulk invite could add up
 * to more than two a second and collect the 429s the throttle was meant to
 * prevent (PR3 second review). There is no cross-function throttle key in
 * Inngest, so the account-wide limit has to live where every mail passes:
 * the transport.
 *
 * ## Per process, by design
 *
 * The worker is one container (the Aug-19 architecture decision: a modular
 * monolith with a single separately-deployable worker), and `api:dev` runs
 * the worker inline — one process either way, so a process gate *is* the
 * account gate. If the worker is ever scaled out, lower `limit` per replica
 * or move the budget to Redis; the per-function `throttle` stays as the
 * cluster-wide bound on any one function's share.
 *
 * ## Shape
 *
 * A sliding window over the last `limit` start times: `acquire()` resolves
 * at once while fewer than `limit` sends started in the last `periodMs`,
 * otherwise after the oldest of them leaves the window. Callers queue in
 * order; nothing is dropped and nothing throws.
 */
export class RateGate {
  private readonly starts: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly limit: number,
    private readonly periodMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    if (!(limit > 0) || !(periodMs > 0)) {
      throw new Error('RateGate needs a positive limit and period');
    }
  }

  /** Resolves when the caller may start. Callers are served in order. */
  acquire(): Promise<void> {
    const turn = this.queue.then(() => this.wait());
    // Keep the chain alive whatever happens to `turn`.
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async wait(): Promise<void> {
    for (;;) {
      const now = this.now();
      while (this.starts.length > 0 && now - this.starts[0] >= this.periodMs) {
        this.starts.shift();
      }
      if (this.starts.length < this.limit) {
        this.starts.push(now);
        return;
      }
      await this.sleep(this.periodMs - (now - this.starts[0]));
    }
  }
}
