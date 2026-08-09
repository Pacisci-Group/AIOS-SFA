import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { carrierSlug } from '@sfa/shared';
import type { CarrierListResponse, CarrierOption } from '@sfa/shared';
import { Model } from 'mongoose';
import { Carrier, CarrierDocument } from './schemas/carrier.schema';

@Injectable()
export class CarriersService {
  constructor(
    @InjectModel(Carrier.name)
    private readonly carrierModel: Model<CarrierDocument>,
  ) {}

  /**
   * The carriers this agency can pick from: platform globals unioned with the
   * agency's own rows.
   *
   * An agency row **shadows** a global of the same slug, so the future
   * agency-owner CRUD can override a global's pattern or display name rather
   * than being forced to invent a different name to avoid the clash.
   *
   * Not scoped by branch and not scoped by `DataScope` — a carrier list is
   * reference data, identical for everyone in the agency. The only thing gating
   * it is `deal_audits:read`, which is what puts a user in the Sold wizard.
   *
   * A platform super admin has no agency (`null`), and correctly sees exactly
   * the globals: there is no tenant whose additions they would be reading.
   */
  async list(agencyId: string | null): Promise<CarrierListResponse> {
    const rows = await this.carrierModel
      .find({
        agencyId: { $in: agencyId ? [null, agencyId] : [null] },
        active: true,
      })
      .sort({ displayOrder: 1, name: 1 })
      .lean()
      .exec();

    const bySlug = new Map<string, CarrierOption>();
    for (const row of rows) {
      // Globals are visited first only by luck of insertion order, so decide
      // explicitly: an agency row always wins.
      const slug = row.slug || carrierSlug(row.name);
      if (row.agencyId === null && bySlug.has(slug)) continue;
      bySlug.set(slug, {
        id: row._id.toString(),
        name: row.name,
        policyNumberPattern: row.policyNumberPattern ?? null,
        policyNumberHint: row.policyNumberHint ?? null,
      });
    }

    const carriers = [...bySlug.values()];
    // Re-sort: the shadowing pass above is keyed by slug, so an agency override
    // would otherwise sit at whatever position its global held.
    const order = new Map(
      rows.map((row, index) => [row._id.toString(), index]),
    );
    carriers.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    return { carriers };
  }

  /**
   * The same set as {@link list}, keyed by slug, for server-side validation of a
   * submitted carrier name.
   *
   * A name that isn't in the catalog is absent from the map rather than an
   * error — that is the "Other" path, and it correctly carries no pattern.
   */
  async optionsBySlug(
    agencyId: string | null,
  ): Promise<Map<string, CarrierOption>> {
    const { carriers } = await this.list(agencyId);
    return new Map(carriers.map((c) => [carrierSlug(c.name), c]));
  }
}
