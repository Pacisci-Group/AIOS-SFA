import { Controller, Get, Query } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { getLeaderboardSchema } from './dto/get-leaderboard.dto';
import type { GetLeaderboardDto } from './dto/get-leaderboard.dto';
import { LeaderboardService } from './leaderboard.service';

/**
 * Motivation Hub (PAC-13). Read-only — a leaderboard is a projection of
 * `deals` and `producerGoals`, with nothing editable on it.
 *
 * No `@BranchId()` parameter, unlike every other feature controller here: the
 * board is agency-wide by definition. See `LeaderboardService`'s docblock for
 * why that, and the deliberate absence of a `DataScope` clamp, are the product
 * requirement rather than an omission.
 */
@Controller('leaderboard')
@RequireModule(ModuleKey.Leaderboard)
@RequirePermissions(modulePermission(ModuleKey.Leaderboard, 'read'))
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  get(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(getLeaderboardSchema))
    query: GetLeaderboardDto,
  ) {
    return this.leaderboardService.get(access, query);
  }
}
