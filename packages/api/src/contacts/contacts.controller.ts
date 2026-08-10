import { Body, Controller, Param, Patch } from '@nestjs/common';
import { ModuleKey, modulePermission } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import {
  RequireModule,
  RequirePermissions,
  RequireWrite,
} from '../common/decorators/access.decorators';
import { Access, BranchId } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ContactsService } from './contacts.service';
import { updateContactSchema } from './dto/update-contact.dto';
import type { UpdateContactDto } from './dto/update-contact.dto';

/**
 * Contacts (PAC-38) — replaces the generated `{status:'ready'}` stub that used
 * to sit on this path.
 *
 * Gated on `clients`, not `leads`: a `Contact` is a CRM record shared across
 * every lead and policy in a household, and routing its writes through the
 * leads module would misfile them. PAC-38 accordingly adds `clients:write` to
 * the Producer role template.
 *
 * That grant is what makes `ContactAccessService` load-bearing rather than
 * ceremonial — the module gate alone would give a producer the whole agency's
 * client book, because `Contact` has no `producerId` to clamp on. Ownership is
 * derived from the leads that reach the contact instead.
 *
 * There is deliberately **no `@Get()`**: `GET /leads/:id` already returns the
 * contact, and an unused read route is exactly what the stub was.
 */
@Controller('contacts')
@RequireModule(ModuleKey.Clients)
@RequirePermissions(modulePermission(ModuleKey.Clients, 'read'))
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  /**
   * Edit a contact's identity — the "Edit Primary Contact" modal on the Lead
   * Detail page.
   *
   * Also mirrors name/email/phone onto any lead this contact is primary for, so
   * a correction shows up on the Leads list rather than only on the detail page.
   */
  @Patch(':id')
  @RequireWrite(ModuleKey.Clients)
  update(
    @Access() access: AccessContext,
    @BranchId() branchId: string | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateContactSchema)) body: UpdateContactDto,
  ) {
    return this.contactsService.update(access, branchId, id, body);
  }
}
