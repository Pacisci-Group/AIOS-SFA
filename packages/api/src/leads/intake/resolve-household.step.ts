import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { StoredAddress } from '@sfa/shared';
import {
  normalizeStoredAddress,
  resolveHouseholdAddress,
} from '../../common/address/household-address';
import { SequenceService } from '../../common/mongo/sequence.service';
import { HouseholdMembersService } from '../../households/household-members.service';
import { allocateHouseholdRef } from '../../households/household-ref';
import {
  Household,
  HouseholdDocument,
} from '../../households/schemas/household.schema';
import { AmbiguousHouseholdException } from './ambiguous-household.exception';
import { normalizeName } from './intake.normalize';
import {
  IntakeInput,
  ResolvedContact,
  ResolvedHousehold,
  sessionOptions,
  StepDeps,
} from './intake.types';

/**
 * Step 2 — the household is **derived from the resolved contact**, never looked
 * up by address.
 *
 * This is the ordering the ticket calls out as contradicting both the prototype
 * and the archived PAC-38 spec, which always create a household. Contact-first
 * derivation is what stops an existing client acquiring a second household every
 * time they come back through a form.
 *
 * Address is deliberately *not* a lookup key. `addressKey` is stored here for
 * future use and used as a lead-dedupe signal, but merging households by address
 * would silently join unrelated people: apartment buildings without unit
 * numbers, house shares, and previous occupants all collide on `street|zip`.
 * Legacy agrees in practice — it writes `address_key` and never queries it.
 *
 * {@link pin} is the one exception, and it is not an inference at all: the
 * authenticated caller names a household they already have on screen.
 *
 * ── Derivation reads memberships, and refuses to guess (PAC-91 §5) ──────────
 * This step used to read `contact.householdId` — one link per person, holding
 * whichever household was linked *last*. Under the owner's ground truth a
 * contact can belong to several, so that field was answering a question it
 * could not answer, arbitrarily and silently. Now:
 *
 * - no membership → create a household, as before;
 * - exactly one → that one;
 * - several → {@link AmbiguousHouseholdException}, carrying the candidates so
 *   the form can ask. Choosing is the caller's job; the one thing this step
 *   must not do is pick.
 *
 * The legacy `legacyHouseholdId` self-heal that used to sit here is gone with
 * the field: the PAC-91 §8 backfill resolved those links into real refs, and
 * the seed migration turned every one of them into a membership.
 */
@Injectable()
export class ResolveHouseholdStep {
  constructor(
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    private readonly memberships: HouseholdMembersService,
    private readonly sequences: SequenceService,
  ) {}

  /**
   * The caller already knows the household — take it as given.
   *
   * Scoped to the caller's agency, and a miss is a `404` rather than a silent
   * fallback to derivation: "create this lead on household X" failing quietly
   * onto some other household is the one outcome nobody could detect.
   *
   * Runs **before** contact resolution (unlike {@link run}), because the pinned
   * household is what narrows the contact search.
   */
  async pin(householdId: string, deps: StepDeps): Promise<ResolvedHousehold> {
    if (!Types.ObjectId.isValid(householdId)) {
      throw new NotFoundException('Household not found');
    }

    const household = await this.householdModel
      .findOne({
        _id: new Types.ObjectId(householdId),
        agencyId: deps.ctx.agencyId,
      })
      .select('_id')
      .session(deps.session);
    if (!household) {
      throw new NotFoundException('Household not found');
    }

    return { householdId: household._id, isNew: false };
  }

  async run(
    contact: ResolvedContact,
    input: IntakeInput,
    deps: StepDeps,
  ): Promise<ResolvedHousehold> {
    const existing = await this.findExisting(contact, deps);
    if (existing) {
      await this.backfillAddressIfBlank(existing, input, deps);
      return { householdId: existing._id, isNew: false };
    }
    return this.create(contact, input, deps);
  }

  /**
   * The one household this contact currently belongs to, or `null` to create.
   *
   * Throws rather than choosing when there are several — see the class
   * docblock. The households are re-read here (rather than trusting the
   * membership rows alone) so the chooser can show a name and an address, and
   * so a membership pointing at a household outside the agency, or at one that
   * has since been removed, resolves to "no household" instead of a dead ref.
   */
  private async findExisting(
    contact: ResolvedContact,
    deps: StepDeps,
  ): Promise<HouseholdDocument | null> {
    const memberships = await this.memberships.listByContact(
      deps.ctx.agencyId,
      contact.contactId,
      { session: deps.session },
    );
    if (!memberships.length) return null;

    const households = await this.householdModel
      .find({
        _id: { $in: memberships.map((membership) => membership.householdId) },
        agencyId: deps.ctx.agencyId,
      })
      .session(deps.session);

    if (households.length === 0) return null;
    if (households.length === 1) return households[0];

    throw new AmbiguousHouseholdException(
      contact.contactId.toString(),
      households.map((household) => ({
        id: household._id.toString(),
        reference: household.householdRef ?? null,
        name: household.name ?? null,
        // Coerced here, as everywhere else: `propertyAddress` is a loose
        // `Record<string, unknown>` whose keys differ per writer.
        address: resolveHouseholdAddress(
          null,
          household.propertyAddress,
          household.mailingAddress,
        ),
      })),
    );
  }

  private async create(
    contact: ResolvedContact,
    input: IntakeInput,
    deps: StepDeps,
  ): Promise<ResolvedHousehold> {
    const lastName = normalizeName(input.primaryContact.lastName);

    // Allocated on the same session as the insert, so a failed intake rolls the
    // number back with it and the agency's series stays gapless.
    const householdRef = await allocateHouseholdRef(
      this.sequences,
      deps.ctx.agencyId,
      deps.session,
    );

    const [created] = await this.householdModel.create(
      [
        {
          agencyId: deps.ctx.agencyId,
          branchId: deps.ctx.branchId,
          householdRef,
          name: lastName ? `${lastName} Household` : 'New Household',
          // The household's LIVING address. An insured property address is a
          // different thing entirely and is captured later, on the quote.
          // `addressKey` is stamped by `HouseholdSchema`'s pre-save hook.
          propertyAddress: this.toAddressObject(input),
          /*
           * No `primaryContactName` / `primaryEmails` / `primaryPhones`
           * (PAC-91 §4). Intake was the only writer of those three, which is
           * why every household it did *not* create rendered an em dash for
           * them, and nothing kept them in step with the contact afterwards.
           * `primaryContactId` is the whole of the fact now, and every reader
           * follows it. The roster is written by `LinkEntitiesStep` as
           * memberships (PAC-91 §5), not as an array here.
           */
          primaryContactId: contact.contactId,
          totalActivePolicies: 0,
          isTestRecord: false,
        },
      ],
      sessionOptions(deps.session),
    );

    deps.created.track(this.householdModel, created._id);
    return { householdId: created._id, isNew: true };
  }

  /**
   * Fill in the address only when the household has none.
   *
   * An intake form must not rewrite a known client's address: the submitter may
   * be a referral partner typing from memory, or the client may have moved and
   * the office may already hold the corrected record. Adding what's missing is
   * safe; overwriting what's there is not.
   */
  private async backfillAddressIfBlank(
    household: HouseholdDocument,
    input: IntakeInput,
    deps: StepDeps,
  ): Promise<void> {
    const address = this.toAddressObject(input);
    if (!address) return;

    // ⚠ Not `Object.keys(household.propertyAddress).length`. Since PAC-101 this
    // is a typed sub-document, and `Object.keys()` on one returns Mongoose's
    // internals (`$__parent`, `$__`, `$isNew`, `_doc`) — length 4 whatever it
    // holds, including when it is empty. That test would be permanently true
    // and this backfill would silently stop happening.
    if (normalizeStoredAddress(household.propertyAddress)) return;

    // `addressKey` is stamped by `HouseholdSchema`'s pre-update hook.
    await this.householdModel.updateOne(
      { _id: household._id },
      { $set: { propertyAddress: address } },
      sessionOptions(deps.session),
    );
  }

  private toAddressObject(input: IntakeInput): StoredAddress | undefined {
    const { street, city, state, zip } = input.address ?? {};
    if (!street && !city && !state && !zip) return undefined;
    return { street, city, state, zip };
  }
}
