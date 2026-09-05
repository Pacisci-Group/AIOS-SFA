import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { appointmentCodeKey } from '@sfa/shared';
import type {
  CarrierAppointmentInput,
  CarrierAppointmentView,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { CarriersService } from '../carriers/carriers.service';
import {
  Agency,
  AgencyDocument,
  CarrierAppointment,
} from '../platform/schemas/agency.schema';

/** A normalized appointment, ready to store. */
type NormalizedAppointment = Omit<CarrierAppointment, 'appointedAt'> & {
  appointedAt?: Date;
};

/**
 * Every rule about carrier appointments lives here (PAC-93).
 *
 * ## Why one service for two callers
 *
 * Appointments are written from both sides of the tenant boundary: a platform
 * operator records them while onboarding a tenant
 * ({@link AgencyProvisioningService}), and the agency edits its own from then on
 * ({@link AgencyCarrierAppointmentsController}). Those are different guards,
 * different routes and different DTOs — but they must not be different *rules*.
 * An agency that could hold two primaries because one path forgot to check
 * would be a bug nobody notices until a mailer campaign routes wrongly.
 *
 * ## What the database can and cannot enforce
 *
 * The unique index on `(carrierAppointments.carrierId, carrierAppointments.codeKey)`
 * stops two *agencies* claiming the same pair. It cannot stop one agency
 * listing the same pair twice — MongoDB's unique constraint applies across
 * separate documents and explicitly permits an array to repeat index-key values
 * within one. It also cannot express "exactly one primary". Both are enforced
 * in {@link normalize}.
 */
@Injectable()
export class AgencyCarrierAppointmentsService {
  constructor(
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    private readonly carriers: CarriersService,
  ) {}

  /**
   * Turn what a client submitted into what gets stored.
   *
   * Four things happen here, in order, and the order matters:
   *
   * 1. **Rows with no code are dropped.** The code is optional at every point
   *    it can be entered — an operator onboarding a tenant may pick the
   *    carriers and leave the codes to the owner. Such a row is not a
   *    half-finished appointment to be stored; it is not an appointment. (It
   *    also could not be stored: a code-less element would index as
   *    `(carrier, null)`, and two agencies awaiting the same carrier's code
   *    would collide.)
   * 2. **`codeKey` is derived**, by the shared helper the mailer pipeline also
   *    uses.
   * 3. **Duplicates within this agency are rejected**, since the index cannot.
   * 4. **Exactly one primary is resolved.**
   */
  normalize(input: CarrierAppointmentInput[]): NormalizedAppointment[] {
    const rows: NormalizedAppointment[] = [];
    const seen = new Map<string, string>();

    for (const row of input) {
      const carrierAgencyCode = (row.carrierAgencyCode ?? '').trim();
      if (!carrierAgencyCode) continue;

      const codeKey = appointmentCodeKey(carrierAgencyCode);
      const pair = `${row.carrierId}:${codeKey}`;
      if (seen.has(pair)) {
        throw new BadRequestException(
          `The code ${carrierAgencyCode} is listed twice for the same carrier.`,
        );
      }
      seen.set(pair, carrierAgencyCode);

      rows.push({
        carrierId: new Types.ObjectId(row.carrierId),
        carrierAgencyCode,
        codeKey,
        // Deactivating never releases the code (see the schema), so `active`
        // is presentation state, not a claim on the pair.
        active: row.active ?? true,
        isPrimary: row.isPrimary ?? false,
      });
    }

    return this.resolvePrimary(rows);
  }

  /**
   * Exactly one primary, and it is active.
   *
   * An inactive primary is a contradiction — the primary appointment is the one
   * the agency mainly writes under — so a flagged-but-inactive row hands the
   * flag to the first active one. If nothing is active there is no meaningful
   * primary and the flag stays where it was put, which keeps the rule total
   * without inventing a state.
   */
  private resolvePrimary(
    rows: NormalizedAppointment[],
  ): NormalizedAppointment[] {
    if (rows.length === 0) return rows;

    const flagged = rows.filter((row) => row.isPrimary);
    if (flagged.length > 1) {
      throw new BadRequestException(
        'Only one carrier appointment can be the primary one.',
      );
    }

    const active = rows.filter((row) => row.active);
    const primary =
      // The flagged row, when it can hold the flag…
      flagged.find((row) => row.active) ??
      // …otherwise the first active one, whether the flag was misplaced onto an
      // inactive row or never set at all…
      active[0] ??
      // …and if nothing is active there is no meaningful primary, so leave the
      // flag where it was put rather than inventing a state.
      flagged[0] ??
      rows[0];

    return rows.map((row) => ({ ...row, isPrimary: row === primary }));
  }

  /**
   * Resolve the carriers being appointed, refusing anything that is not a
   * platform-global row.
   *
   * An agency-scoped custom carrier is not a valid appointment target:
   * appointments are unique across tenants, and a carrier only one agency can
   * see makes "the same carrier" undecidable. Returns the names because every
   * error message below wants one — `"Allstate code A0B9049 …"` is actionable
   * where an ObjectId is not.
   */
  async assertCarriersAreGlobal(
    rows: NormalizedAppointment[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.carrierId.toString()))];
    const names = await this.carriers.globalNamesByIds(ids);

    const unknown = ids.find((id) => !names.has(id));
    if (unknown) {
      throw new BadRequestException(
        `${unknown} is not a carrier this agency can be appointed by.`,
      );
    }
    return names;
  }

  /**
   * Is any of these `(carrier, code)` pairs already held by another agency?
   *
   * Deliberately **not** filtered on `active`: a deactivated appointment still
   * claims its pair, because `active` is not part of the unique key. Releasing
   * a code means deleting the appointment.
   *
   * This is a pre-flight, not the guarantee — the index is. Its value is the
   * error message: it can name the agency holding the code, which E11000
   * cannot.
   */
  async assertCodesFree(
    rows: NormalizedAppointment[],
    exceptAgencyId: string | Types.ObjectId | null,
    carrierNames: Map<string, string>,
  ): Promise<void> {
    for (const row of rows) {
      const filter: Record<string, unknown> = {
        carrierAppointments: {
          $elemMatch: { carrierId: row.carrierId, codeKey: row.codeKey },
        },
      };
      if (exceptAgencyId) filter._id = { $ne: exceptAgencyId };

      const holder = await this.agencyModel
        .findOne(filter)
        .select({ name: 1 })
        .lean();
      if (holder) {
        throw new ConflictException(
          this.takenMessage(row, carrierNames, holder.name),
        );
      }
    }
  }

  /** Replace an agency's whole appointment list. */
  async replaceAll(
    agencyId: string,
    input: CarrierAppointmentInput[],
  ): Promise<CarrierAppointmentView[]> {
    const rows = this.normalize(input);
    const carrierNames = await this.assertCarriersAreGlobal(rows);
    await this.assertCodesFree(rows, agencyId, carrierNames);

    try {
      const updated = await this.agencyModel
        .findByIdAndUpdate(
          agencyId,
          { $set: { carrierAppointments: rows } },
          { new: true },
        )
        .select({ carrierAppointments: 1 })
        .lean();
      if (!updated) throw new NotFoundException('Agency not found.');

      return this.toViews(updated.carrierAppointments ?? [], carrierNames);
    } catch (error) {
      throw this.translateDuplicate(error, rows, carrierNames);
    }
  }

  /** An agency's appointments, with carrier names resolved. */
  async list(agencyId: string): Promise<CarrierAppointmentView[]> {
    const agency = await this.agencyModel
      .findById(agencyId)
      .select({ carrierAppointments: 1 })
      .lean();
    if (!agency) throw new NotFoundException('Agency not found.');

    // `.lean()` applies no defaults, so a pre-PAC-93 agency reads `undefined`.
    const rows = agency.carrierAppointments ?? [];
    const names = await this.carriers.globalNamesByIds(
      rows.map((row) => row.carrierId.toString()),
    );
    return this.toViews(rows, names);
  }

  toViews(
    rows: CarrierAppointment[],
    names: Map<string, string>,
  ): CarrierAppointmentView[] {
    return rows.map((row) => {
      const carrierId = row.carrierId.toString();
      return {
        carrierId,
        // A carrier deleted from the catalog should still render as *something*
        // rather than blanking the row the agency is trying to edit.
        carrierName: names.get(carrierId) ?? 'Unknown carrier',
        carrierAgencyCode: row.carrierAgencyCode,
        isPrimary: row.isPrimary,
        active: row.active,
        appointedAt: row.appointedAt
          ? new Date(row.appointedAt).toISOString()
          : null,
      };
    });
  }

  /**
   * Turn an E11000 into the sentence {@link assertCodesFree} would have
   * produced.
   *
   * The global `MongoDuplicateKeyFilter` already maps E11000 to a 409, but its
   * message names the index fields, which tells an operator nothing. This only
   * fires for the race the pre-flight cannot close, so it cannot name the
   * winning agency — it names the code, which is the part the caller can act
   * on.
   */
  private translateDuplicate(
    error: unknown,
    rows: NormalizedAppointment[],
    carrierNames: Map<string, string>,
  ): unknown {
    const code = (error as { code?: number })?.code;
    if (code !== 11000) return error;

    const first = rows[0];
    return new ConflictException(
      first
        ? this.takenMessage(first, carrierNames, null)
        : 'That carrier agency code already belongs to another agency.',
    );
  }

  private takenMessage(
    row: NormalizedAppointment,
    carrierNames: Map<string, string>,
    holderName: string | null,
  ): string {
    const carrier =
      carrierNames.get(row.carrierId.toString()) ?? 'that carrier';
    const owner = holderName ? `to ${holderName}` : 'to another agency';
    return (
      `${carrier} code ${row.carrierAgencyCode} already belongs ${owner}. ` +
      'A code is released by removing the appointment, not by deactivating it.'
    );
  }
}
