import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { AccessResolverService } from '../permissions/access-resolver.service';
import { RoleAssignmentsService } from '../permissions/role-assignments.service';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';

/**
 * Reconcile every agency's system roles against `DEFAULT_ROLE_TEMPLATES`, then
 * drop the cached authorization contexts so the change takes effect at once.
 *
 * **Why this exists.** `PermissionsService.seedDefaultRoles` already
 * union-upserts a template change onto existing role documents — but nothing
 * calls it for agencies nobody re-seeds:
 *
 * - the core seed (`seed.ts`) creates no agency at all, so it calls it for none;
 * - the migration and the demo seed each call it only for the one tenant they
 *   provision (`smith-family-agency` / `demo-agency`);
 * - `platform.service.ts` only runs it when an agency is **created**.
 *
 * So a new page permission on a template (PAC-38 added `clients:write` to
 * Producer) reaches a freshly-seeded dev database and nowhere else. Every
 * migrated or platform-created agency would 403 until someone noticed.
 *
 * **Why the invalidation is here and not in `seedDefaultRoles`.**
 * `AccessResolverService` injects `PermissionsService`, so calling the resolver
 * from inside the service would close a dependency cycle inside
 * `PermissionsModule` and need `forwardRef`. Keeping the pairing in the script
 * costs one line and no indirection.
 *
 * Idempotent — safe to re-run. Note the merge is a **union**: a template change
 * that *removes* a permission is not propagated, by design, so an agency owner's
 * customizations are never silently reverted.
 *
 * ⚠ Web clients read permissions from the `user` blob in `localStorage`. A
 * producer who is already signed in keeps their old set until the next token
 * refresh or login, however promptly this runs.
 */
async function syncRoleTemplates() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const agencyModel = app.get<Model<AgencyDocument>>(
    getModelToken(Agency.name),
  );
  const roleAssignments = app.get(RoleAssignmentsService);
  const accessResolver = app.get(AccessResolverService);

  const agencies = await agencyModel.find().select('slug name').lean();
  if (!agencies.length) {
    console.log('No agencies found — nothing to sync.');
    await app.close();
    return;
  }

  let synced = 0;
  for (const agency of agencies) {
    const id = agency._id.toString();
    try {
      await roleAssignments.seedDefaultRoles(agency._id);
      // Without this, already-resolved contexts keep the old permission set
      // until the safety TTL expires.
      await accessResolver.invalidateAgency(id);
      synced += 1;
      console.log(`  ✓ ${agency.slug ?? id}`);
    } catch (error: unknown) {
      // Keep going: one broken agency must not block the rest of the estate.
      console.error(
        `  ✗ ${agency.slug ?? id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  console.log(
    `\nRole templates synced for ${synced}/${agencies.length} agenc${
      agencies.length === 1 ? 'y' : 'ies'
    }.`,
  );
  console.log(
    'Signed-in users keep their cached permissions until they log in again.',
  );
  await app.close();
}

syncRoleTemplates().catch((error) => {
  console.error('Role template sync failed:', error);
  process.exit(1);
});
