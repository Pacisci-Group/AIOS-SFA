import { createHash } from 'crypto';
import type { Readable } from 'stream';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  importRowCounts,
  isChargedResolution,
  MAX_PAYOUT_IMPORT_FILE_BYTES,
  MAX_PAYOUT_IMPORT_ROWS,
  normalizeCarrier,
  PAYOUT_IMPORT_ALREADY_CHARGED,
  PAYOUT_IMPORT_CHARGED_SINCE,
  PAYOUT_IMPORT_DUPLICATE_FILE,
  PAYOUT_IMPORT_NOT_EDITABLE,
  PAYOUT_IMPORT_UNREADABLE_FILE,
  PAYOUT_IMPORT_UNRESOLVED_ROWS,
  policyNumberKey,
  type AccessContext,
  type ChargebackImportCommitResponse,
  type ChargebackImportCommitResult,
  type ChargebackImportPresignResponse,
  type ChargebackImportRowView,
  type ChargebackImportsResponse,
  type ChargebackImportSummary,
  type ChargebackImportView,
  type ImportPeopleResponse,
  type ImportRecalculationOutcome,
  type ImportRowNote,
  type ImportRowPersonView,
  type PayStatementStatus,
  type UpdateImportRowResponse,
} from '@sfa/shared';
import { Types, type ClientSession, type Model } from 'mongoose';
import { businessDateInstant } from '../common/dates/business-dates';
import {
  CSV_CONTENT_TYPE,
  XLSX_CONTENT_TYPE,
} from '../common/mailers/mailer-file-types';
import { isDuplicateKeyError } from '../common/mongo/duplicate-key';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import {
  ChargebackFileError,
  parseChargebackFile,
  type ChargebackFile,
  type ChargebackFileFormat,
} from '../common/payouts/chargeback-file-reader';
import {
  lockChargebackLedger,
  writeImportedChargebacks,
  type ImportedChargebackLine,
} from '../common/payouts/chargeback-writers';
import { peopleModels } from '../common/payouts/generate-run';
import {
  existingChargebacks,
  matchImportRows,
  type ExistingChargeback,
} from '../common/payouts/match-import-rows';
import { currentMonthIn, isMonthAfter } from '../common/payouts/month-window';
import {
  loadPayoutPeople,
  type PayoutPerson,
} from '../common/payouts/payout-people';
import {
  agencyTimeZone,
  regenerateMonth,
} from '../common/payouts/regenerate-month';
import { StorageService } from '../storage/storage.service';
import type {
  CreateChargebackImportDto,
  ImportRowActionDto,
  ListChargebackImportsQueryDto,
  PresignChargebackImportDto,
} from './dto/payouts.dto';
import { PayoutModelsService } from './payout-models.service';
import {
  ChargebackImport,
  type ChargebackImportRow,
} from './schemas/chargeback-import.schema';
import { agencyOf } from './statement-visibility';

/** Mints the upload key and checks it — one constant for both. */
const IMPORT_PURPOSE = 'payout-chargebacks';

/** How many imports the Payouts page lists for a month. */
const LIST_LIMIT = 50;

type LeanImport = ChargebackImport & { _id: Types.ObjectId };

/**
 * Lines whose policies were charged back after the preview was made, found by
 * the commit's own check of the ledger. Thrown inside the transaction (which
 * aborts it), caught outside to mark the lines and answer 409.
 */
class ChargedSinceError extends Error {
  constructor(
    readonly lines: { rowNumber: number; existing: ExistingChargeback }[],
  ) {
    super('Policies charged back since the preview');
  }
}

/**
 * The carrier chargeback report import (PAC-180): upload → preview → resolve
 * → commit (or discard).
 *
 * - **Create** reads the uploaded file (`chargeback-file-reader.ts`), matches
 *   each line (`match-import-rows.ts`) and stores the import as a `preview`.
 *   Nothing reaches the ledger yet. The same bytes are imported once
 *   (`fileSha256`), which a discard releases.
 * - **Resolve**: the owner charges a line to someone, leaves it out, or resets
 *   it to what matching decided. A duplicate cannot be changed: a policy is
 *   charged back once.
 * - **Commit**, in one transaction: refuse while a line needs a person; check
 *   the ledger again (it may have moved since the preview — another report,
 *   or a cancellation in the app) and refuse with the lines now duplicates;
 *   otherwise write one ledger row per charged line and mark the import
 *   committed. Commits in one agency are serialised through
 *   `Agency.chargebackImportsRevision`, so two reports committed at once
 *   cannot both charge a policy. Then — outside the transaction, so a failure
 *   cannot undo the chargebacks — the month is recalculated exactly as the
 *   owner's Recalculate does (`regenerateMonth`): draft and disputed
 *   statements are rewritten, sent and accepted ones are left alone and
 *   listed.
 *
 * Every route is the admin's (`agency:payouts:admin`), reads included: a
 * report spans branches, and a branch manager does not see other branches'
 * pay.
 */
@Injectable()
export class ChargebackImportsService {
  private readonly logger = new Logger(ChargebackImportsService.name);

  constructor(
    @InjectModel(ChargebackImport.name)
    private readonly importModel: Model<ChargebackImport>,
    private readonly payoutModels: PayoutModelsService,
    private readonly storage: StorageService,
    private readonly transactions: TransactionRunner,
  ) {}

  private get models() {
    return this.payoutModels.models;
  }

  presign(
    access: AccessContext,
    dto: PresignChargebackImportDto,
  ): Promise<ChargebackImportPresignResponse> {
    const key = this.storage.buildObjectKey({
      agencyId: agencyOf(access),
      purpose: IMPORT_PURPOSE,
      filename: dto.filename,
    });
    return this.storage.createPresignedUpload(key, contentTypeOf(dto.filename));
  }

  /**
   * Read an uploaded report into a preview. A refused upload is deleted from
   * storage; once the preview is saved it owns the file, and nothing after
   * that deletes it.
   *
   * @throws 400 key not this agency's, upload missing / empty / not the size
   *   declared, a month that has not started; 409 the same file again; 413
   *   too large; 422 not a readable chargeback report.
   */
  async create(
    access: AccessContext,
    dto: CreateChargebackImportDto,
  ): Promise<ChargebackImportView> {
    const agencyId = agencyOf(access);
    this.storage.assertKeyOwnership(dto.storageKey, {
      agencyId,
      purpose: IMPORT_PURPOSE,
    });
    const stat = await this.storage.statObject(dto.storageKey);
    if (!stat) {
      throw new BadRequestException(
        'The uploaded file was not found. Upload it again.',
      );
    }
    let created: LeanImport;
    try {
      if (stat.size === 0) {
        throw new BadRequestException('The uploaded file is empty.');
      }
      if (stat.size !== dto.size) {
        throw new BadRequestException(
          'The uploaded file is not the size that was declared. Upload it again.',
        );
      }
      if (stat.size > MAX_PAYOUT_IMPORT_FILE_BYTES) {
        throw new PayloadTooLargeException('The report is too large.');
      }
      created = await this.readUpload(agencyId, dto);
    } catch (error) {
      await this.storage.deleteObject(dto.storageKey).catch(() => undefined);
      throw error;
    }
    return this.view(agencyId, created);
  }

  /** Read, match and save the preview. Returns the saved import. */
  private async readUpload(
    agencyId: string,
    dto: CreateChargebackImportDto,
  ): Promise<LeanImport> {
    const timeZone = await agencyTimeZone(this.models.agency, agencyId);
    if (isMonthAfter(dto.month, currentMonthIn(timeZone))) {
      throw new BadRequestException(
        'That month has not started yet, so it has no statements to charge.',
      );
    }

    const bytes = await readAll(
      await this.storage.getObjectStream(dto.storageKey),
    );
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await this.refuseDuplicate(agencyId, sha256);

    const format = formatOf(dto.uploadedFilename, bytes);
    const file = parseOrRefuse(bytes, format);
    const rows = await matchImportRows(
      {
        user: this.models.user,
        policy: this.models.policy,
        deal: this.models.deal,
        chargeback: this.models.chargeback,
      },
      { agencyId, timeZone, carrier: dto.carrier, rows: file.rows },
    );

    let created: LeanImport;
    try {
      const doc = await this.importModel.create({
        agencyId,
        carrier: normalizeCarrier(dto.carrier),
        month: dto.month,
        status: 'preview',
        file: {
          storageKey: dto.storageKey,
          filename: dto.uploadedFilename,
          size: dto.size,
          format,
        },
        fileSha256: sha256,
        sheetName: file.sheetName,
        headerRowNumber: file.headerRowNumber,
        columns: file.columns,
        warnings: file.warnings,
        // `oppositeSign` is not stored: the line's note and resolution say it.
        rows: rows.map((row) => ({
          ...row,
          resolution: row.autoResolution,
          userId: row.autoUserId,
          assignedBy: null,
          assignedAt: null,
          chargebackId: null,
        })),
      });
      created = doc.toObject();
    } catch (error) {
      // Two uploads of the same file racing past `refuseDuplicate`.
      if (!isDuplicateKeyError(error)) throw error;
      await this.refuseDuplicate(agencyId, sha256);
      throw error;
    }
    this.logger.log(
      `Chargeback import ${String(created._id)} (${dto.month}): ${rows.length} lines read`,
    );
    return created;
  }

  /** 409 naming the import that already holds these bytes. */
  private async refuseDuplicate(
    agencyId: string,
    sha256: string,
  ): Promise<void> {
    const existing = await this.importModel
      .findOne({ agencyId, fileSha256: sha256 })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId } | null>();
    if (!existing) return;
    throw new ConflictException({
      code: PAYOUT_IMPORT_DUPLICATE_FILE,
      message: 'This exact file has already been imported.',
      importId: String(existing._id),
    });
  }

  async list(
    access: AccessContext,
    query: ListChargebackImportsQueryDto,
  ): Promise<ChargebackImportsResponse> {
    const agencyId = agencyOf(access);
    const docs = await this.importModel
      .find({ agencyId, ...(query.month ? { month: query.month } : {}) })
      .select({
        carrier: 1,
        month: 1,
        status: 1,
        file: 1,
        warnings: 1,
        committedAt: 1,
        discardedAt: 1,
        result: 1,
        createdBy: 1,
        createdAt: 1,
        'rows.resolution': 1,
        'rows.amount': 1,
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(LIST_LIMIT)
      .lean<LeanImport[]>();
    const people = await this.people(
      agencyId,
      docs.map((doc) => doc.createdBy),
    );
    return { imports: docs.map((doc) => summaryOf(doc, people)) };
  }

  /** Everyone a line may be charged to — people who have left included. */
  async peopleOptions(access: AccessContext): Promise<ImportPeopleResponse> {
    const people = await loadPayoutPeople(
      peopleModels(this.models),
      agencyOf(access),
      undefined,
      { includeRemoved: true },
    );
    return {
      people: [...people.values()].map((person) => ({
        id: person.id,
        name: person.name,
        status: person.status,
        branchName: person.branchName,
        allstateBindId: person.allstateBindId,
      })),
    };
  }

  async get(access: AccessContext, id: string): Promise<ChargebackImportView> {
    const agencyId = agencyOf(access);
    return this.view(agencyId, await this.load(agencyId, id));
  }

  private async load(agencyId: string, id: string): Promise<LeanImport> {
    const doc = await this.importModel
      .findOne({ _id: new Types.ObjectId(id), agencyId })
      .lean<LeanImport | null>();
    if (!doc) throw new NotFoundException('Import not found.');
    return doc;
  }

  /** One line of an import, and its status — without reading every line. */
  private async loadLine(
    agencyId: string,
    importId: Types.ObjectId,
    rowNumber: number,
  ): Promise<{
    status: ChargebackImport['status'];
    row: ChargebackImportRow | null;
  }> {
    const doc = await this.importModel
      .findOne(
        { _id: importId, agencyId },
        { status: 1, rows: { $elemMatch: { rowNumber } } },
      )
      .lean<Pick<LeanImport, 'status' | 'rows'> | null>();
    if (!doc) throw new NotFoundException('Import not found.');
    return { status: doc.status, row: doc.rows?.[0] ?? null };
  }

  /**
   * Resolve one line. Only while the import is a preview; the write is
   * conditional on that, so a line cannot change under a commit. Reads and
   * returns the one line and the counts, never the whole import.
   */
  async updateRow(
    access: AccessContext,
    id: string,
    rowNumber: number,
    action: ImportRowActionDto,
  ): Promise<UpdateImportRowResponse> {
    const agencyId = agencyOf(access);
    const importId = new Types.ObjectId(id);
    const { status, row } = await this.loadLine(agencyId, importId, rowNumber);
    if (status !== 'preview') throw notEditable(status);
    if (!row) throw new NotFoundException('That line is not in this import.');
    if (row.resolution === 'duplicate') {
      throw new BadRequestException({
        code: PAYOUT_IMPORT_ALREADY_CHARGED,
        message:
          'This policy has already been charged back, so this line cannot be charged.',
      });
    }

    let set: Partial<ChargebackImportRow>;
    switch (action.action) {
      case 'assign': {
        const userId = new Types.ObjectId(action.userId);
        const exists = await this.models.user.exists({
          _id: userId,
          agencyId: new Types.ObjectId(agencyId),
          isPlatformAdmin: { $ne: true },
        });
        if (!exists) {
          throw new BadRequestException('That person is not in this agency.');
        }
        set = {
          resolution: 'assigned',
          userId,
          assignedBy: new Types.ObjectId(access.userId),
          assignedAt: new Date(),
        };
        break;
      }
      case 'skip':
        set = { resolution: 'skipped' };
        break;
      case 'reset':
        set = {
          resolution: row.autoResolution,
          userId: row.autoUserId,
          assignedBy: null,
          assignedAt: null,
        };
        break;
    }

    const update = Object.fromEntries(
      Object.entries(set).map(([field, value]) => [
        `rows.$[line].${field}`,
        value,
      ]),
    );
    const updated = await this.importModel
      .findOneAndUpdate(
        { _id: importId, agencyId, status: 'preview' },
        { $set: update },
        {
          arrayFilters: [{ 'line.rowNumber': rowNumber }],
          new: true,
          projection: { 'rows.resolution': 1, 'rows.amount': 1 },
        },
      )
      .lean<Pick<LeanImport, 'rows'> | null>();
    if (!updated) {
      throw notEditable((await this.loadLine(agencyId, importId, 0)).status);
    }

    const line = (await this.loadLine(agencyId, importId, rowNumber)).row!;
    const [people, onStructure] = await Promise.all([
      this.people(agencyId, rowPeopleIds([line])),
      line.userId
        ? this.models.paymentStructure.exists({
            agencyId,
            status: 'active',
            memberIds: line.userId,
          })
        : Promise.resolve(null),
    ]);
    const members = new Set(
      onStructure && line.userId ? [String(line.userId)] : [],
    );
    return {
      row: rowView(line, people, members),
      counts: importRowCounts(updated.rows),
    };
  }

  /**
   * Write the charged lines to the ledger, then recalculate the month.
   *
   * @throws 400 `PAYOUT_IMPORT_UNRESOLVED_ROWS` while a line needs a person;
   *   409 `PAYOUT_IMPORT_CHARGED_SINCE` (+ `rowNumbers`) when some lines'
   *   policies were charged back since the preview — they are marked as
   *   duplicates, and a second commit goes through without them; 409
   *   `PAYOUT_IMPORT_NOT_EDITABLE` once committed or discarded.
   */
  async commit(
    access: AccessContext,
    id: string,
  ): Promise<ChargebackImportCommitResponse> {
    const agencyId = agencyOf(access);
    const importId = new Types.ObjectId(id);
    const timeZone = await agencyTimeZone(this.models.agency, agencyId);
    const now = new Date();

    let committed: { month: string; lines: ImportedChargebackLine[] };
    try {
      committed = await this.transactions.run(async (session, created) => {
        await this.lockCommits(agencyId, session);
        const doc = await this.importModel
          .findOne({ _id: importId, agencyId })
          .session(session)
          .lean<LeanImport | null>();
        if (!doc) throw new NotFoundException('Import not found.');
        if (doc.status !== 'preview') throw notEditable(doc.status);
        const unresolved = doc.rows.filter(
          (row) => row.resolution === 'unmatched',
        ).length;
        if (unresolved) {
          throw new BadRequestException({
            code: PAYOUT_IMPORT_UNRESOLVED_ROWS,
            message: `${unresolved === 1 ? '1 line still needs' : `${unresolved} lines still need`} a person. Choose who to charge, or skip ${unresolved === 1 ? 'it' : 'them'}.`,
            unresolved,
          });
        }

        const charged = doc.rows.filter(
          (row) => isChargedResolution(row.resolution) && row.userId,
        );

        // The ledger as it is now, not as the preview saw it.
        const ledger = await existingChargebacks(
          this.models.chargeback,
          agencyId,
          {
            policyIds: charged.flatMap((row) =>
              row.match.policyId ? [row.match.policyId] : [],
            ),
            numberKeys: charged.map((row) => policyNumberKey(row.policyNumber)),
          },
          session,
        );
        const chargedSince = charged.flatMap((row) => {
          const existing = ledger.find(
            row.match.policyId ?? null,
            policyNumberKey(row.policyNumber),
          );
          return existing ? [{ rowNumber: row.rowNumber, existing }] : [];
        });
        if (chargedSince.length) throw new ChargedSinceError(chargedSince);

        const people = await loadPayoutPeople(
          peopleModels(this.models),
          agencyId,
          [...new Set(charged.map((row) => String(row.userId)))],
        );
        const fallbackBranchId = await this.firstBranchId(agencyId);
        const monthStart = businessDateInstant(`${doc.month}-01`, timeZone);

        const chargebackIds = new Map<number, Types.ObjectId>();
        const lines: ImportedChargebackLine[] = charged.map((row) => {
          const person = people.get(String(row.userId));
          if (!person) {
            throw new BadRequestException(
              `Row ${row.rowNumber} is charged to someone who is no longer in this agency. Choose someone else.`,
            );
          }
          const branchId =
            row.match.branchId || person.branchId || fallbackBranchId;
          if (!branchId) {
            throw new BadRequestException('The agency has no branch.');
          }
          const chargebackId = new Types.ObjectId();
          chargebackIds.set(row.rowNumber, chargebackId);
          return {
            chargebackId,
            producerId: new Types.ObjectId(String(row.userId)),
            producerName: person.name,
            branchId,
            policyId: row.match.policyId ?? null,
            policyNumber: row.match.policyNumber || row.policyNumber,
            policyType: row.match.policyType || row.policyType,
            dealId: row.match.dealId ?? null,
            householdId: row.match.householdId ?? null,
            carrier: row.carrier,
            customerName: row.customerName,
            amount: row.amount,
            occurredAt: row.occurredDay
              ? businessDateInstant(row.occurredDay, timeZone)
              : monthStart,
            soldDate: row.match.soldDate ?? null,
          };
        });

        await writeImportedChargebacks(
          this.models.chargeback,
          lines,
          { agencyId, importId, month: doc.month },
          session,
        );
        // Without a replica set there is no transaction: if marking the
        // import fails below, these rows are deleted rather than left charged.
        for (const line of lines) {
          created.track(this.models.chargeback, line.chargebackId);
        }
        const marked = await this.importModel.updateOne(
          { _id: importId, agencyId, status: 'preview' },
          {
            $set: {
              status: 'committed',
              committedAt: now,
              committedBy: new Types.ObjectId(access.userId),
              rows: doc.rows.map((row) => ({
                ...row,
                chargebackId: chargebackIds.get(row.rowNumber) ?? null,
              })),
            },
          },
          session ? { session } : {},
        );
        if (marked.matchedCount === 0) throw notEditable('committed');
        return { month: doc.month, lines };
      });
    } catch (error) {
      if (!(error instanceof ChargedSinceError)) throw error;
      await this.markChargedSince(agencyId, importId, error.lines);
      const rowNumbers = error.lines.map((line) => line.rowNumber);
      throw new ConflictException({
        code: PAYOUT_IMPORT_CHARGED_SINCE,
        message: `${rowNumbers.length === 1 ? 'A policy on this report was' : `${rowNumbers.length} policies on this report were`} charged back since the preview was made (row${rowNumbers.length === 1 ? '' : 's'} ${rowNumbers.join(', ')}). ${rowNumbers.length === 1 ? 'That line is' : 'Those lines are'} now duplicates and will not be charged. Check them, then commit again.`,
        rowNumbers,
      });
    }

    const result = await this.recalculate(access, {
      agencyId,
      month: committed.month,
      timeZone,
      now,
      lines: committed.lines,
    });
    await this.importModel
      .updateOne({ _id: importId, agencyId }, { $set: { result } })
      .catch((error: unknown) =>
        this.logger.error(
          `Chargeback import ${id}: the commit's result could not be saved`,
          error instanceof Error ? error.stack : String(error),
        ),
      );
    this.logger.log(
      `Chargeback import ${id} committed: ${result.written} chargebacks, month ${result.recalculation}`,
    );
    return {
      import: await this.view(agencyId, await this.load(agencyId, id)),
      result,
    };
  }

  /**
   * The first write of every commit transaction: two commits in one agency
   * write-conflict here, and the second retries after the first has committed
   * — and then finds the policies the first charged. The no-replica-set
   * fallback has no transaction, so no such guarantee (see `TransactionRunner`).
   */
  private async lockCommits(
    agencyId: string,
    session: ClientSession | null,
  ): Promise<void> {
    // Shared with a manual chargeback on a statement (PAC-182).
    await lockChargebackLedger(this.models.agency, agencyId, session);
  }

  /** Lines whose policies were charged back since the preview become duplicates. */
  private async markChargedSince(
    agencyId: string,
    importId: Types.ObjectId,
    lines: { rowNumber: number; existing: ExistingChargeback }[],
  ): Promise<void> {
    const set: Record<string, unknown> = {};
    const addToSet: Record<string, unknown> = {};
    const arrayFilters = lines.map((line, index) => {
      const at = `rows.$[l${index}]`;
      set[`${at}.resolution`] = 'duplicate';
      set[`${at}.autoResolution`] = 'duplicate';
      set[`${at}.match.existingChargeback`] = line.existing;
      addToSet[`${at}.notes`] = 'already_charged';
      return { [`l${index}.rowNumber`]: line.rowNumber };
    });
    await this.importModel.updateOne(
      { _id: importId, agencyId, status: 'preview' },
      { $set: set, $addToSet: addToSet },
      { arrayFilters },
    );
  }

  /**
   * Recalculate the month as Recalculate does, when it has been calculated.
   * Never throws: the chargebacks are written, and the outcome says what the
   * owner still has to do.
   */
  private async recalculate(
    access: AccessContext,
    args: {
      agencyId: string;
      month: string;
      timeZone: string;
      now: Date;
      lines: ImportedChargebackLine[];
    },
  ): Promise<ChargebackImportCommitResult> {
    const { agencyId, month, timeZone, now, lines } = args;
    const amount =
      lines.reduce((cents, line) => cents + Math.round(line.amount * 100), 0) /
      100;

    let runId: Types.ObjectId | null = null;
    let recalculation: ImportRecalculationOutcome = 'no_run';
    let recalculated = 0;
    try {
      const run = await this.models.payoutRun
        .findOne({ agencyId, month })
        .select({ _id: 1 })
        .lean<{ _id: Types.ObjectId } | null>();
      if (run) {
        runId = run._id;
        const regenerated = await regenerateMonth(this.models, {
          agencyId,
          month,
          timeZone,
          trigger: 'manual',
          actorId: access.userId,
          now,
        });
        if (regenerated.outcome === 'generated') {
          recalculated = regenerated.result.drafted;
          recalculation = 'recalculated';
        } else {
          recalculation = 'busy';
        }
      }
    } catch (error) {
      this.logger.error(
        `Recalculating ${month} after a chargeback import failed`,
        error instanceof Error ? error.stack : String(error),
      );
      recalculation = 'failed';
    }

    let untouched: ChargebackImportCommitResult['untouched'] = [];
    if (runId) {
      try {
        const chargedIds = [
          ...new Set(lines.map((line) => String(line.producerId))),
        ].map((userId) => new Types.ObjectId(userId));
        const statements = await this.models.payStatement
          .find({
            agencyId,
            runId,
            userId: { $in: chargedIds },
            status: { $in: ['sent', 'accepted'] },
          })
          .select({ userName: 1, status: 1 })
          .sort({ userName: 1 })
          .lean<
            {
              _id: Types.ObjectId;
              userName: string;
              status: PayStatementStatus;
            }[]
          >();
        untouched = statements.map((statement) => ({
          statementId: String(statement._id),
          userName: statement.userName,
          status: statement.status,
        }));
      } catch (error) {
        this.logger.error(
          `Listing the sent statements after a chargeback import failed`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return {
      written: lines.length,
      amount,
      recalculation,
      runId: runId ? String(runId) : null,
      recalculated,
      untouched,
    };
  }

  /** Discard a preview: nothing was written; the file may be uploaded again. */
  async discard(
    access: AccessContext,
    id: string,
  ): Promise<ChargebackImportSummary> {
    const agencyId = agencyOf(access);
    const doc = await this.load(agencyId, id);
    const written = await this.importModel.updateOne(
      { _id: doc._id, agencyId, status: 'preview' },
      {
        $set: {
          status: 'discarded',
          discardedAt: new Date(),
          discardedBy: new Types.ObjectId(access.userId),
          fileSha256: null,
        },
      },
    );
    if (written.matchedCount === 0) {
      throw notEditable((await this.load(agencyId, id)).status);
    }
    await this.storage
      .deleteObject(doc.file.storageKey)
      .catch((error: unknown) =>
        this.logger.warn(
          `Could not delete discarded import file ${doc.file.storageKey}: ${String(error)}`,
        ),
      );
    const fresh = await this.load(agencyId, id);
    return summaryOf(fresh, await this.people(agencyId, [fresh.createdBy]));
  }

  private async view(
    agencyId: string,
    doc: LeanImport,
  ): Promise<ChargebackImportView> {
    const [people, members] = await Promise.all([
      this.people(agencyId, [...rowPeopleIds(doc.rows), doc.createdBy]),
      this.structureMembers(agencyId),
    ]);
    return {
      ...summaryOf(doc, people),
      sheetName: doc.sheetName ?? null,
      headerRowNumber: doc.headerRowNumber,
      columns: (doc.columns ?? []).map(({ field, header }) => ({
        field,
        header,
      })),
      rows: doc.rows.map((row) => rowView(row, people, members)),
    };
  }

  private people(
    agencyId: string,
    ids: readonly (Types.ObjectId | null | undefined)[],
  ): Promise<Map<string, PayoutPerson>> {
    const unique = [...new Set(ids.filter(Boolean).map(String))];
    return loadPayoutPeople(peopleModels(this.models), agencyId, unique);
  }

  /** Everyone on an active payment structure — who gets a statement. */
  private async structureMembers(agencyId: string): Promise<Set<string>> {
    const structures = await this.models.paymentStructure
      .find({ agencyId, status: 'active' })
      .select({ memberIds: 1 })
      .lean<{ memberIds?: Types.ObjectId[] }[]>();
    return new Set(
      structures.flatMap((structure) =>
        (structure.memberIds ?? []).map(String),
      ),
    );
  }

  /** A ledger row's branch when neither the policy nor the person has one. */
  private async firstBranchId(agencyId: string): Promise<string | null> {
    const branch = await this.models.branch
      .findOne({ agencyId: new Types.ObjectId(agencyId) })
      .sort({ createdAt: 1, _id: 1 })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId } | null>();
    return branch ? String(branch._id) : null;
  }
}

function notEditable(status: string): ConflictException {
  return new ConflictException({
    code: PAYOUT_IMPORT_NOT_EDITABLE,
    message:
      status === 'committed'
        ? 'This import has been committed and can no longer change.'
        : 'This import was discarded.',
  });
}

function contentTypeOf(filename: string): string {
  return /\.csv$/i.test(filename.trim()) ? CSV_CONTENT_TYPE : XLSX_CONTENT_TYPE;
}

/**
 * An .xlsx is a zip; anything else named .xlsx is refused rather than guessed
 * at. A .csv is read as text.
 */
function formatOf(filename: string, bytes: Buffer): ChargebackFileFormat {
  if (bytes.subarray(0, 4).toString('hex') === '504b0304') return 'xlsx';
  if (/\.csv$/i.test(filename.trim())) return 'csv';
  throw new UnprocessableEntityException({
    code: PAYOUT_IMPORT_UNREADABLE_FILE,
    reason: 'unreadable',
    message:
      'The file is not a spreadsheet. Upload the report as .xlsx or .csv.',
  });
}

/** Parse, turning anything unreadable into a 422 the page can show. */
function parseOrRefuse(
  bytes: Buffer,
  format: ChargebackFileFormat,
): ChargebackFile {
  try {
    return parseChargebackFile(bytes, {
      format,
      maxRows: MAX_PAYOUT_IMPORT_ROWS,
    });
  } catch (error) {
    if (error instanceof ChargebackFileError) {
      throw new UnprocessableEntityException({
        code: PAYOUT_IMPORT_UNREADABLE_FILE,
        reason: error.reason,
        message: error.message,
      });
    }
    throw new UnprocessableEntityException({
      code: PAYOUT_IMPORT_UNREADABLE_FILE,
      reason: 'unreadable',
      message: 'The file could not be read as a chargeback report.',
    });
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_PAYOUT_IMPORT_FILE_BYTES) {
      throw new PayloadTooLargeException('The report is too large.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Every person a line's view names. */
function rowPeopleIds(
  rows: readonly Pick<ChargebackImportRow, 'userId' | 'match'>[],
): Types.ObjectId[] {
  return rows.flatMap((row) => [
    ...(row.userId ? [row.userId] : []),
    ...(row.match?.candidates ?? []).map((candidate) => candidate.userId),
  ]);
}

function personRef(
  people: Map<string, PayoutPerson>,
  userId: Types.ObjectId,
): ImportRowPersonView {
  const person = people.get(String(userId));
  return {
    userId: String(userId),
    name: person?.name ?? 'Unknown person',
    status: person?.status ?? 'deactivated',
  };
}

function rowView(
  row: ChargebackImportRow,
  people: Map<string, PayoutPerson>,
  members: Set<string>,
): ChargebackImportRowView {
  const notes: ImportRowNote[] = [...(row.notes ?? [])];
  if (
    row.userId &&
    isChargedResolution(row.resolution) &&
    !members.has(String(row.userId))
  ) {
    notes.push('no_structure');
  }
  const match = row.match;
  const existing = match?.existingChargeback ?? null;
  return {
    rowNumber: row.rowNumber,
    bindId: row.bindId ?? null,
    producerName: row.producerName ?? null,
    policyNumber: row.policyNumber ?? null,
    customerName: row.customerName ?? null,
    policyType: row.policyType ?? null,
    carrier: row.carrier,
    soldDay: row.soldDay ?? null,
    occurredDay: row.occurredDay ?? null,
    terminationReason: row.terminationReason ?? null,
    amount: row.amount,
    policy: match?.policyId
      ? {
          id: String(match.policyId),
          policyNumber: match.policyNumber ?? row.policyNumber,
          policyType: match.policyType ?? null,
          householdId: match.householdId ? String(match.householdId) : null,
        }
      : null,
    candidates: (match?.candidates ?? []).map((candidate) => ({
      ...personRef(people, candidate.userId),
      via: candidate.via,
    })),
    chargedTo: row.userId ? personRef(people, row.userId) : null,
    autoResolution: row.autoResolution,
    resolution: row.resolution,
    notes,
    existingChargeback: existing
      ? {
          id: String(existing.id),
          reason: existing.reason,
          source: existing.source,
          amount: existing.amount,
          occurredAt: new Date(existing.occurredAt).toISOString(),
          statementMonth: existing.statementMonth ?? null,
          producerName: existing.producerName ?? '',
        }
      : null,
    repeatOfRow: match?.repeatOfRow ?? null,
    chargebackId: row.chargebackId ? String(row.chargebackId) : null,
  };
}

function summaryOf(
  doc: LeanImport,
  people: Map<string, PayoutPerson>,
): ChargebackImportSummary {
  return {
    id: String(doc._id),
    carrier: doc.carrier,
    month: doc.month,
    status: doc.status,
    filename: doc.file.filename,
    format: doc.file.format ?? 'xlsx',
    counts: importRowCounts(doc.rows ?? []),
    warnings: doc.warnings ?? [],
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
    createdByName: doc.createdBy
      ? (people.get(String(doc.createdBy))?.name ?? null)
      : null,
    committedAt: doc.committedAt ? doc.committedAt.toISOString() : null,
    discardedAt: doc.discardedAt ? doc.discardedAt.toISOString() : null,
    result: doc.result ?? null,
  };
}
