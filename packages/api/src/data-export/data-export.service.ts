import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type AccessContext,
  DATA_EXPORT_FORMATS,
  DATA_EXPORT_TOO_LARGE,
  type DataExportDatasetKey,
  type DataExportDictionaryResponse,
  type DataExportHistoryRow,
  type DataExportOptionsResponse,
  type DataExportTooLargeError,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { Branch } from '../branches/schemas/branch.schema';
import { Chargeback } from '../chargebacks/schemas/chargeback.schema';
import { filterOptionsFor } from '../common/access/filter-options';
import type { ExportModels } from '../common/data-export/engine/lookups';
import { describeAll, modelFor } from '../common/data-export/engine/registry';
import { countStages, planExport } from '../common/data-export/plan';
import { TenantUrlService } from '../common/tenancy/tenant-url.service';
import { dataExportMaxRows } from '../config/data-export.config';
import { Contact } from '../contacts/schemas/contact.schema';
import { DealAudit } from '../deal-audits/schemas/deal-audit.schema';
import { Deal } from '../deals/schemas/deal.schema';
import { Household } from '../households/schemas/household.schema';
import { HouseholdMember } from '../households/schemas/household-member.schema';
import { dataExportRequested } from '../inngest/events';
import { InngestService } from '../inngest/inngest.service';
import { InterestedParty } from '../interested-parties/schemas/interested-party.schema';
import { LeadSource } from '../lead-sources/schemas/lead-source.schema';
import { Lead } from '../leads/schemas/lead.schema';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import { Agency } from '../platform/schemas/agency.schema';
import { Policy } from '../policies/schemas/policy.schema';
import { QuoteRecap } from '../quote-recaps/schemas/quote-recap.schema';
import { AgencyRole } from '../roles/schemas/agency-role.schema';
import { TenantBrandingService } from '../tenant-branding/tenant-branding.service';
import { User } from '../users/schemas/user.schema';
import { DataExportHistoryService } from './data-export-history.service';
import type { DataExportRequestDto } from './dto/data-export-query.dto';

type AnyModel = Model<any>;

/**
 * The Data Export page's request side (PAC-152): the dictionary, the filter
 * options, and queuing an export.
 *
 * The engine itself — datasets, planner, writers, `runExport` — lives in
 * `common/data-export/` so the worker can run it. This service only plans an
 * export far enough to validate and count it, writes the `queued` row, and
 * sends `data-export/export.requested.v1`; `DataExportGenerateFn` produces the
 * file into object storage and emails the requester, and the page fetches it
 * later through `DataExportHistoryService.fileUrl`.
 */
@Injectable()
export class DataExportService {
  private readonly models: ExportModels;

  constructor(
    @InjectModel(Lead.name) lead: AnyModel,
    @InjectModel(Deal.name) deal: AnyModel,
    @InjectModel(QuoteRecap.name) quoteRecap: AnyModel,
    @InjectModel(Policy.name) policy: AnyModel,
    @InjectModel(Household.name) household: AnyModel,
    @InjectModel(HouseholdMember.name) householdMember: AnyModel,
    @InjectModel(Contact.name) contact: AnyModel,
    @InjectModel(DealAudit.name) dealAudit: AnyModel,
    @InjectModel(InterestedParty.name) interestedParty: AnyModel,
    @InjectModel(Chargeback.name) chargeback: AnyModel,
    @InjectModel(User.name) private readonly userModel: AnyModel,
    @InjectModel(Branch.name) private readonly branchModel: AnyModel,
    @InjectModel(Agency.name) private readonly agencyModel: AnyModel,
    @InjectModel(AgencyRole.name) private readonly roleModel: AnyModel,
    @InjectModel(LeadSource.name) leadSource: AnyModel,
    private readonly inngest: InngestService,
    private readonly tenantBranding: TenantBrandingService,
    private readonly tenantUrls: TenantUrlService,
    private readonly roleAssignments: RoleAssignmentsService,
    private readonly history: DataExportHistoryService,
  ) {
    this.models = {
      lead,
      deal,
      quoteRecap,
      policy,
      household,
      householdMember,
      contact,
      dealAudit,
      interestedParty,
      chargeback,
      user: userModel,
      branch: branchModel,
      leadSource,
    };
  }

  /** The data dictionary: every dataset, its filters and its columns. */
  dictionary(): DataExportDictionaryResponse {
    return {
      datasets: describeAll(),
      formats: [...DATA_EXPORT_FORMATS],
      maxRows: dataExportMaxRows(),
    };
  }

  /**
   * The branches and producers the caller may filter by — shared with the
   * Analytics page through `filterOptionsFor`.
   */
  options(access: AccessContext): Promise<DataExportOptionsResponse> {
    return filterOptionsFor(access, {
      branchModel: this.branchModel,
      userModel: this.userModel,
      roleModel: this.roleModel,
      roleUserIds: (roleId) => this.roleAssignments.roleUserIds(roleId),
    });
  }

  /**
   * Queues one export (PAC-152): plan, count, refuse or record, hand to the
   * worker. Resolves with the queued row; the file comes later.
   *
   * Everything that can be wrong with the request fails here, as an ordinary
   * 400, before anything is queued — the planner validates, and an export over
   * the row cap is refused with its count (and logged as `failed`) rather than
   * accepted and failed minutes later. A request the caller already has live
   * (same dataset, format and filters) is a 409 carrying that export, and is
   * not logged: nothing new was asked for.
   *
   * The event goes through `InngestService.send`, whose outbox row is written
   * before the send: if Inngest is down the send throws (the caller sees a
   * 500), but the sweeper re-emits it, so the row does not stay `queued`.
   *
   * The outbox id is minted here and written on the `queued` row before the
   * send, so the export always points at its job, even when the send throws.
   */
  async request(
    access: AccessContext,
    branchId: string | null,
    key: DataExportDatasetKey,
    body: DataExportRequestDto,
    rerunOf: Types.ObjectId | null = null,
  ): Promise<DataExportHistoryRow> {
    const plan = planExport(access, branchId, key, body);
    const maxRows = dataExportMaxRows();

    await this.history.assertNotDuplicate(access, {
      plan,
      format: body.format,
      requestBranchId: branchId,
    });

    const counted = await modelFor(plan.def, this.models)
      .aggregate<{ n: number }>(countStages(plan))
      .allowDiskUse(true);
    const rowCount = counted[0]?.n ?? 0;

    if (rowCount > maxRows) {
      const refused = await this.history.create(access, {
        plan,
        format: body.format,
        status: 'failed',
        rowCount,
        error: DATA_EXPORT_TOO_LARGE,
        filename: '',
        requestBranchId: branchId,
        eventLogId: null,
        rerunOf,
      });
      // A re-run refused as too large still answers the failed export: hide
      // its Re-run, which could only log the same refusal again.
      if (rerunOf)
        await this.history.markRerun(rerunOf, refused._id.toString());
      const error: DataExportTooLargeError = {
        code: DATA_EXPORT_TOO_LARGE,
        message: `This export has ${rowCount.toLocaleString('en-US')} rows; the limit is ${maxRows.toLocaleString('en-US')}. Narrow the date range or add a filter.`,
        rowCount,
        maxRows,
      };
      throw new BadRequestException(error);
    }

    const agency = await this.agencyModel
      .findById(plan.agencyId, { slug: 1 })
      .lean<{ slug?: string } | null>();
    const filename =
      [
        agency?.slug ?? 'agency',
        key,
        body.from ?? 'all',
        body.to ?? 'all',
      ].join('_') + `.${body.format}`;

    const eventLogId = new Types.ObjectId();
    const row = await this.history.create(access, {
      plan,
      format: body.format,
      status: 'queued',
      rowCount,
      error: null,
      filename,
      requestBranchId: branchId,
      eventLogId: eventLogId.toHexString(),
      rerunOf,
    });

    await this.inngest.send(
      dataExportRequested,
      {
        exportId: row._id.toString(),
        agencyId: plan.agencyId,
        requestedBy: access.userId,
        brand: await this.emailBrand(plan.agencyId),
      },
      { id: eventLogId },
    );

    return this.history.row(access, row.toObject());
  }

  /**
   * Re-runs a failed export: a new request with the same dataset, format and
   * filters, linked to the failed one by `rerunOf`. The failed row stays as it
   * is, as part of the audit trail.
   *
   * It goes through `request` in full rather than resetting the old row. The
   * filters are validated, counted and scoped again under the caller's access
   * **now**, so a re-run never sees more than its requester can today, and
   * the duplicate rule applies to it like any other request.
   *
   * `branchId` is this request's, not the one stored on the failed row. For
   * branch and own scope `BranchGuard` pins it to the user's own branch, so
   * the two differ only if the user has moved branch since, and then the old
   * one is exactly what must not be reused. At agency scope the planner
   * ignores it; the branch filter travels in the stored filters.
   */
  async rerun(
    access: AccessContext,
    branchId: string | null,
    id: string,
  ): Promise<DataExportHistoryRow> {
    const failed = await this.history.rerunnable(access, id);
    const { filters } = failed;
    const row = await this.request(
      access,
      branchId,
      failed.datasetKey as DataExportDatasetKey,
      {
        format: failed.format,
        dateField: filters.dateField,
        from: filters.from ?? undefined,
        to: filters.to ?? undefined,
        branchId: filters.branchId ?? undefined,
        producerIds: filters.producerIds,
        status: filters.status,
        // Stored from a body this DTO already validated.
        policyTypes: filters.policyTypes as DataExportRequestDto['policyTypes'],
        leadSourceIds: filters.leadSourceIds,
      },
      failed._id,
    );
    await this.history.markRerun(failed._id, row.id);
    return row;
  }

  /**
   * The "your export is ready" email's masthead, resolved now because the
   * worker may not import the branding service. The logo URL is made absolute
   * against the agency's own host, the rule `UsersService` follows for the
   * invite: a mail client has no origin to resolve a relative path against.
   */
  private async emailBrand(
    agencyId: string,
  ): Promise<{ name: string; logoUrl: string | null } | undefined> {
    const branding = await this.tenantBranding.forAgency(agencyId);
    if (branding.kind !== 'agency') return undefined;
    const baseUrl = (await this.tenantUrls.baseUrlFor(agencyId)).replace(
      /\/+$/,
      '',
    );
    return {
      name: branding.name,
      logoUrl: branding.logoUrl ? `${baseUrl}${branding.logoUrl}` : null,
    };
  }
}
