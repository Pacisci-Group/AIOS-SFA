import { Injectable, Logger, SetMetadata } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { InngestFunction as InngestFunctionType } from 'inngest';

/** Metadata key marking a provider as a holder of Inngest functions. */
export const INNGEST_FUNCTION_METADATA = 'sfa:inngest-function';

/**
 * Marks a provider whose {@link InngestFunctionProvider.build} output should be
 * served to Inngest.
 *
 * The class must also be listed in a module's `providers` — this decorator makes
 * it *discoverable*, not instantiable.
 */
export const InngestFunction = (): ClassDecorator =>
  SetMetadata(INNGEST_FUNCTION_METADATA, true);

/** Contract every `@InngestFunction()` provider implements. */
export interface InngestFunctionProvider {
  /**
   * Build the function(s) this provider owns.
   *
   * Called once, after the container is up, so `this.<injected dependency>` is
   * safe to close over inside the handler.
   */
  build(): InngestFunctionType.Any | InngestFunctionType.Any[];
}

/**
 * Collects every `@InngestFunction()` provider into the list `serve()` needs.
 *
 * ## Why this exists
 * `serve()` mounts as raw Express middleware via `app.use()`, which puts it
 * entirely outside Nest's DI container — it never sees a provider, a guard or a
 * pipe. The naive consequence is that function handlers become free functions
 * reaching for module-level globals, which cannot inject a Mongoose model and
 * cannot be swapped for a fake in a test.
 *
 * Resolving the list *from* the container instead keeps every handler a normal
 * `@Injectable`. It also means the served set is identical whether the process
 * booted from `AppModule` (worker inline) or `WorkerModule` (worker standalone)
 * — the two entrypoints cannot drift, because neither of them enumerates
 * functions by hand.
 */
@Injectable()
export class InngestRegistry {
  private readonly logger = new Logger(InngestRegistry.name);

  constructor(private readonly discovery: DiscoveryService) {}

  all(): InngestFunctionType.Any[] {
    const functions = this.discovery
      .getProviders()
      .filter((wrapper) => {
        // `metatype` is undefined for value/factory providers, and `instance`
        // is null for those never resolved (e.g. a lazily-scoped provider).
        // Either way there is no decorated class to read, so skip.
        if (!wrapper.metatype || !wrapper.instance) return false;
        return (
          Reflect.getMetadata(INNGEST_FUNCTION_METADATA, wrapper.metatype) ===
          true
        );
      })
      .flatMap((wrapper) => {
        const provider = wrapper.instance as InngestFunctionProvider;
        const built = provider.build();
        return Array.isArray(built) ? built : [built];
      });

    if (functions.length === 0) {
      // Not fatal — an API booted with WORKER_INLINE=false legitimately serves
      // none. But a *worker* with none is a silent no-op that still passes every
      // health check, so it is worth a line in the log either way.
      this.logger.warn('No Inngest functions discovered.');
    } else {
      this.logger.log(`Discovered ${functions.length} Inngest function(s).`);
    }

    return functions;
  }
}
