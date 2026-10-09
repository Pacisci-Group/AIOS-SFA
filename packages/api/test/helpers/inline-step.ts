/**
 * A fake Inngest `step` that runs each `step.run` inline and records the ids
 * it saw, for driving a worker function's `handle()` directly.
 *
 * Deliberately no memoisation: that is the platform's to prove. What these
 * tests assert is what each step *does*, and in which order.
 */
export function inlineStep(): {
  ran: string[];
  step: {
    run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
  };
} {
  const ran: string[] = [];
  return {
    ran,
    step: {
      run: async <T>(
        id: string,
        fn: () => Promise<T> | T,
      ): Promise<unknown> => {
        ran.push(id);
        return await fn();
      },
    },
  };
}
