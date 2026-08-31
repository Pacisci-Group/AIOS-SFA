# `packages/api` + `packages/shared` — permission & tenancy spine

- **Hierarchy:** `Platform (Super Admin) → Agency (tenant) → Branch → User`.
- **Global guards** (in `app.module.ts`, order load-bearing): `JwtAuthGuard` → `AccessContextGuard` → `TenantGuard` → `BranchGuard` → `ModuleGuard` → `PermissionsGuard`. `AccessContextGuard` resolves the effective permission set from MongoDB into `request.access`; the rest read from there. The JWT carries **no** permissions.
- **Data scopes:** `own` · `branch` · `agency`.
- **Module keys** — the enum in `shared/src/enums/module-key.enum.ts`. Toggled per
  agency by Super Admin; disabled ⇒ hidden nav + API 403.
- **Permissions** (`shared/src/permissions/permission.constants.ts`): `"<module>:<read|write>"` + `platform:*` / `agency:*` — 39 strings, described as rows by `PERMISSION_CATALOG` and seeded into the global `permissions` collection. **Relational RBAC**: `rolePermissions`, `userRoles` and `userPermissions` are join collections, written *only* by `RoleAssignmentsService` — a second writer would bypass cache invalidation and the owner-protection checks. Effective set still resolved by the unchanged pure `resolve-permissions.ts` (role perms + grants − revokes, filtered to agency-enabled modules); only the loader is relational, because the permission *strings* are the contract for 91 guard decorators and the whole web app.
- **Default role templates** (`shared/src/permissions/default-role-templates.ts`):
  Agency Owner (agency) · Branch Manager (branch) · Producer (**own**) · CRM
  (branch) · Data Team (agency).
- **Migration key:** `User`/`TenantRecord` carry `legacySmartSuiteId`. The core seed (`src/seed/seed.ts`) is **platform-required data only** — it creates the **platform super admin** plus an **empty tenant scaffold** (agency "Smith Family Agency" + Main branch + default roles) as the migration target. It creates **no demo login users and no CRM data**; a fully populated agency comes from the demo seed (`src/seed/demo/`).
- **Schemas exist; read path does not.** Mongoose schemas now exist for every domain collection (`src/<domain>/schemas/*.schema.ts`, most extending `src/common/schemas/tenant-record.schema.ts`) and are populated by the SmartSuite→Mongo migration (`src/migration/`). The HTTP **feature controllers are still stubs** (`src/feature-modules/feature.controllers.ts`) returning `{ status: 'ready' }` — add real query services/DTOs there as dashboards get wired.
