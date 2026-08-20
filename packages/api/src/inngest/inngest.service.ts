import { Inject, Injectable, Logger } from '@nestjs/common';
import { INNGEST_CLIENT, type InngestClient } from './inngest.client';

/**
 * The minimum shape of a catalog {@link EventType} that {@link InngestService}
 * needs.
 *
 * Structural rather than importing `EventType` with its two generics: this
 * keeps the signature readable at call sites and avoids taking a direct
 * dependency on `@standard-schema/spec`, which is only a transitive dep of
 * `inngest` and could vanish from the hoisted tree on any install.
 */
interface CatalogEvent<TArgs extends unknown[]> {
  readonly name: string;
  create(...args: TArgs): { validate(): Promise<void> };
}

/**
 * The one way anything on the API side hands work to the worker.
 *
 * ## Failure contract — deliberately a throw, never a swallow
 * `send()` rejects if the Inngest event API is unreachable. Callers must let
 * that propagate. `UsersService.issueInvite` depends on it: it saves the user
 * *before* sending, so a throw leaves a **pending invite the owner can resend**
 * rather than a half-created account. Swallowing the error here would turn a
 * visible, recoverable failure into an invite that silently never arrives.
 *
 * A resolved promise means Inngest has durably accepted the event — that the
 * work *will* happen, not that it has happened.
 */
@Injectable()
export class InngestService {
  private readonly logger = new Logger(InngestService.name);

  constructor(@Inject(INNGEST_CLIENT) public readonly client: InngestClient) {}

  /**
   * Send one event, built from a catalog event type.
   *
   * Taking the catalog object rather than a raw `{ name, data }` is what makes
   * the payload type-checked at the call site — a renamed or retyped field
   * becomes a compile error in the *producer*, which is the whole reason the
   * catalog lives outside `src/worker/`.
   */
  async send<TArgs extends unknown[]>(
    event: CatalogEvent<TArgs>,
    ...args: TArgs
  ): Promise<void> {
    const created = event.create(...args);

    // Validate before sending. Inngest does not validate on send, so without
    // this a payload that violates the catalog sails through and blows up in
    // the worker instead — far away from the code that got it wrong.
    await created.validate();

    await this.client.send(created as never);
    this.logger.debug(`Sent ${event.name}`);
  }
}
