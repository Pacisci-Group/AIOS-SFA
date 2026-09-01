import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { logMailerLeadSchema } from './dto/log-mailer-lead.dto';
import type { LogMailerLeadDto } from './dto/log-mailer-lead.dto';
import { MailersService } from './mailers.service';

/**
 * The Mailers drawer on the Leads page (PAC-61).
 *
 * A producer holding a mail piece types the Quote Control Number printed on it,
 * sees who it went to and what was quoted, and saves it as a lead. Legacy spent
 * three screens on this — a search page, a detail page, and a *Log Lead* button.
 *
 * ## Either printed form resolves, with one indexed equality
 *
 * `controlno` (`#` + a UUID) and `New Control Number` (that UUID's last 12 hex
 * characters) are **different strings** — they differ on every one of the
 * 671,339 legacy rows. Legacy had no way to relate them and fell back to
 * `ENDS_WITH`/`CONTAINS_SUBSTR`, a collection scan on every keystroke. PAC-73
 * stores both normalized in `controlNumberKeys` behind a multikey index, so the
 * lookup here is a single equality against a normalized input.
 *
 * ## Route ordering
 *
 * `@Get(':controlNumber')` matches anything, and Nest resolves in declaration
 * order — so `@Post('log-lead')` is safe (different verb) but **any future
 * static `GET` must be declared above it**. Same hazard `LeadsController`
 * documents around `GET /leads/hot`.
 *
 * ## This replaced the generated stub
 *
 * There was a `createFeatureController('mailers', …)` in
 * `feature-modules/feature.controllers.ts` answering `GET /mailers`. It was
 * deleted in the commit that added this class, because two classes on
 * `@Controller('mailers')` both register and which one answers depends on
 * module import order. Same rule `ContactsController` and
 * `PerformanceController` followed.
 */
@Controller('mailers')
@RequireModule(ModuleKey.Mailers)
@RequirePermissions(modulePermission(ModuleKey.Mailers, 'read'))
export class MailersController {
  constructor(private readonly mailers: MailersService) {}

  /**
   * Look one mailer up by either form of its control number.
   *
   * Not data-scoped: a mailer has no producer, and any producer picking up a
   * mail piece may work it. The lead it may already have produced *is* scoped —
   * see `MailersService.resolveExistingLead`.
   */
  @Get(':controlNumber')
  lookup(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('controlNumber') controlNumber: string,
  ) {
    return this.mailers.lookup(access, branchId, controlNumber);
  }

  /**
   * Save the mailer's recipient as a lead, through the shared intake pipeline.
   *
   * 🔴 **Two permissions, both required, and `mailers:read` must be restated.**
   * `@RequirePermissions` and `@RequireWrite` write the same metadata key and
   * `getAllAndOverride` *replaces* the class-level value rather than merging —
   * so writing `@RequireWrite(ModuleKey.Leads)` here would silently drop the
   * `mailers:read` requirement. Same reason `LeadsController.reassign` spells
   * its pair out.
   *
   * `@RequireModule(Mailers, Leads)` is strictly redundant —
   * `resolvePermissionSet` already filters the effective set to agency-enabled
   * modules, so a disabled `leads` module means no `leads:write` and a 403
   * either way. It is here because `ModuleGuard` answers "Module Disabled"
   * where `PermissionsGuard` answers "Insufficient permissions", and an owner
   * who turned `leads` off deserves the accurate message. It also documents on
   * the route that this writes into another module's collection.
   *
   * **200, not 201.** This resolves-or-creates: logging the same mailer twice
   * returns the first lead with `alreadyExisted: true` and creates nothing, so
   * reporting 201 on a replay would be a lie.
   */
  @Post('log-lead')
  @HttpCode(200)
  @RequireModule(ModuleKey.Mailers, ModuleKey.Leads)
  @RequirePermissions(
    modulePermission(ModuleKey.Mailers, 'read'),
    modulePermission(ModuleKey.Leads, 'write'),
  )
  logLead(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Body(new ZodValidationPipe(logMailerLeadSchema)) body: LogMailerLeadDto,
  ) {
    return this.mailers.logLead(access, branchId, body.controlNumber);
  }
}
