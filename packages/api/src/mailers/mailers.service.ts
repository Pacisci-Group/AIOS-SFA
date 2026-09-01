import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AccessContext,
  LogMailerLeadResponse,
  MAILER_LEAD_SOURCE_CODE,
  MailerLookupView,
  mailerControlNumberKey,
  normalizeLeadSource,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { buildScopeFilter } from '../common/access/scope-filter';
import { resolveCountyName } from '../common/mailers/county-names';
import { TenantContextResolver } from '../common/tenancy/tenant-context.resolver';
import { IntakeContext, IntakePerson } from '../leads/intake/intake.types';
import { LeadIntakeService } from '../leads/intake/lead-intake.service';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { Mailer, MailerDocument } from './schemas/mailer.schema';

/** The recipient name a lead is created under. */
export interface MailerName {
  firstName: string;
  lastName: string;
}

/**
 * The recipient's name, in the shape `IntakePerson` requires.
 *
 * `IntakePerson.firstName` and `.lastName` are required strings while every
 * name field on a mailer is optional, so this is where the gap is closed —
 * exported and pure so it can be unit-tested without a database.
 *
 * The one-token case puts the token in `lastName` rather than `firstName` on
 * purpose: `ResolveHouseholdStep` names a household `` `${lastName} Household` ``,
 * so "Smith" yields *Smith Household* and a lead named "Smith", where the other
 * placement yields *New Household* and the same lead name. Strictly better for
 * the same information.
 *
 * `null` when there is no usable name at all — the caller turns that into a 422
 * rather than inventing a placeholder that a producer would later read as the
 * prospect's actual name.
 */
export function deriveMailerName(mailer: {
  firstName?: string;
  lastName?: string;
  fullName?: string;
}): MailerName | null {
  const first = mailer.firstName?.trim() ?? '';
  const last = mailer.lastName?.trim() ?? '';
  if (first && last) return { firstName: first, lastName: last };

  const tokens = (mailer.fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return { firstName: tokens[0], lastName: tokens.slice(1).join(' ') };
  }

  const lone = first || last || tokens[0] || '';
  if (lone) return { firstName: '', lastName: lone };

  return null;
}

/**
 * The Mailers drawer's read + log-lead path (PAC-61).
 *
 * PAC-73 owns everything on the way in — the collection, the importers, the
 * normalization. Nothing here writes a mailer; it reads one and hands it to the
 * lead-intake pipeline.
 */
@Injectable()
export class MailersService {
  constructor(
    @InjectModel(Mailer.name)
    private readonly mailerModel: Model<MailerDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    private readonly tenancy: TenantContextResolver,
    private readonly intake: LeadIntakeService,
  ) {}

  /**
   * `GET /mailers/:controlNumber` — the drawer's debounced lookup.
   *
   * Agency-wide with no data-scope clamp on the mailer itself: a mailer has no
   * producer, and the whole point is that any producer can pick up a mail piece
   * and work it. The lead it may already have produced *is* scope-clamped — see
   * {@link resolveExistingLead}.
   */
  async lookup(
    access: AccessContext,
    branchId: string | null,
    rawControlNumber: string,
  ): Promise<MailerLookupView> {
    const { agencyId } = await this.tenancy.resolve(access, branchId);
    const mailer = await this.findByControlNumber(agencyId, rawControlNumber);
    const existing = await this.resolveExistingLead(access, branchId, mailer);
    return this.toLookupView(mailer, existing);
  }

  /**
   * `POST /mailers/log-lead` — save the mailer's recipient as a lead.
   *
   * Everything written comes from the stored mailer or from the authenticated
   * user; the request contributes only which mailer. Legacy resolved the
   * producer through ~170 lines of Clerk lookup with an email fallback and a
   * self-healing `PATCH`, all of which existed because it had no first-class
   * user identity. Here the caller *is* the producer.
   */
  async logLead(
    access: AccessContext,
    branchId: string | null,
    rawControlNumber: string,
  ): Promise<LogMailerLeadResponse> {
    const tenant = await this.tenancy.resolve(access, branchId);
    const mailer = await this.findByControlNumber(
      tenant.agencyId,
      rawControlNumber,
    );

    const name = deriveMailerName(mailer);
    if (!name) {
      throw new UnprocessableEntityException(
        'This mailer has no recipient name and cannot be logged as a lead.',
      );
    }

    const userId = new Types.ObjectId(access.userId);
    const source = normalizeLeadSource(MAILER_LEAD_SOURCE_CODE);
    const ctx: IntakeContext = {
      agencyId: tenant.agencyId,
      branchId: tenant.branchId,
      producerId: userId,
      channel: 'mailer',
      // Always Mailer, set here and never read from the request. Legacy
      // branched to JYA on `Campaign_Number.startsWith('JYA')`; no campaign
      // number in this data can match, so the branch is not ported.
      leadSource: { code: source.code, label: source.label },
      actorUserId: userId,
    };

    const primaryContact: IntakePerson = {
      ...name,
      // All three are absent on the overwhelming majority of real mailers, and
      // `IntakePerson` has them optional for exactly that reason. Passing a
      // blank string instead of omitting would write empty contact details that
      // read as captured answers.
      phone: mailer.phone?.trim() || undefined,
      email: mailer.email?.trim() || undefined,
      dateOfBirth: mailer.dateOfBirth
        ? mailer.dateOfBirth.toISOString().slice(0, 10)
        : undefined,
    };

    const outcome = await this.intake.process(ctx, {
      primaryContact,
      address: mailer.address
        ? {
            street: mailer.address.street,
            city: mailer.address.city,
            state: mailer.address.state,
            // The 5-digit form, not the stored ZIP+4. `buildAddressKey` keys on
            // `street|zip`, so a `74003-5807` here would stop this lead ever
            // deduping against one a producer typed in by hand at the same
            // house — and every other intake path stores five digits.
            zip: mailer.address.zip5 ?? mailer.address.zip,
          }
        : undefined,
      // A mailer names one recipient.
      members: [],
      // `policiesOfInterest` is deliberately omitted. `campaign.policyType`
      // says what *kind* of policy was mailed, but the row carries no item
      // count, and `LeadPolicyOfInterestInput` requires one. Sending
      // `{ policyType: 'Home', itemCount: 1 }` would write a guess into a field
      // a producer later reads as a captured answer.
      quoteControlNumber: this.canonicalControlNumber(mailer),
      // The mailer's own normalized key, NOT what the producer typed: the two
      // printed forms are different strings, so keying on the input would let
      // one mailer be logged twice, once per form.
      submissionToken: mailer.controlNumberKeys[0],
    });

    return {
      leadId: outcome.leadId.toString(),
      alreadyExisted: !outcome.leadIsNew,
    };
  }

  /**
   * One indexed equality against the multikey `{agencyId, controlNumberKeys}`
   * index, whichever form the producer typed.
   *
   * 404 covers all three misses with the same body — no such number, a number
   * that normalizes to nothing, and a mailer belonging to another agency. Which
   * one it was is not the caller's business.
   */
  private async findByControlNumber(
    agencyId: string,
    rawControlNumber: string,
  ): Promise<MailerDocument> {
    const key = mailerControlNumberKey(rawControlNumber);
    const mailer = key
      ? await this.mailerModel.findOne({ agencyId, controlNumberKeys: key })
      : null;

    if (!mailer) {
      throw new NotFoundException('No mailer found for that control number.');
    }
    return mailer;
  }

  /**
   * The long form, which is what a logged lead stores.
   *
   * Two reasons it is not the short form. The Leads list searches
   * `quoteControlNumber` with a contains-regex, and the short form is the last
   * 12 hex characters *inside* the long one — so storing the long form is
   * findable by either, and the reverse is not true. And dedupe signal 2 is an
   * exact-equality **merge** on this field: the short form is 48 bits of a
   * truncated UUID, and a collision would quietly merge two different
   * prospects' leads, which is the one intake failure that cannot be undone.
   */
  private canonicalControlNumber(mailer: MailerDocument): string | undefined {
    return mailer.controlNumber ?? mailer.newControlNumber;
  }

  /**
   * Whether this mailer has already been logged, and by whom.
   *
   * Two questions, deliberately answered separately:
   *
   * - `alreadyLogged` is **agency-wide**. Stopping a producer from working a
   *   mailer a colleague already took is the entire reason the drawer says
   *   anything about it, and `POST /log-lead` reveals the same fact through
   *   `alreadyExisted` anyway.
   * - `linkedLeadId` is **scope-clamped**. `GET /leads/:id` 404s another
   *   producer's lead under `own` scope, so returning an unreachable id would
   *   render a "View lead" button that lands on a not-found page.
   *
   * The scoped query runs first because on the happy path — the caller's own
   * lead — it is the only one that runs.
   *
   * ⚠ Matching is on the raw stored string, so a lead whose control number a
   * producer typed by hand into the New Lead form (stored trimmed but not
   * normalized) will not be found here. Fixing that needs a stored
   * `Lead.quoteControlNumberKey` plus an index and a backfill; it is out of
   * scope for PAC-61 and is a known gap, not an oversight.
   */
  private async resolveExistingLead(
    access: AccessContext,
    branchId: string | null,
    mailer: MailerDocument,
  ): Promise<{ alreadyLogged: boolean; linkedLeadId: string | null }> {
    const forms = [mailer.controlNumber, mailer.newControlNumber].filter(
      (form): form is string => typeof form === 'string' && form.length > 0,
    );
    if (!forms.length) return { alreadyLogged: false, linkedLeadId: null };

    const byControlNumber: FilterQuery<LeadDocument> = {
      quoteControlNumber: { $in: forms },
    };

    const mine = await this.leadModel
      .findOne({
        ...buildScopeFilter<LeadDocument>(access, branchId),
        ...byControlNumber,
      })
      .select('_id')
      .lean();
    if (mine) {
      return { alreadyLogged: true, linkedLeadId: mine._id.toString() };
    }

    const anyone = await this.leadModel
      .exists({ agencyId: access.agencyId, ...byControlNumber })
      .then(Boolean);
    return { alreadyLogged: anyone, linkedLeadId: null };
  }

  /**
   * The projection a producer sees.
   *
   * ⚠ Every omission here is deliberate — see the docblock on
   * `MailerLookupView` in `@sfa/shared` for what is withheld and why. In
   * particular `source.raw` is the entire 132-column source row.
   */
  private toLookupView(
    mailer: MailerDocument,
    existing: { alreadyLogged: boolean; linkedLeadId: string | null },
  ): MailerLookupView {
    const address = mailer.address;
    const coverage = mailer.coverage;
    const premium = mailer.premium;
    const campaign = mailer.campaign;
    const name =
      mailer.fullName?.trim() ||
      [mailer.firstName, mailer.lastName].filter(Boolean).join(' ').trim();

    return {
      controlNumber: mailer.controlNumber ?? null,
      newControlNumber: mailer.newControlNumber ?? null,
      name: name || null,
      firstName: mailer.firstName ?? null,
      lastName: mailer.lastName ?? null,
      address: {
        street: address?.street ?? null,
        city: address?.city ?? null,
        state: address?.state ?? null,
        zip: address?.zip5 ?? address?.zip ?? null,
        // A name or nothing — never the zero-padded FIPS code the source ships,
        // which is what legacy showed producers.
        county: resolveCountyName(address?.state, address?.county) ?? null,
      },
      squareFeet: mailer.squareFeet ?? null,
      yearBuilt: mailer.yearBuilt ?? null,
      coverage: {
        dwelling: coverage?.dwelling ?? null,
        otherStructures: coverage?.otherStructures ?? null,
        lossOfUse: coverage?.lossOfUse ?? null,
        guestMedical: coverage?.guestMedical ?? null,
        familyLiability: coverage?.familyLiability ?? null,
      },
      premium: {
        yearly: premium?.yearly ?? null,
        monthly: premium?.monthly ?? null,
        total: premium?.total ?? null,
      },
      campaign: {
        weekNumber: campaign?.weekNumber ?? null,
        policyType: campaign?.policyType ?? null,
        product: campaign?.product ?? null,
        // Null on every uploaded mailer — the column is BigQuery-only. Nothing
        // is substituted; legacy's hard-coded 'Pending' is the thing being
        // fixed, not a fallback to imitate.
        status: campaign?.campaignStatus ?? null,
      },
      quoteDate: mailer.quoteDate?.toISOString() ?? null,
      email: mailer.email ?? null,
      phone: mailer.phone ?? null,
      dateOfBirth: mailer.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      doNotCall: mailer.doNotCall ?? false,
      doNotMail: mailer.doNotMail ?? false,
      ...existing,
    };
  }
}
