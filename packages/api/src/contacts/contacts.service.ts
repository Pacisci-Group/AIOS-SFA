import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AccessContext, ContactDetail } from '@sfa/shared';
import { Model } from 'mongoose';
import {
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseDateOfBirth,
} from '../leads/intake/intake.normalize';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { ContactAccessService } from './contact-access.service';
import { UpdateContactDto } from './dto/update-contact.dto';
import { Contact, ContactDocument } from './schemas/contact.schema';

/**
 * Replace the first entry of a stored array field, preserving the rest.
 *
 * `emails` and `phones` are arrays and a contact may legitimately hold several;
 * the edit form exposes one. Overwriting the whole array would silently discard
 * a second number nobody asked to remove, so only element 0 — the one the UI
 * displays — is touched. `null` removes it.
 */
function replaceFirst(current: string[], value: string | null): string[] {
  const rest = current.slice(1);
  return value === null ? rest : [value, ...rest];
}

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
        ? (parseDateOfBirth(dto.dateOfBirth) ?? undefined)
        : undefined;
    }
    if (dto.email !== undefined) {
      // The intake normalizers, not a local re-implementation: contact matching
      // compares stored values against these exact shapes, so a divergent
      // lowercase/strip rule here would silently break dedupe.
      contact.emails = replaceFirst(
        contact.emails ?? [],
        dto.email ? normalizeEmail(dto.email) : null,
      );
    }
    if (dto.phone !== undefined) {
      contact.phones = replaceFirst(
        contact.phones ?? [],
        dto.phone ? normalizePhone(dto.phone) : null,
      );
    }

    await contact.save();
    await this.mirrorOntoLeads(contact);

    return this.toDetail(contact);
  }

  /**
   * Copy the corrected identity onto every lead this contact is *primary* for.
   *
   * `Lead` duplicates `firstName`, `lastName`, `emails` and `phones`, and the
   * Leads list, its search, and the detail page header all read the **lead's**
   * copy. Without this, fixing a surname would leave `/leads` showing the old
   * one forever, and the producer would reasonably conclude the edit failed.
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
            emails: contact.emails,
            phones: contact.phones,
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
      email: contact.emails?.[0] ?? null,
      phone: contact.phones?.[0] ?? null,
      role: contact.roleInHousehold ?? null,
      isPrimary: contact.isPrimary ?? false,
    };
  }
}
