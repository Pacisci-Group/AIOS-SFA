import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Contact,
  ContactDocument,
} from '../../contacts/schemas/contact.schema';
import {
  Household,
  HouseholdDocument,
} from '../../households/schemas/household.schema';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import { sessionOptions, StepDeps } from './intake.types';

export interface LinkEntitiesInput {
  contactId: Types.ObjectId;
  householdId: Types.ObjectId;
  householdIsNew: boolean;
  leadId: Types.ObjectId;
  leadIsNew: boolean;
  memberContactIds: Types.ObjectId[];
}

/**
 * Step 4 — set the refs between lead, household, primary contact and members.
 *
 * Every write here is an atomic operator (`$set` / `$addToSet`), never
 * read-modify-write. That is a deliberate departure from legacy, which fetched
 * the household, merged arrays in memory, and wrote them back — and whose
 * error branch fell back to writing `{ members: [contactId], leads: [leadId] }`,
 * **wiping every other member and lead on the household**. With `$addToSet`
 * there is no read step to fail, so that entire failure mode and its catch
 * block simply do not exist here.
 */
@Injectable()
export class LinkEntitiesStep {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
  ) {}

  async run(input: LinkEntitiesInput, deps: StepDeps): Promise<void> {
    const options = sessionOptions(deps.session);

    await this.contactModel.updateOne(
      { _id: input.contactId },
      { $set: { householdId: input.householdId } },
      options,
    );

    if (input.memberContactIds.length > 0) {
      await this.contactModel.updateMany(
        { _id: { $in: input.memberContactIds } },
        { $set: { householdId: input.householdId } },
        options,
      );
    }

    // `primaryContactId` is set only when the household doesn't already have
    // one. Legacy set it unconditionally, so a second lead for an existing
    // household quietly reassigned who its primary contact was.
    const household = await this.householdModel
      .findOne({ _id: input.householdId })
      .select('primaryContactId')
      .session(deps.session);
    const shouldSetPrimary =
      input.householdIsNew || !household?.primaryContactId;

    await this.householdModel.updateOne(
      { _id: input.householdId },
      {
        $addToSet: {
          memberContactIds: { $each: input.memberContactIds },
          leadIds: input.leadId,
        },
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
    await this.leadModel.updateOne(
      { _id: input.leadId },
      {
        ...(input.leadIsNew
          ? {
              $set: {
                householdId: input.householdId,
                primaryContactId: input.contactId,
              },
            }
          : {}),
        $addToSet: { memberContactIds: { $each: input.memberContactIds } },
      },
      options,
    );
  }
}
