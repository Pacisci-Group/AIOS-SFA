import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SERVICE_TICKET_CATEGORY_PREFIX } from '@sfa/shared';
import {
  ServiceTicket,
  type ServiceTicketDocument,
} from '../../crm/schemas/service-ticket.schema';
import {
  isDuplicateKeyError,
  isTicketNumberClash,
} from '../mongo/duplicate-key';

/** How many times to walk the number forward past a clash before giving up. */
const TICKET_NUMBER_RETRIES = 5;

/**
 * Allocates `RENEW-280`-style ticket numbers, and creates the ticket with one.
 *
 * Lifted out of `ServiceTicketsService` by PAC-99. Three callers now need it —
 * the service itself, `LeadTicketsService` for quote tickets, and the renewal
 * materializer that the worker cron drives — and the last of those sits behind
 * the worker's import boundary, which admits `common/` but not feature
 * services. Extracting the allocator was the alternative to duplicating it,
 * and a second allocator is how two tickets end up with one number.
 *
 * Only the `ServiceTicket` model is injected, so this crosses that boundary
 * cleanly.
 */
@Injectable()
export class TicketNumberService {
  constructor(
    @InjectModel(ServiceTicket.name)
    private readonly ticketModel: Model<ServiceTicketDocument>,
  ) {}

  /**
   * The next number for a category, as `PREFIX-nnn`.
   *
   * `countDocuments() + 1` is not atomic and the index that backs it is
   * unique, so this races by construction — see {@link createTicketWithNumber},
   * which owns the retry.
   *
   * Public because the create-ticket path allocates the number *before* it has
   * a document to write, and so cannot go through `createTicketWithNumber`.
   * That path has no retry, which is the behaviour it always had.
   */
  async nextTicketNumber(
    agencyId: string,
    category: string,
    attempt = 0,
  ): Promise<string> {
    // Typed over the category union in `@sfa/shared`; the fallback only covers
    // a stray string reaching here through `createTicketWithNumber`'s untyped doc.
    const prefix =
      (SERVICE_TICKET_CATEGORY_PREFIX as Record<string, string>)[category] ??
      'TKT';
    const count = await this.ticketModel.countDocuments({
      agencyId: new Types.ObjectId(agencyId),
    });
    // `attempt` walks the number forward on a clash. Re-counting alone is not
    // enough: the count only moves when a ticket is actually created, so a
    // number that is already taken — which happens once numbering has drifted
    // from the count, e.g. after deletions — would be retried identically
    // until the attempts ran out.
    return `${prefix}-${100 + count + 1 + attempt}`;
  }

  /**
   * Create a ticket, allocating its number with a retry.
   *
   * `nextTicketNumber` is a non-atomic `countDocuments() + 1` against a unique
   * index, so two tickets created in the same instant race. That was tolerable
   * when every ticket came from a human clicking a button; chaining creates a
   * ticket inside a completion handler, which makes the race real. Retrying on
   * the duplicate-key error is cheaper and less invasive than a counter
   * collection; each retry both re-counts *and* walks the number forward, so a
   * number that is simply already taken is skipped rather than retried.
   */
  async createTicketWithNumber(
    agencyId: string,
    doc: Record<string, unknown>,
  ): Promise<ServiceTicketDocument> {
    // `doc` is untyped by design — every caller assembles a different shape —
    // so narrow rather than blind-cast: a non-string category would otherwise
    // stringify to `[object Object]` and silently allocate a `TKT-` number.
    const category =
      typeof doc.category === 'string' && doc.category ? doc.category : 'Other';
    let lastError: unknown;

    for (let attempt = 0; attempt < TICKET_NUMBER_RETRIES; attempt += 1) {
      try {
        return await this.ticketModel.create({
          ...doc,
          ticketNumber: await this.nextTicketNumber(
            agencyId,
            category,
            attempt,
          ),
        });
      } catch (error) {
        // Only a ticketNumber clash is retryable. Any other duplicate — a
        // second ticket for the same onboarding step, say — must surface.
        if (!isDuplicateKeyError(error) || !isTicketNumberClash(error)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError;
  }
}
