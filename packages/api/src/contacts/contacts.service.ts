import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AccessContext, ContactDetail } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import {
  PrimaryContactService,
  successionRequired,
} from '../households/primary-contact.service';
import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseCalendarDate,
  toDateKey,
} from '../leads/intake/intake.normalize';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { ContactAccessService } from './contact-access.service';
import { ContactIdentityService } from './contact-identity.service';
import { UpdateContactDto } from './dto/update-contact.dto';
import { Contact, ContactDocument } from './schemas/contact.schema';

/**
 * Contact writes for the `clients` module (PAC-38).
 *
 * Today this backs exactly one interaction — the primary-contact edit on the
 * Lead Detail page. There is deliberately no read endpoint: `GET /leads/:id`
 * already carries the contact, and shipping an unused route is how the stub
 * this module replaced came to exist.
 */
@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    private readonly contactAccess: ContactAccessService,
    private readonly identity: ContactIdentityService,
    private readonly primaryContacts: PrimaryContactService,
  ) {}

  async update(
    access: AccessContext,
    branchId: string | null,
    contactId: string,
    dto: UpdateContactDto,
  ): Promise<ContactDetail> {
    const contact = await this.contactAccess.loadOwnedContact(
      access,
      branchId,
      contactId,
    );

    if (dto.firstName !== undefined) {
      contact.firstName = normalizeName(dto.firstName);
    }
    if (dto.lastName !== undefined) {
      contact.lastName = normalizeName(dto.lastName);
    }
    if (dto.dateOfBirth !== undefined) {
      // Parsed to UTC midnight from explicit components — never `new Date(str)`,
      // which shifts a birthday by a day west of Greenwich.
      contact.dateOfBirth = dto.dateOfBirth
        ? (parseCalendarDate(dto.dateOfBirth) ?? undefined)
        : undefined;
    }
    if (dto.email !== undefined) {
      // The intake normalizers, not a local re-implementation: contact matching
      // compares stored values against these exact shapes, so a divergent
      // lowercase/strip rule here would silently break dedupe.
      contact.email =
        (dto.email ? normalizeEmail(dto.email) : null) ?? undefined;
    }
    if (dto.phone !== undefined) {
      contact.phone =
        (dto.phone ? normalizePhone(dto.phone) : null) ?? undefined;
    }

    const marksDeceased = Boolean(dto.deceasedAt) && !contact.deceasedAt;
    if (dto.deceasedAt !== undefined) {
      contact.deceasedAt = dto.deceasedAt
        ? (parseCalendarDate(dto.deceasedAt) ?? undefined)
        : undefined;
    }

    /*
     * Refuse an edit that would make this contact a duplicate of another
     * (PAC-91 §9) — the same 409, carrying the same existing id, that the
     * creating paths return. Checked here rather than left to the unique index
     * so the response can name the contact to use instead of surfacing an
     * E11000. `save()` below still hits the index, which is what covers the
     * concurrent case.
     */
    await this.identity.assertNoDuplicate(contact.agencyId, contact, {
      excludeId: contact._id,
    });

    /*
     * Succession is settled BEFORE the contact is saved (PAC-91 §7).
     *
     * The two writes are not atomic — a household and a contact are different
     * documents and this endpoint runs outside a transaction — so the order
     * decides which half survives a failure. Resolving first means the only
     * reachable partial state is "the household has a new primary and the old
     * one is not yet marked deceased", which is merely out of date. The other
     * order leaves a household led by somebody recorded as dead, which is the
     * exact state §7 exists to make unreachable.
     */
    if (marksDeceased) {
      await this.settleSuccession(access, contact, dto);
    }

    // `nameKey` / `dobKey` are stamped by the schema's `pre('save')` hook.
    await contact.save();
    await this.mirrorOntoLeads(contact);

    return this.toDetail(contact);
  }

  /**
   * Marking a household's primary contact deceased cannot leave that household
   * led by a dead person (PAC-91 §7).
   *
   * Only fires on the **transition** into deceased: re-saving a contact who is
   * already marked must not demand a successor for a household whose succession
   * was settled months ago.
   *
   * The answer has to arrive in the same request, and there are exactly two:
   *
   * - `successorContactId` — rule (a), the recommendation. It goes through the
   *   same {@link PrimaryContactService.assign} the standalone endpoint uses,
   *   so the successor is held to the same three rules (a current member, not
   *   deceased, not already primary elsewhere) and the same
   *   `primary_contact_changed` row is written.
   * - `allowNoPrimary` — rule (c), the fallback. Records the gap as
   *   `dataQuality: 'no_primary'` rather than hiding it.
   *
   * Neither is a 409 carrying the eligible members, so the caller can choose
   * without a second round trip. Auto-promotion by role precedence — the (b)
   * that was considered — is deliberately absent: it guesses at something the
   * producer knows.
   *
   * A contact who leads no household needs none of this and is simply saved.
   */
  private async settleSuccession(
    access: AccessContext,
    contact: ContactDocument,
    dto: UpdateContactDto,
  ): Promise<void> {
    const household = await this.primaryContacts.householdLedBy(
      contact.agencyId,
      contact._id,
    );
    if (!household) return;

    if (dto.successorContactId) {
      if (!Types.ObjectId.isValid(dto.successorContactId)) {
        throw successionRequired(
          contact._id.toString(),
          household,
          await this.primaryContacts.listSuccessors(
            contact.agencyId,
            household._id,
            contact._id,
          ),
        );
      }
      await this.primaryContacts.assign({
        household,
        contactId: new Types.ObjectId(dto.successorContactId),
        actorUserId: actorId(access),
        reason: 'succession',
      });
      return;
    }

    if (dto.allowNoPrimary) {
      await this.primaryContacts.assign({
        household,
        contactId: null,
        allowNoPrimary: true,
        actorUserId: actorId(access),
        reason: 'succession',
      });
      return;
    }

    throw successionRequired(
      contact._id.toString(),
      household,
      await this.primaryContacts.listSuccessors(
        contact.agencyId,
        household._id,
        contact._id,
      ),
    );
  }

  /**
   * Copy the corrected **name** onto every lead this contact is primary for.
   *
   * `Lead` still duplicates `firstName` / `lastName` — a lead can exist before
   * anyone has decided which contact it belongs to, and the list and its search
   * read the lead's own copy — so fixing a surname without this would leave
   * `/leads` showing the old one forever and the producer would reasonably
   * conclude the edit failed.
   *
   * Email and phone are **not** mirrored any more, because the lead no longer
   * has anywhere to put them (PAC-91 §1–§3): every reader follows
   * `primaryContactId` to this contact, so the edit is already visible
   * everywhere the moment it is saved. That is the whole point of dropping the
   * copy — this mirror is what a denormalised field costs, and the remaining
   * two fields are the ones that earn it.
   *
   * Scoped to leads whose *primary* contact this is — editing a spouse or a
   * child must not rewrite the lead's own name. Best-effort: the contact is
   * already saved, and a failed mirror must not fail the request.
   */
  private async mirrorOntoLeads(contact: ContactDocument): Promise<void> {
    try {
      await this.leadModel.updateMany(
        { agencyId: contact.agencyId, primaryContactId: contact._id },
        {
          $set: {
            firstName: contact.firstName,
            lastName: contact.lastName,
          },
        },
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to mirror contact ${contact._id.toString()} onto its leads: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private toDetail(contact: ContactDocument): ContactDetail {
    const name = [contact.firstName, contact.lastName]
      .filter((part) => Boolean(part?.trim()))
      .join(' ')
      .trim();

    return {
      id: contact._id.toString(),
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      name: name || 'Unnamed contact',
      // A calendar date, not an instant — see `LeadDetailContact.dateOfBirth`.
      dateOfBirth: contact.dateOfBirth
        ? contact.dateOfBirth.toISOString().slice(0, 10)
        : null,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      // A calendar date too — a death has the same timezone hazard as a
      // birthday, and the client renders it with the same formatter.
      deceasedAt: toDateKey(contact.deceasedAt),
      /*
       * Both null/false here, and that is the honest answer (PAC-91 §5).
       *
       * Role and primacy are facts about a *membership*, and this endpoint has
       * no household in hand: it edits the person, from the Lead Detail page's
       * "Edit Primary Contact" modal. The page already knows both — it renders
       * them from `GET /leads/:id`, which resolves them against the lead's
       * household — so nothing on screen depends on this response carrying
       * them. Reading the stored `roleInHousehold` / `isPrimary` was what made
       * a Driver in one household render as a Named Insured in another.
       */
      role: null,
      isPrimary: false,
    };
  }
}

/**
 * The caller, as the activity row's author.
 *
 * `AccessContext.userId` is a string; `Activity.userId` is an ObjectId ref. The
 * guard chain only ever puts a real user id here, but a defensive check costs
 * nothing and a `CastError` inside a best-effort timeline write would be
 * swallowed by its own catch and never seen.
 */
function actorId(access: AccessContext): Types.ObjectId | null {
  return Types.ObjectId.isValid(access.userId)
    ? new Types.ObjectId(access.userId)
    : null;
}
