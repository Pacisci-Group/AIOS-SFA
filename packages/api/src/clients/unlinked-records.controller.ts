import { Controller, Get, Query } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { listUnlinkedSchema } from './dto/list-unlinked.dto';
import type { ListUnlinkedDto } from './dto/list-unlinked.dto';
import { UnlinkedRecordsService } from './unlinked-records.service';

/**
 * The **Unlinked records** work list on the Clients page (PAC-91 §10).
 *
 * `clients` only — deliberately **not** the `clients:read` OR `crm_service:read`
 * gate the household and policy *record* controllers carry. Those two exist
 * because one record renders inside a CRM ticket's drawer; this is a report
 * about the state of the client book, which belongs to whoever works that book.
 * It is the same call `GET /households` makes for the Clients index.
 *
 * `/clients` rather than `/households` or `/policies`: the resource is the
 * page's backlog, and it spans all three collections. Filing it under any one
 * of them would put "policies with no household" behind a household route.
 */
@Controller('clients')
@RequireModule(ModuleKey.Clients)
@RequirePermissions(modulePermission(ModuleKey.Clients, 'read'))
export class UnlinkedRecordsController {
  constructor(private readonly unlinked: UnlinkedRecordsService) {}

  /**
   * The three counts, for the filter chips.
   *
   * Declared before `unlinked` so the literal segment is matched first — the
   * two routes are distinct paths rather than one overloaded by a `kind`
   * value, because a summary has no page of rows and would have made every
   * field of the paginated envelope optional.
   */
  @Get('unlinked/counts')
  counts(@Access() access: AccessContext) {
    return this.unlinked.counts(access);
  }

  /**
   * One page of one kind — `policies`, `contacts` or `households`.
   *
   * `kind` is required: the three lists carry three different row shapes, so
   * there is no sensible default to fall back to. The response repeats it as a
   * discriminant, so a client narrows the row type from what it received rather
   * than from what it asked for.
   */
  @Get('unlinked')
  list(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(listUnlinkedSchema))
    query: ListUnlinkedDto,
  ) {
    return this.unlinked.list(access, query);
  }
}
