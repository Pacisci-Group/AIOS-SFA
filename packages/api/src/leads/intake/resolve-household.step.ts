import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SequenceService } from '../../common/mongo/sequence.service';
import {
  Contact,
  ContactDocument,
} from '../../contacts/schemas/contact.schema';
import { allocateHouseholdRef } from '../../households/household-ref';
import {
  Household,
  HouseholdDocument,
} from '../../households/schemas/household.schema';
import {
  buildAddressKey,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} from './intake.normalize';
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
 */
@Injectable()
export class ResolveHouseholdStep {
  constructor(
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    private readonly sequences: SequenceService,
  ) {}

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
   * Probe order: the real ObjectId ref, then the legacy SmartSuite id.
   *
   * The second hop is what makes migrated data work. Migrated contacts carry
   * `legacyHouseholdId` (a SmartSuite string) and no `householdId`, so without
   * it every returning legacy client would get a brand-new household. Finding
   * one backfills the ref, so each record self-heals the first time it is
   * touched and the second lookup is never needed again.
   */
  private async findExisting(
    contact: ResolvedContact,
    deps: StepDeps,
  ): Promise<HouseholdDocument | null> {
    if (contact.householdId) {
      const byId = await this.householdModel
        .findOne({ _id: contact.householdId, agencyId: deps.ctx.agencyId })
        .session(deps.session);
      if (byId) return byId;
    }

    if (contact.legacyHouseholdId) {
      const byLegacy = await this.householdModel
        .findOne({
          agencyId: deps.ctx.agencyId,
          legacySmartSuiteId: contact.legacyHouseholdId,
        })
        .session(deps.session);

      if (byLegacy) {
        await this.contactModel.updateOne(
          { _id: contact.contactId },
          { $set: { householdId: byLegacy._id } },
          sessionOptions(deps.session),
        );
        return byLegacy;
      }
    }

    return null;
  }

  private async create(
    contact: ResolvedContact,
    input: IntakeInput,
    deps: StepDeps,
  ): Promise<ResolvedHousehold> {
    const lastName = normalizeName(input.primaryContact.lastName);
    const firstName = normalizeName(input.primaryContact.firstName);
    const email = normalizeEmail(input.primaryContact.email);
    const phone = normalizePhone(input.primaryContact.phone);
    const addressKey = buildAddressKey(
      input.address?.street,
      input.address?.zip,
    );

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
          propertyAddress: this.toAddressObject(input),
          addressKey: addressKey ?? undefined,
          primaryContactName: `${firstName} ${lastName}`.trim(),
          primaryEmails: email ? [email] : [],
          primaryPhones: phone ? [phone] : [],
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

    const hasAddress =
      household.propertyAddress &&
      Object.keys(household.propertyAddress).length > 0;
    if (hasAddress) return;

    const addressKey = buildAddressKey(
      input.address?.street,
      input.address?.zip,
    );
    await this.householdModel.updateOne(
      { _id: household._id },
      {
        $set: {
          propertyAddress: address,
          ...(addressKey ? { addressKey } : {}),
        },
      },
      sessionOptions(deps.session),
    );
  }

  private toAddressObject(
    input: IntakeInput,
  ): Record<string, unknown> | undefined {
    const { street, city, state, zip } = input.address ?? {};
    if (!street && !city && !state && !zip) return undefined;
    return { street, city, state, zip };
  }
}
