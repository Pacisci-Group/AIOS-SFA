import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PRIMARY_HOUSEHOLD_ROLE } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { HouseholdMembersService } from '../../households/household-members.service';
import {
  Household,
  HouseholdDocument,
} from '../../households/schemas/household.schema';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import { IntakeMemberContact, sessionOptions, StepDeps } from './intake.types';

export interface LinkEntitiesInput {
  contactId: Types.ObjectId;
  householdId: Types.ObjectId;
  householdIsNew: boolean;
  leadId: Types.ObjectId;
  leadIsNew: boolean;
  members: IntakeMemberContact[];
}

/**
 * Step 4 — set the refs between lead, household, primary contact and members.
 *
 * Every write here is an atomic operator (`$set` / `$addToSet` / an upsert),
 * never read-modify-write. That is a deliberate departure from legacy, which
 * fetched the household, merged arrays in memory, and wrote them back — and
 * whose error branch fell back to writing `{ members: [contactId], leads:
 * [leadId] }`, **wiping every other member and lead on the household**. With
 * `$addToSet` there is no read step to fail, so that entire failure mode and
 * its catch block simply do not exist here.
 *
 * ── Linking ADDS a membership; it never moves the contact (PAC-91 §5) ───────
 * This step used to `$set contact.householdId` for the primary and every
 * member. With one link per person that was not a link at all but a *move*:
 * submitting a form for someone who already belonged to another household
 * pointed them at this one, while the household they came from went on listing
 * them as a member. The two sides then disagreed and nothing reconciled them —
 * which is also why `ResolveContactStep` had to confine pinned matching to the
 * pinned household, creating a duplicate contact rather than risk the move.
 *
 * A membership is now a row in `householdMembers`, upserted, so a returning
 * submission is a no-op and belonging to three households is three rows.
 * Nothing here removes one: ending a membership is its own operation
 * (`DELETE /households/:id/members/:contactId`).
 */
@Injectable()
export class LinkEntitiesStep {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    private readonly memberships: HouseholdMembersService,
  ) {}

  async run(input: LinkEntitiesInput, deps: StepDeps): Promise<void> {
    const options = sessionOptions(deps.session);

    /*
     * Tenancy for the memberships comes from the household, not from the
     * caller: a producer whose branch differs from the household's would
     * otherwise stamp a membership into a branch the household does not belong
     * to, and it would be invisible to everyone reading the household. Same
     * rule `ClientsService.addHouseholdMember` follows.
     */
    const household = await this.householdModel
      .findOne({ _id: input.householdId })
      .select('agencyId branchId primaryContactId')
      .session(deps.session);
    if (!household) return;

    const write = { session: deps.session, created: deps.created };
    await this.memberships.add(
      {
        agencyId: household.agencyId,
        branchId: household.branchId,
        householdId: input.householdId,
        contactId: input.contactId,
        role: PRIMARY_HOUSEHOLD_ROLE,
        source: 'intake',
      },
      write,
    );
    for (const member of input.members) {
      await this.memberships.add(
        {
          agencyId: household.agencyId,
          branchId: household.branchId,
          householdId: input.householdId,
          contactId: member.contactId,
          role: member.role,
          source: 'intake',
        },
        write,
      );
    }

    /*
     * `primaryContactId` is set only when the household doesn't already have
     * one. Legacy set it unconditionally, so a second lead for an existing
     * household quietly reassigned who its primary contact was.
     *
     * And only when this contact is not already the primary of a *different*
     * household (PAC-91 §5): a contact is the primary of at most one, which the
     * partial unique index on `{agencyId, primaryContactId}` now enforces —
     * without this check a pinned intake for somebody who already heads their
     * own household would fail the whole submission on an E11000. Leaving the
     * pinned household without a primary is the honest outcome: the submitter
     * is a member of it, and who leads it is a decision for the explicit
     * assign-primary operation (PAC-91 §7), not for a lead form.
     */
    const alreadyPrimaryElsewhere = await this.householdModel
      .exists({
        agencyId: household.agencyId,
        primaryContactId: input.contactId,
        _id: { $ne: input.householdId },
      })
      .session(deps.session);
    const shouldSetPrimary =
      !alreadyPrimaryElsewhere &&
      (input.householdIsNew || !household.primaryContactId);

    await this.householdModel.updateOne(
      { _id: input.householdId },
      {
        $addToSet: { leadIds: input.leadId },
        ...(shouldSetPrimary
          ? { $set: { primaryContactId: input.contactId } }
          : {}),
      },
      options,
    );

    // Only a NEW lead has its household and primary contact pointed here.
    // When we deduped onto an existing lead, `ResolveLeadStep` already decided
    // — filling those refs only if they were empty — and repointing them now
    // would undo that: a returning submission would silently move an
    // established lead onto a freshly created household.
    const memberContactIds = input.members.map((member) => member.contactId);
    const leadUpdate = {
      ...(input.leadIsNew
        ? {
            $set: {
              householdId: input.householdId,
              primaryContactId: input.contactId,
            },
          }
        : {}),
      ...(memberContactIds.length
        ? { $addToSet: { memberContactIds: { $each: memberContactIds } } }
        : {}),
    };
    // An existing lead with no members leaves nothing to write, and the driver
    // rejects an empty update rather than treating it as a no-op.
    if (Object.keys(leadUpdate).length) {
      await this.leadModel.updateOne(
        { _id: input.leadId },
        leadUpdate,
        options,
      );
    }
  }
}
