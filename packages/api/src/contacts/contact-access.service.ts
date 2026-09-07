import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DataScope } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { HouseholdMembersService } from '../households/household-members.service';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { Contact, ContactDocument } from './schemas/contact.schema';

/**
 * Scope-clamped contact lookup — the mirror of {@link LeadAccessService} for the
 * `clients` module.
 *
 * **Why this exists.** `Contact` carries no `producerId` and no lead reference,
 * so under `DataScope.Own` there is nothing to clamp against directly. A bare
 * `agencyId` filter — the obvious implementation — would let any producer edit
 * any client in the agency, which is a materially worse guarantee than every
 * other producer-facing write path in the system.
 *
 * Ownership is therefore **derived**: the caller must own a lead that reaches
 * this contact, either directly (`primaryContactId` / `memberContactIds`) or
 * through the contact's household. That is exactly the roster the Lead Detail
 * page renders, and the only surface these edits are reachable from — so the
 * rule matches the real workflow rather than narrowing it.
 *
 * 404 throughout, never 403, for the same reason as
 * `LeadAccessService.loadOwnedLead`: whether another producer's client exists is
 * not the caller's business.
 */
@Injectable()
export class ContactAccessService {
  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    private readonly memberships: HouseholdMembersService,
  ) {}

  async loadOwnedContact(
    access: AccessContext,
    branchId: string | null,
    contactId: string,
  ): Promise<ContactDocument> {
    // A malformed id is a miss, not a 500.
    if (!Types.ObjectId.isValid(contactId)) {
      throw new NotFoundException('Contact not found.');
    }

    const contact = await this.contactModel.findOne({
      _id: new Types.ObjectId(contactId),
      agencyId: access.agencyId,
    });
    if (!contact) throw new NotFoundException('Contact not found.');

    if (access.dataScope === DataScope.Agency) return contact;

    if (access.dataScope === DataScope.Branch) {
      // `Contact extends TenantRecord`, so unlike the `own` case the branch
      // clamp is a direct field comparison.
      if (branchId && contact.branchId !== branchId) {
        throw new NotFoundException('Contact not found.');
      }
      return contact;
    }

    await this.assertReachableFromOwnedLead(contact, access);
    return contact;
  }

  /**
   * The derived-ownership probe.
   *
   * Served by the `{agencyId, primaryContactId}`, `{agencyId, memberContactIds}`
   * and `{agencyId, householdId}` indexes on `leads`.
   *
   * The household leg reads the contact's memberships (PAC-91 §5) instead of
   * the single `Contact.householdId` / `legacyHouseholdId` pair that used to be
   * here. That is strictly wider in the right direction: a producer who owns a
   * lead on *any* household this person belongs to reaches them, where before
   * only whichever household happened to be stored last counted. The
   * `legacyHouseholdId` leg is gone with the field — the PAC-91 §8 backfill
   * resolved those strings into real refs and the seed migration turned every
   * one into a membership, so there is nothing left for it to catch.
   */
  private async assertReachableFromOwnedLead(
    contact: ContactDocument,
    access: AccessContext,
  ): Promise<void> {
    const reaches: FilterQuery<LeadDocument>[] = [
      { primaryContactId: contact._id },
      { memberContactIds: contact._id },
    ];

    // The contact's own `agencyId` — the plain string this collection stores —
    // rather than the nullable one on `AccessContext`. `loadOwnedContact`
    // already matched the two, so they are the same tenant.
    const memberships = await this.memberships.listByContact(
      contact.agencyId,
      contact._id,
    );
    if (memberships.length) {
      reaches.push({
        householdId: {
          $in: memberships.map((membership) => membership.householdId),
        },
      });
    }

    const owned = await this.leadModel.exists({
      agencyId: access.agencyId,
      producerId: new Types.ObjectId(access.userId),
      $or: reaches,
    });

    if (!owned) throw new NotFoundException('Contact not found.');
  }
}
