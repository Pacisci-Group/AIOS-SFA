import {
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type {
  AccessContext,
  MarkAllNotificationsReadResponse,
  NotificationListResponse,
  NotificationRecord,
  UnreadCountResponse,
} from '@sfa/shared';
import {
  SkipBranch,
  SkipModule,
  SkipTenant,
} from '../common/decorators/access.decorators';
import { Access } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  listNotificationsSchema,
  type ListNotificationsDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * The caller's own notifications (PAC-154).
 *
 * ## The guard stack, and why it is this permissive
 *
 * Authenticated, and nothing more — the same shape as `bug-reports`. No
 * `@RequirePermissions` (a notification is addressed to you, ticket decision
 * 8); `@SkipModule()` because it is not a feature of any module; `@SkipTenant()`
 * and `@SkipBranch()` because a platform admin — who has neither — is a
 * recipient the day a bug report is filed. Identity is `request.access.userId`,
 * resolved from the database on every request; nothing here is client-supplied.
 *
 * Impersonation is deliberately not special-cased: the resolved context *is*
 * the impersonated user's, so an operator sees and marks exactly what they
 * would (ticket decision 6).
 */
@Controller('notifications')
@SkipTenant()
@SkipBranch()
@SkipModule()
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(listNotificationsSchema))
    query: ListNotificationsDto,
  ): Promise<NotificationListResponse> {
    return this.service.list(access.userId, query);
  }

  @Get('unread-count')
  unreadCount(@Access() access: AccessContext): Promise<UnreadCountResponse> {
    return this.service.unreadCount(access.userId);
  }

  @Patch(':id/read')
  markRead(
    @Access() access: AccessContext,
    @Param('id') id: string,
  ): Promise<NotificationRecord> {
    return this.service.markRead(access.userId, id);
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(
    @Access() access: AccessContext,
  ): Promise<MarkAllNotificationsReadResponse> {
    return this.service.markAllRead(access.userId);
  }
}
