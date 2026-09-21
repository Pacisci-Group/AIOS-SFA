import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  LEAD_SOURCE_DEFAULT_ORDER,
  isLeadSourcePlaceholder,
  leadSourceSlug,
} from '@sfa/shared';
import type {
  LeadSourceListResponse,
  LeadSourceOption,
  LeadSourceRef,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { LeadSource, LeadSourceDocument } from './schemas/lead-source.schema';

/** The scopes an agency reads: the platform rows, plus its own. */
function scopes(agencyId: string | null): (string | null)[] {
  return agencyId ? [null, agencyId] : [null];
}

@Injectable()
export class LeadSourcesService {
  constructor(
    @InjectModel(LeadSource.name)
    private readonly leadSourceModel: Model<LeadSourceDocument>,
  ) {}

  /**
   * The sources this agency can pick from: platform rows unioned with its own,
   * active only. An agency row **shadows** a platform row of the same slug —
   * `CarriersService.list` explains why.
   *
   * Reference data: not branch-scoped, not `DataScope`-scoped.
   */
  async list(agencyId: string | null): Promise<LeadSourceListResponse> {
    const rows = await this.leadSourceModel
      .find({ agencyId: { $in: scopes(agencyId) }, active: true })
      .lean()
      .exec();

    // An agency row always wins over the platform row of the same slug, in
    // whichever order Mongo happened to return them.
    const bySlug = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const held = bySlug.get(row.slug);
      if (held && held.agencyId !== null) continue;
      bySlug.set(row.slug, row);
    }

    // Sorted here, not by Mongo — see `LEAD_SOURCE_DEFAULT_ORDER`. An override
    // inherits nothing from the row it shadows, so it sorts as the agency's own.
    const position = (row: (typeof rows)[number]) =>
      row.displayOrder ?? LEAD_SOURCE_DEFAULT_ORDER;
    const leadSources: LeadSourceOption[] = [...bySlug.values()]
      .sort((a, b) => position(a) - position(b) || a.name.localeCompare(b.name))
      .map((row) => ({
        id: row._id.toString(),
        name: row.name,
        slug: row.slug,
      }));

    return { leadSources };
  }

  /**
   * id → name for everything this agency's records can point at.
   *
   * ⚠ Not {@link list}: deliberately **not** `active`-filtered. This renders
   * history, and a lead sold under a source that was later archived must still
   * say where it came from. The set is a few dozen rows, which is why read paths
   * resolve through this map in memory rather than `$lookup` per document.
   */
  async labelsFor(agencyId: string | null): Promise<Map<string, string>> {
    const rows = await this.leadSourceModel
      .find({ agencyId: { $in: scopes(agencyId) } })
      .select({ name: 1 })
      .lean()
      .exec();
    return new Map(rows.map((row) => [row._id.toString(), row.name]));
  }

  /** Render one reference through {@link labelsFor}'s map. */
  static toRef(
    id: Types.ObjectId | string | null | undefined,
    labels: Map<string, string>,
  ): LeadSourceRef {
    const key = id ? id.toString() : null;
    const label = key ? labels.get(key) : undefined;
    // An id with no row is a dangling reference; render it as unset rather than
    // inventing a label, and keep the id so it is visible in a response.
    return { id: key, label: label ?? '' };
  }

  /**
   * Validate a client-supplied id for a **write**. Active rows this agency can
   * see only — an archived source stays on old records but cannot be picked.
   */
  async assertSelectable(
    agencyId: string,
    id: string,
  ): Promise<Types.ObjectId> {
    if (Types.ObjectId.isValid(id)) {
      const row = await this.leadSourceModel
        .exists({
          _id: id,
          agencyId: { $in: scopes(agencyId) },
          active: true,
        })
        .exec();
      if (row) return row._id;
    }
    throw new BadRequestException('Select a lead source from the list.');
  }

  /**
   * Find a source by its stable key. The agency's own row wins over the platform
   * one, matching {@link list}. `null` when neither exists — the caller decides
   * whether that is fatal.
   */
  async idForSlug(
    agencyId: string | null,
    slug: string,
  ): Promise<Types.ObjectId | null> {
    const rows = await this.leadSourceModel
      .find({ agencyId: { $in: scopes(agencyId) }, slug })
      .select({ agencyId: 1 })
      .lean()
      .exec();
    const own = rows.find((row) => row.agencyId !== null);
    return (own ?? rows[0])?._id ?? null;
  }

  /**
   * Ids whose name matches, for the Leads free-text search. `pattern` is a Mongo
   * condition — what `tokenRegex` builds — not a `RegExp`.
   */
  async idsMatchingName(
    agencyId: string,
    pattern: { $regex: string; $options: string },
  ): Promise<Types.ObjectId[]> {
    const rows = await this.leadSourceModel
      .find({ agencyId: { $in: scopes(agencyId) }, name: pattern })
      .select({ _id: 1 })
      .lean()
      .exec();
    return rows.map((row) => row._id);
  }

  /**
   * Resolve a **name** to a row, creating the agency's own row when no platform
   * or agency row has that slug. For writers that start from a label rather than
   * a pick — the SmartSuite import and the demo seed. Never a request path: a
   * user picks from {@link list}.
   *
   * `null` for the placeholders the import produces (`''`, `Unknown`, `Test`).
   */
  async findOrCreateByName(
    agencyId: string,
    name: string | null | undefined,
  ): Promise<Types.ObjectId | null> {
    if (isLeadSourcePlaceholder(name)) return null;
    const label = (name ?? '').trim();
    const slug = leadSourceSlug(label);

    const existing = await this.idForSlug(agencyId, slug);
    if (existing) return existing;

    const row = await this.leadSourceModel
      .findOneAndUpdate(
        { agencyId, slug },
        { $setOnInsert: { agencyId, slug, name: label, active: true } },
        { upsert: true, new: true },
      )
      .select({ _id: 1 })
      .lean()
      .exec();
    return row?._id ?? null;
  }
}
