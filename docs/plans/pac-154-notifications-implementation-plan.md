# PAC-154 — Notifications: in-app centre + SSE + email channel + web push — implementation plan

Ticket: https://linear.app/paciscigroup/issue/PAC-154 (the ticket's **Decisions**, **Data model**, **API surface** and **Behaviour rules** sections are authoritative; this plan is the execution order and the code-level mapping). Branch `asad/pac-154-notifications-in-app-notification-centre-web-push`, cut from `dev`. Four PRs, each green on `build -w @sfa/shared` → `build -w @sfa/api` → `lint` → unit → e2e → Bruno.

Paths are repo-relative; `api/` = `packages/api/`, `web/` = `packages/web/`, `shared/` = `packages/shared/`.

## Context

Today the only outbound channel is email (`MailService` → Inngest → `src/worker/email/`). There is no `notifications` collection, no read API, no bell, no service worker, no Redis in production. Every upcoming feature ticket (PAC-127 triggers, PAC-148 §H, PAC-105, PAC-116, PAC-106) needs to tell someone something; this ticket builds the system so those only emit one event. The ticket already settled the architecture with Asad on 2026-10-07 (single writer in the worker, Redis pub/sub nudge, fetch-based SSE, no TTL, no module permission, impersonation acts as the user, PAC-153 §1 folded into the push PR).

**Decisions taken in this planning session (Asad, 2026-10-07):**

- **Redis pub/sub stays, and this ticket provisions it.** Exploration found production has *no* Redis (`REDIS_URL` absent from terraform, preflight and `app.env`; `DEPLOYMENT.md` says permissions resolve from Mongo). Asad chose to keep decision 2 rather than switch to a Mongo change stream, so PR2 adds a `managed_redis` terraform module, the secret in every deploy touchpoint, and a shared Redis module. Side effect, accepted: setting `REDIS_URL` in production also switches on the existing Redis permission cache (`permissions/cache/permission-cache.provider.ts`).
- **PR4 includes a minimal "New version available — Reload" toast** wired to `needRefresh`. With `registerType: 'prompt'` and nothing that prompts, a new build only activates once every tab is closed. PAC-153 §3 keeps the install/Lighthouse/double-deploy QA.

**Design points this plan fixes (the ticket left them open or they surfaced in exploration):**

- **Unique `{ recipientId, dedupeKey }` index on `notifications`**, and the insert step tolerates E11000. Inngest's function `idempotency` is 24-hour scoped; the index is the durable "exactly once" guarantee the acceptance criteria ask for. Cron triggers reuse the same key across days (`timeoff.overdue:<id>:day1`) and the index is what makes that safe forever.
- **`LocalNotificationBus` when `REDIS_URL` is unset.** `WORKER_INLINE` defaults to true, so in `npm run api:dev` and every e2e the worker function and the SSE registry share one Nest graph; an in-process `EventEmitter` bus gives live updates locally with no Redis. In production (`NODE_ENV=production`) an unset `REDIS_URL` logs an error at boot (same shape as `mail-transport.provider.ts`) and the preflight refuses the deploy.
- **The SSE stream opens with a `ready` event.** Nest commits SSE headers lazily on the first message; without one a quiet user sits on an uncommitted response that the proxy may hold. `: ping` comments cannot be emitted through Nest's `MessageEvent`, so the heartbeat is a named `ping` event (same effect on idle timeouts).
- **`DELETE /notifications/push-subscriptions` takes `{ endpoint }` in the body**, not a path param: a push endpoint is a long URL with `/` and `%` in it, and nginx's `proxy_pass` with a URI part re-normalises encoded slashes. Documented in Bruno.
- **`VAPID_*` are required in the preflight once PR4 ships** (ticket: a missing key must fail loudly). `REDIS_URL` likewise from PR2. Both come with a deploy-order note below.
- **Web token refresh becomes single-flight** (`api-client.ts`): today two concurrent 401s each POST `/auth/refresh` with the same refresh token and the server rotates both; the SSE reconnect plus a TanStack refetch would race. One in-flight promise shared by every caller.
- **Shared type is `NotificationRecord`, never `Notification`** — the latter is a DOM global in the web app and in `sw.ts`.
- **The worker publishes ids only** (`{ recipientId, notificationId }`); the API node re-reads the row before writing the SSE frame, so push/email/in-app/SSE all render from the one stored row.

## Code layout (from the ticket, with the additions above)

| Where | What |
| --- | --- |
| `shared/src/notifications/` | `catalog.ts` (`NOTIFICATION_TYPES`: key, category, default channels), `render.ts` (pure `renderNotification(type, data) → { title, body, href }`), `types.ts` (`NotificationRecord`, `NotificationListResponse { items, nextCursor }`, `UnreadCountResponse`, `PushSubscriptionInput`), `index.ts`; barrel export in `shared/src/index.ts` |
| `api/src/inngest/events/notification.events.ts` | `notificationRequested` = `notification/requested.v1`; PR3 adds `notificationEmailRequested` |
| `api/src/notifications/` | `notifications.module.ts`, `notifications.controller.ts`, `public-notifications.controller.ts` (PR4), `notifications.service.ts`, `push-subscriptions.service.ts` (PR4), `dto/`, `schemas/notification.schema.ts`, `schemas/push-subscription.schema.ts` (PR4), `stream/notification-stream.registry.ts` (PR2) |
| `api/src/common/redis/` | `redis.module.ts`, `redis.provider.ts` (`REDIS_CLIENT`), `notification-bus.ts` (abstract), `redis-notification-bus.ts`, `local-notification-bus.ts` (PR2) |
| `api/src/worker/functions/deliver-notification.fn.ts` | The sole writer; steps `insert` (PR1) → `publish` (PR2) → `email` (PR3) → `push` (PR4) |
| `api/src/worker/functions/send-notification-email.fn.ts` | PR3; one generic template `api/src/worker/email/templates/notification.template.ts` |
| `api/src/worker/push/web-push.service.ts` | PR4; VAPID + `web-push`, 404/410 soft-delete |
| `web/src/lib/notifications-api.ts` | keys + `apiFetch` wrappers |
| `web/src/features/notifications/` | `NotificationsPage.tsx`, `components/NotificationListItem.tsx`, `use-notifications.ts`, `use-notification-stream.ts` (PR2), `NotificationStream.tsx` (PR2), `PushOptIn.tsx` (PR4), `PwaUpdateToast.tsx` (PR4) |
| `web/src/sw.ts`, `web/public/` | PR4 service worker + platform icons |

⚠ `notifications` becomes a `FEATURE_DIRS` entry in `api/eslint.config.mjs`, so nothing under `src/worker/` may live in a directory *named* `notifications` (the boundary regex matches the import path). `deliver-notification.fn.ts` and `src/worker/push/` are safe. The worker may import `../notifications/schemas/*.schema` (negated exception) and must never import the controller or service.

---

## PR1 — Foundation (usable on its own, with polling)

### 1.1 Shared catalog, renderer, types — `shared/src/notifications/`
- `catalog.ts`: `NOTIFICATION_TYPES` as a `const` record keyed by type (`'lead.assigned'`, `'audit.submitted'`, `'bug_report.filed'`, … — start with the types PAC-127's inventory already names; adding one later is a one-line change) → `{ category, defaultChannels: { email: boolean; push: boolean } }`; `NotificationType = keyof typeof NOTIFICATION_TYPES`; `isNotificationType()`.
- `render.ts`: `renderNotification(type, data: Record<string, unknown>): { title; body; href }` — pure, no dates, no DI; `href` must start with `/` (throw otherwise). One `switch` on type reading display strings from `data` (`data` carries ids + display fields only, same rule as `email.events.ts`). Unit spec `render.spec.ts`: every catalog key has a case, every `href` is a path.
- `types.ts`: `NotificationRecord { id, type, title, body, href, entity: { kind, id }, actorId, agencyId, data, readAt: string|null, createdAt: string }`, `NotificationListResponse { items: NotificationRecord[]; nextCursor: string|null }` (first cursor envelope in the repo — deliberately next to the domain like the offset envelopes), `UnreadCountResponse { unread: number }`.
- Export from `shared/src/index.ts`; `npm run build -w @sfa/shared` (e2e/Bruno read `dist`).

### 1.2 Event contract — `api/src/inngest/events/notification.events.ts`
Copy the shape of `email.events.ts` (`eventType('…', { schema })`, spread `eventEnvelope`, no transforms, ISO strings):
```ts
notificationRequested = eventType('notification/requested.v1', { schema: z.object({
  ...eventEnvelope, type: z.enum(NOTIFICATION_TYPE_KEYS), recipientIds: z.array(objectId).min(1),
  agencyId: objectId.nullable(), actorId: objectId.nullable(),
  entity: z.object({ kind: z.string(), id: z.string() }), data: z.record(z.string(), z.unknown()),
  dedupeKey: z.string().min(1),
}) });
```
Docblock: `dedupeKey` must be stable per business fact (`<type>:<entityId>[:<qualifier>]`) — a producer that mints a fresh key on retry double-notifies. Add to `events/index.ts`.

### 1.3 Schema — `api/src/notifications/schemas/notification.schema.ts`
Does **not** extend `TenantRecord` (Super Admin recipients; pattern: `bug-reports/schemas/bug-report.schema.ts`, `event-log.schema.ts`). `@Schema({ timestamps: true, collection: 'notifications' })`. Fields per the ticket's table: `recipientId` (`ObjectIdType`, ref `User`, required), `agencyId` (`ObjectIdType`, `default: null`), `type` (`type: String`), `title`, `body`, `href`, `entity { kind, id }` (sub-schema `_id: false`), `actorId` (`ObjectIdType`, `default: null`), `data` (`type: Object`), `readAt` (`type: Date, default: null` — **explicit null so `readAt: null` queries and the covered index see every row**), `delivery` (sub-schema: `push?: { status, at, error }`, `email?: { status, at, emailMessageId }`, every nullable string `type: String`), `dedupeKey`.
Indexes, each with a docblock naming the query it serves:
- `{ recipientId: 1, readAt: 1, createdAt: -1, _id: -1 }` — unread list + `countDocuments({ recipientId, readAt: null })`.
- `{ recipientId: 1, createdAt: -1, _id: -1 }` — All tab.
- `{ recipientId: 1, dedupeKey: 1 }` **unique** — the durable exactly-once guard (see Context).
No TTL (decision 7). No migrate-mongo migration: brand-new collection + indexes are `autoIndex`'s job (`api/migrations/README.md`). Do **not** add to `WorkerIndexesService.syncIndexes()` — the API owns this collection.

### 1.4 API module — `api/src/notifications/`
Pattern: `bug-reports/` (permission-less authenticated writes, zod v4 DTOs through `ZodValidationPipe`, `@Access() access: AccessContext`).
- `notifications.controller.ts`: `@Controller('notifications') @SkipTenant() @SkipBranch() @SkipModule()`, no `@RequirePermissions` anywhere (decision 8). Routes: `GET /` (`cursor?`, `unread?=1`, `limit` 1–50 default 20), `GET /unread-count`, `PATCH /:id/read`, `POST /read-all`. All scoped to `access.userId` — impersonation needs no code (decision 6; `AccessContextGuard` resolves the target's context).
- `dto/notifications.dto.ts`: `listNotificationsSchema` (zod; malformed cursor → 400).
- `notifications.service.ts`:
  - `list(userId, { cursor, unread, limit })`: sort `{ createdAt: -1, _id: -1 }`; cursor = base64url(`${createdAt.toISOString()}|${_id}`); filter `{ recipientId, ...(unread ? { readAt: null } : {}), ...(cursor ? { $or: [{ createdAt: { $lt: c } }, { createdAt: c, _id: { $lt: id } }] } : {}) }`; `limit + 1` to compute `nextCursor`; `.lean()`; map to `NotificationRecord`.
  - `unreadCount(userId)`: `countDocuments({ recipientId, readAt: null })`.
  - `markRead(userId, id)`: `updateOne({ _id, recipientId, readAt: null }, { $set: { readAt: now } })`; 404 only when no row matches `{ _id, recipientId }` (already-read is a 200 no-op).
  - `markAllRead(userId)`: `updateMany({ recipientId, readAt: null }, …)` → `{ updated }`.
  - `findForStream(id, userId)` (used by PR2).
- `notifications.module.ts`: `MongooseModule.forFeature([Notification])`, exports the service; add to `app.module.ts` imports with the usual position comment.
- `api/eslint.config.mjs`: add `'notifications'` to `FEATURE_DIRS`.
- Rate limits: list/count sit under the default throttler; nothing special in PR1.

### 1.5 Worker writer — `api/src/worker/functions/deliver-notification.fn.ts`
Pattern: `send-invite-email.fn.ts` (`@Injectable() @InngestFunction()`, `build()` → `createFunction({ id: 'deliver-notification', name, triggers: [notificationRequested], idempotency: 'event.data.dedupeKey', retries: 3, concurrency: { limit: 10 } }, ({ event, step }) => this.handle(event, step))`, public `handle(event, step: StepLike)` for tests).
- Step `insert`: `renderNotification(type, data)` once; build one doc per `recipientId`; `notificationModel.insertMany(docs, { ordered: false })`; catch the bulk-write error and ignore code 11000 (re-run after a partial insert); then re-query `{ recipientId: { $in }, dedupeKey }` and return `{ ids: string[] }` — **plain JSON only**, step results are serialised (`Jsonify`).
- Register in `worker.module.ts` `providers` and add `Notification` to its `forFeature` list. `WorkerRootModule` does not register `authorshipPlugin`; irrelevant here (no `createdBy`).
- Worker e2e `api/test/worker/deliver-notification.e2e-spec.ts` (copy `send-invite-email.e2e-spec.ts`: `[ConfigModule, MongooseModule.forRootAsync, InngestModule, WorkerModule]`, `fn.handle(event, inlineStep())`): two recipients → two rows with rendered fields and `readAt: null`; run twice → still two rows; a second event with the same `dedupeKey` for one of them → no new row.

### 1.6 First real producer
PR1 must ship one visible notification, not a dev-only emitter. Wire **bug report filed → every platform admin** (`bug-reports.service.ts` after the insert: `this.inngest.send(notificationRequested, { type: 'bug_report.filed', recipientIds: <active isPlatformAdmin user ids>, agencyId: null, actorId, entity: { kind: 'bugReport', id }, data: { title, severity, reporterName }, dedupeKey: 'bug_report.filed:' + id })`). Emit failure never fails the domain write (the outbox sweep replays). PAC-127 lists it as "queue exists, nothing is sent yet", so this is scope that ticket would otherwise carry; note it there.

### 1.7 API e2e + Bruno
- `api/test/notifications.e2e-spec.ts`: `createTestApp()` stubs `InngestService`, so **seed rows straight through the model** (`app.get(getModelToken(Notification.name))`). Cases: list order + cursor walk with no overlap and an empty last page; `unread=1`; `unread-count`; mark read (200 then 200 no-op; another user's id → 404); read-all; impersonated token (`POST /auth/impersonate/:userId`, precedent `test/api.e2e-spec.ts` "Impersonation (PAC-70)") sees and marks the **target's** rows; malformed cursor → 400.
- `bruno/Notifications/` — `List Notifications`, `List Unread`, `Unread Count`, `Mark Read`, `Mark All Read` (+ a `Create Bug Report` chained before them so the run has a row). Docs block: no module, no permission, scoped to the caller, cursor semantics. Update `bruno/README.md` table + `collection.bru` folder list.

### 1.8 Web
- `web/src/lib/notifications-api.ts`: `notificationsKey = ['notifications'] as const`, `listNotifications({ cursor, unread, limit })`, `getUnreadCount()`, `markNotificationRead(id)`, `markAllNotificationsRead()`; types from `@sfa/shared`.
- `web/src/features/notifications/use-notifications.ts`: `useNotificationsList(unread)` = **first `useInfiniteQuery` in the app** (`queryKey: [...notificationsKey, 'list', { unread }]`, `initialPageParam: null`, `getNextPageParam: p => p.nextCursor ?? undefined`); `useUnreadCount()` (`[...notificationsKey, 'unread-count']`, `refetchInterval: 60_000`, `refetchIntervalInBackground: false` — the PR1 polling that PR2 demotes to a fallback); `useMarkRead` / `useMarkAllRead` mutations → `invalidateQueries({ queryKey: notificationsKey })` (never decrement client-side, per the ticket).
- `NotificationsPage.tsx` (lazy, `<Route path="/notifications">` directly under `ProtectedRoute` like `/settings/profile` — no `RequirePermission`): page header via the `SettingsPage`-style header with `<MobileNav/>`, `Tabs variant="line"` Unread / All held in the URL with `useUrlState` (`?tab=unread`), list of `NotificationListItem` (title, body, `relativeTime(createdAt)` from `lib/relative-time.ts`, unread dot), **click = mark read + `navigate(href)`**, "Mark all read" button, "Load more" button, skeletons, an empty-state sentence (not N/A). Tokens only (`packages/web/CLAUDE.md`), light + dark parity.
- Sidebar: `nav-items.ts` adds `{ to: '/notifications', label: 'Notifications', icon: Bell }` to the Workspace section with **no gate**; `SidebarBody.tsx` `SidebarNavItem` gains `badge?: number` → `<Badge size="sm">` after the label when expanded, a dot on the icon (`relative` wrapper) when collapsed; the count comes from `useUnreadCount()` inside `SidebarBody` (single badge site; `MobileNav` inherits it). Respect the file's documented `RailTooltip` string-`className` rule.
- `DevNavPage.tsx` entry (optional, matches house habit).

### 1.9 Verify PR1
`build -w @sfa/shared` · `build -w @sfa/api` + `tsc -p packages/api/tsconfig.json` · `lint -w @sfa/api` (eslint only; compare against its pre-existing baseline) · `lint -w @sfa/web` · unit (shared `render.spec`) · e2e `notifications` + `worker/deliver-notification` (sandbox off, `sfa_test`, no live `api:dev`) · Bruno `Notifications` folder against a seeded `sfa_bruno`. Browser: file a bug report as a platform admin on `localhost:5173`, see the badge within the poll interval and the row on `/notifications`, click → marked read + navigates; check both themes and 375px.

---

## PR2 — Live (Redis pub/sub, SSE, client stream, infra)

### 2.1 Shared Redis module — `api/src/common/redis/`
`common/` is the tier the worker may import. Pattern for the client: `permissions/cache/permission-cache.provider.ts` (`new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 })`, masked-URL log). Leave the permission cache's private client alone (sharing it is a follow-up).
- `redis.provider.ts`: `REDIS_CLIENT` token → `Redis | null` (`null` when `REDIS_URL` unset; `error` log when unset and `NODE_ENV=production`); `onModuleDestroy` → `quit().catch(() => disconnect())`.
- `notification-bus.ts`: `abstract class NotificationBus { publish(n: NotificationNudge): Promise<void>; subscribe(h: (n) => void): () => void }`, `NotificationNudge = { recipientId: string; notificationId: string }`.
- `redis-notification-bus.ts`: PUBLISH on `REDIS_CLIENT`; the subscriber is `client.duplicate()` created lazily on the first `subscribe()` (an ioredis connection in subscriber mode cannot issue commands; `duplicate()` auto-resubscribes after reconnect). One channel `sfa:notify:v1`, JSON body, filter by `recipientId` downstream. Pub/sub errors are logged and swallowed — lossy by contract (decision 2).
- `local-notification-bus.ts`: in-process `EventEmitter`.
- `redis.module.ts` (not `@Global()` — the worker root does not see AppModule's globals): provides `REDIS_CLIENT` + `NotificationBus` (factory picks Redis vs Local), exports both. Imported by `NotificationsModule` and `WorkerModule`. Only the API side ever calls `subscribe()`, so the worker never opens a subscriber connection.

### 2.2 Stream registry + SSE endpoint
- `api/src/notifications/stream/notification-stream.registry.ts` (`@Injectable()`, `OnModuleInit`/`OnModuleDestroy`): `Map<userId, Set<Subject<NotificationNudge>>>`; `open(userId): Observable<NotificationNudge>` adds a Subject and `finalize()`s it out (deleting an empty Set); `onModuleInit` → `bus.subscribe(n => map.get(n.recipientId)?.forEach(s => s.next(n)))`. Unit spec with `LocalNotificationBus` (open/close bookkeeping, routing by recipient, no leak after finalize).
- Controller: `@Sse('stream') @SkipThrottle() @Header('Cache-Control', 'no-cache') @Header('X-Accel-Buffering', 'no')` on the same `notifications` controller (precedent for `@SkipThrottle`: `tls/acme-challenge.controller.ts`). All the usual guards stay on — they run once at connect; `tokenVersion` is not rechecked mid-stream, bounded by `exp` (≤ 15 min), documented in the docblock. Inject `@Access()` for `userId` and `@CurrentUser()` for `exp` — add `exp?: number` to the shared `JwtPayload` (it is present at runtime; `iat` is already declared the same way).
  ```ts
  const untilExp = Math.max(0, exp * 1000 - Date.now() - 1_000);
  return merge(
    of({ type: 'ready', data: '', retry: 3_000 }),                       // commits headers now
    interval(25_000).pipe(map(() => ({ type: 'ping', data: '' }))),       // the heartbeat the LB needs
    this.registry.open(userId).pipe(
      mergeMap(n => from(this.service.findForStream(n.notificationId, userId))),
      filter(Boolean),
      map(doc => ({ type: 'notification', id: doc.id, data: doc })),
    ),
  ).pipe(takeUntil(timer(untilExp)));                                   // completes → Nest ends the response
  ```
  NestJS 11 unsubscribes on `request.socket` close (which fires the registry's `finalize`) and ends the response when the observable completes.
- `main.ts`: add `Last-Event-ID` to CORS `allowedHeaders` (same-origin today; fetch-event-source sends it on reconnect).
- Worker: `deliver-notification.fn.ts` gains step `publish` after `insert`: `bus.publish({ recipientId, notificationId })` per id. A replay only re-nudges; the client invalidates rather than appends, so duplicates are harmless.

### 2.3 Infra and plumbing
- **Terraform**: new `infra/terraform/modules/managed_redis/` copied from `modules/managed_mongo/` (`digitalocean_database_cluster` with `engine = "valkey"` — check what the pinned DO provider accepts; `redis` is being retired — plus the same `digitalocean_database_firewall` with `allowed_tags` for the pool tag and `allowed_droplet_ids`, output `connection_uri` = the private `rediss://` URI, `sensitive`). `stacks/sfa/main.tf`: `module "redis"` beside `module "mongo"` with the same tag/droplet admission; stack + environment `outputs.tf` gain `redis_uri` (mirror `mongodb_uri`). `terraform fmt -check` + `validate`.
- **Deploy** (`.github/workflows/deploy.reusable.yml`): `REDIS_URL: ${{ secrets.REDIS_URL }}` in the preflight `env:` map; appended to the **unconditional** `required=` list with a comment in the RESEND_API_KEY style (unset = SSE fan-out silently single-node); `REDIS_URL=${{ secrets.REDIS_URL }}` in the `app.env` heredoc. `DEPLOYMENT.md` "Environment secrets" table row (`terraform output -raw redis_uri`) + a short "Notifications" subsection (heartbeat is load-bearing against the LB idle timeout; DO Managed Valkey is TLS on a private host — verify from a pool droplet before the first deploy).
- **Local compose**: `docker-compose.yml` `worker` service gets the same `REDIS_URL: ${REDIS_URL:+redis://redis:6379}` line the `api` service has (today it inherits the host-mode `localhost:6379`, which is the container itself). `.env.example` Redis section: note it now also drives SSE fan-out.
- **nginx** (`web/nginx.conf`): `location = /api/v1/notifications/stream { proxy_pass http://api:4000/api/v1/notifications/stream; proxy_http_version 1.1; proxy_set_header Connection ""; proxy_buffering off; proxy_cache off; proxy_read_timeout 1h; + the same Host/X-Forwarded headers }`. `edge.ts` already pipes responses unbuffered.
- `api/test/setup-env.ts`: pin `REDIS_URL=''` so a developer's `.env` cannot make e2e talk to Redis.

### 2.4 Web
- `api-client.ts`: export `getAccessToken()`; make `refreshAccessToken()` **single-flight** (module-level in-flight promise, cleared in `finally`) and export it.
- `use-notification-stream.ts`: `fetchEventSource(\`${API_BASE}/notifications/stream\`, { signal, fetch: (input, init) => fetch(input, { ...init, headers: { ...init?.headers, Authorization: \`Bearer ${getAccessToken()}\` } }) /* fresh token on every retry — `headers` is static */, onopen: async res => { if (res.ok) return; if (res.status === 401) { await refreshAccessToken(); throw new RetriableError(); } throw new FatalError(); }, onmessage: e => { if (e.event === 'notification') { invalidate(notificationsKey); toast(title, { description: body, action: { label: 'View', onClick: () => navigate(href) } }); } }, onclose: () => { throw new RetriableError(); } /* required: the server's `exp` close is otherwise terminal */, onerror: () => 3_000 /* backoff ms; never throw */ })`. Leave `openWhenHidden` at its default (closes when hidden, reopens on visible); on every open, `invalidateQueries(notificationsKey)` — that refetch-on-reconnect is what makes lossy pub/sub acceptable. Effect keyed on `user?.id`; cleanup aborts the controller (covers logout, `adoptSession`, impersonation handoff). Dependency: `@microsoft/fetch-event-source`.
- `NotificationStream.tsx`: mounted beside `ReportBugWidget` in `App.tsx` (inside `BrowserRouter`, so `useNavigate` works for the toast action; `Toaster` is outside the router, so the handler must close over `navigate`). Exposes `connected` through a tiny context so `useUnreadCount` uses `refetchInterval: connected ? false : 60_000` — polling becomes the fallback instead of disappearing.
- Multi-tab: N tabs = N streams + N toasts, accepted for v1 (`BroadcastChannel` later).

### 2.5 Tests + verify PR2
- Registry unit spec; `api/test/notifications-stream.e2e-spec.ts`: `await app.listen(0)`, Node `fetch` with the Bearer header, read `res.body.getReader()` until the `ready` frame, then `app.get(NotificationBus).publish(...)` (or run `DeliverNotificationFn.handle` inline — same graph) and assert a `notification` frame with the stored row; a short-lived token (`JWT_ACCESS_EXPIRES=5s` via override) proves the stream completes at `exp`; abort the controller.
- Acceptance "two API replicas": run `docker compose --profile app up --scale api=2` behind a throwaway nginx upstream, or simply two `api:dev` ports with the same `REDIS_URL`, open the page on both, emit once, both badges move. Document the recipe in the PR.
- Browser: no 401 toast across a token expiry (watch the network pane: stream closes at `exp`, refresh, reconnect); toast on a new row; badge updates without a reload.

---

## PR3 — Email channel

- `notification.events.ts`: `notificationEmailRequested` = `notification/email.requested.v1` `{ ...eventEnvelope, notificationId: objectId, recipientId: objectId, agencyId: objectId.nullable() }`.
- `deliver-notification.fn.ts` step `email`: for every inserted id whose catalog `defaultChannels.email` is on (no user preferences — decision 4), `this.inngest.send(notificationEmailRequested, …)` **inside `step.run`** (precedent: `MailerCampaignCommitFn` emitting from a step; the outbox makes a replay safe).
- `send-notification-email.fn.ts` (pattern `send-invite-email.fn.ts`, `idempotency: 'event.data.notificationId'`, `retries: 4`, `concurrency: { limit: 5 }`): load the row + the `User` (`WorkerModule` already registers `User`); brand via `TenantBrandingService.forAgency(agencyId)` (add it to `WorkerModule` providers — it depends only on the `Agency` model, which the worker registers; it lives in `tenant-branding/`, which is not a `FEATURE_DIRS` entry, so the import passes the boundary) + `TenantUrlService.baseUrlFor(agencyId)` for the absolute `href` and logo (never `APP_BASE_URL`; `agencyId: null` → platform brand); `MailDeliveryService.send('notification', data, 'notification:' + id, agencyId)`; `step.run('record')` → `mail.record(...)` and `updateOne` on `delivery.email = { status: 'sent'|'failed', at, emailMessageId }` (a failed email never touches the in-app row — PAC-148 FR-H4).
- `api/src/worker/email/templates/notification.template.ts`: `Template<NotificationEmailData>` using `layout` + `paragraph` + `button(href)` + `muted`; register in `registry.ts` (`notification` key — stored in `emailMessages.templateKey`, so the name is permanent); fixture in `templates.unit-spec.ts`.
- Tests: `api/test/worker/send-notification-email.e2e-spec.ts` (copy `send-invite-email.e2e-spec.ts` with `CaptureMailTransport`; assert the tenant host in every link, `delivery.email` set, re-run does not re-send); deliver fn e2e gains "emails requested only for types whose default includes email".
- Not in this PR: digests, per-user opt-out, "only if still unread after N minutes". Name them in the PR description.

---

## PR4 — Push + PWA shell (PAC-153 §1)

### 4.1 API
- `schemas/push-subscription.schema.ts` (`collection: 'pushSubscriptions'`): `userId` (`ObjectIdType`, ref `User`), `endpoint`, `keys { p256dh, auth }` (`_id: false`), `userAgent` (`type: String, default: null`), `lastSuccessAt` (`type: Date, default: null`), `deletedAt` (`type: Date, default: null`). Indexes: **unique `{ endpoint: 1 }` with `partialFilterExpression: { deletedAt: { $type: 'null' } }`** — house rule is `$type`, never `sparse`, and Mongo 7 partial filters do not accept `{ deletedAt: null }` equality; this only works because the schema stores an **explicit null** (every writer must go through the model — `create`/`insertMany`/`findOneAndUpdate` with defaults — never a raw `collection.insertOne`); `{ userId: 1, deletedAt: 1 }` for the fan-out read.
- `push-subscriptions.service.ts`: `upsert(userId, { endpoint, keys, userAgent })` → `findOneAndUpdate({ endpoint, deletedAt: null }, { $set: { userId, keys, userAgent }, $setOnInsert: { deletedAt: null } }, { upsert: true })` (a shared device re-subscribing moves the endpoint to the new user); `remove(userId, endpoint)` → `updateOne({ endpoint, userId, deletedAt: null }, { $set: { deletedAt: now } })`.
- Controller: `PUT /notifications/push-subscriptions` (zod body), `DELETE /notifications/push-subscriptions` body `{ endpoint }` (see Context). `public-notifications.controller.ts`: `@Controller('public/notifications') @Public() @Get('vapid-public-key')` → `{ publicKey }`, 404 when unset (precedent `agency-domains` `PublicDomainsController`: a public route gets its own controller). `Last-Event-ID` etc. unchanged.
- Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:`). `.env.example` section with `npx web-push generate-vapid-keys`; deploy preflight `env:` map + **unconditional `required=`** + `app.env` heredoc; `DEPLOYMENT.md` table; `test/setup-env.ts` pins all three to `''`. Bruno: `Register Push Subscription`, `Remove Push Subscription`, `Public/Get VAPID Public Key`.

### 4.2 Worker
- Dependency `web-push` in `api/package.json`. `api/src/worker/push/web-push.service.ts`: `setVapidDetails(subject, pub, priv)` at construction when all three are set, else logs `error` in production and `send()` is a no-op (mirrors `mail-transport.provider.ts`); `sendToUser(userId, payload)` → every `{ userId, deletedAt: null }` subscription → `sendNotification(sub, JSON.stringify({ id, title, body, href, icon, tag: id }), { TTL: 3600, urgency: 'normal', topic: id.slice(-32) })`; on success `$set lastSuccessAt`; on `WebPushError` 404/410 → **soft-delete** (`deletedAt: now`); other errors logged, returned as `{ status: 'failed', error }`. Payload < 4 KB; `icon` = absolute URL of the agency favicon/logo via `TenantBrandingService` + `TenantUrlService.baseUrlFor` (same rule as the email logo), platform icon when `agencyId` is null.
- `deliver-notification.fn.ts` step `push`: for each inserted id whose type defaults include push, `webPush.sendToUser(...)` and `updateOne` `delivery.push = { status, at, error? }`. Best-effort; a push failure never fails the run. Register `PushSubscription` in `WorkerModule.forFeature` and the service in `providers`.
- Worker e2e: fake transport (`overrideProvider` on a small `WebPushTransport` seam around `web-push`, same shape as `MailTransport`): a 410 soft-deletes and the device can re-subscribe (`PUT` succeeds, the partial unique index does not fire).

### 4.3 Web — PWA shell + push opt-in
- Dependencies: `vite-plugin-pwa`, `workbox-precaching`, `workbox-routing`, `workbox-core`. `vite.config.ts`: `VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', registerType: 'prompt', injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] }, manifest: { name: 'AgencyOps', short_name: 'AgencyOps', start_url: '/', scope: '/', display: 'standalone', theme_color, background_color, icons: [192, 512, maskable] }, devOptions: { enabled: false } })` — keep the `/api/v1` proxy, `changeOrigin: false`, `host` and `allowedHosts` exactly as they are (tenant resolution depends on them). `tsconfig`: `sw.ts` needs the `WebWorker` lib — a separate `tsconfig.sw.json` referenced from the main one, or `/// <reference lib="webworker" />` + `declare const self: ServiceWorkerGlobalScope`; `vite-plugin-pwa/client` types for `virtual:pwa-register/react`.
- `web/src/sw.ts`: `cleanupOutdatedCaches(); precacheAndRoute(self.__WB_MANIFEST); registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/auth\/impersonate/] }))` — **no runtime route for `/api/`**: the denylist plus the absence of any caching route is the "network-only" guarantee the acceptance criteria name. `push`: parse JSON → `clients.matchAll({ type: 'window', includeUncontrolled: true })` → if any `focused`, skip (the toast already covered it) → else `showNotification(title, { body, icon, tag, data: { href } })`. `notificationclick`: `close()`, focus the first window client and `client.navigate(href)` (or `postMessage` and let the SPA `navigate`), else `openWindow(href)`. `message` `SKIP_WAITING` → `self.skipWaiting()`.
- `web/public/`: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (platform AgencyOps mark; per-agency icons are PAC-153 §2). `index.html`: `<meta name="theme-color" media="(prefers-color-scheme: light)">` + dark variant, `apple-mobile-web-app-*` metas; leave the existing pre-paint theme/tenant scripts untouched (they read `localStorage`, so a precached shell does not stale them).
- `web/nginx.conf`: `location = /sw.js` and `location = /manifest.webmanifest` → `Cache-Control: no-cache` (same reasoning as `/index.html`).
- `PwaUpdateToast.tsx` (mounted beside `NotificationStream`): `useRegisterSW()` → on `needRefresh` a persistent `toast('New version available', { action: { label: 'Reload', onClick: () => updateServiceWorker(true) } })`. `registerType: 'prompt'`, never silent auto-update.
- `PushOptIn.tsx` on `/settings/profile` (ungated): a `Switch` "Browser notifications"; hidden when `!('PushManager' in window)` or the VAPID endpoint 404s; on enable (user gesture) `Notification.requestPermission()` → `navigator.serviceWorker.ready` → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })` → `PUT`; on disable `subscription.unsubscribe()` + `DELETE`. On `logout` / `adoptSession` best-effort `DELETE` the current subscription before `clearTokens()` — otherwise the next user on that browser receives the previous user's pushes. iOS needs the home-screen-installed PWA (ticket decision 5); the per-agency manifest is PAC-153 §2.
- SW is off in dev (`devOptions.enabled: false`); push is verified against `vite preview` or the nginx container. Say so in the PR.

### 4.4 Verify PR4
e2e for subscribe/remove/410 path; `npm run build -w @sfa/web` emits `sw.js` + `manifest.webmanifest`; `vite preview` → install prompt on desktop Chrome, subscribe, emit a notification with no focused window → OS notification arrives, click opens `href`; with a focused window → suppressed, toast only; DevTools Application → no `/api/v1/*` entry in any cache; deploy twice → the Reload toast appears and lands on the new build. Lighthouse installability (the full PWA QA stays with PAC-153 §3).

---

## Deploy order (both secrets fail the preflight loudly)

1. **PR2**: `terraform apply` the Redis module in the target environment → copy `terraform output -raw redis_uri` into the GitHub Environment secret `REDIS_URL` → merge/deploy. The preflight refuses the deploy until the secret exists, which is the intent.
2. **PR4**: run `npx web-push generate-vapid-keys` once per environment → set the three `VAPID_*` secrets → merge/deploy. Rotating the key invalidates every subscription (devices re-subscribe on their next visit).

## Known traps to carry into implementation

- `createTestApp()` stubs `InngestService`: feature-endpoint e2e never sees notification rows. The worker function is tested directly under `test/worker/`.
- Step results are JSON: never return `ObjectId`/`Date` from `step.run`.
- `default: null` + `$type: 'null'` partial index only sees documents written through the Mongoose model.
- `onclose` must throw `RetriableError`, and the token must be injected through the `fetch` override, or the stream silently dies at the first `exp`.
- The function-sync deploy check only asserts `functionCount > 0`; confirm the new functions appear in the Inngest dashboard (`ssh -L 8288:localhost:8288 deploy@<inngest-ip>`) after the first deploy.
- `lint -w @sfa/api` is eslint only; `build -w @sfa/api` + `tsc -p packages/api/tsconfig.json` catch type errors. Rebuild `@sfa/shared` before e2e, Bruno and API unit tests.
- Every new env var goes to `.env.example`, the preflight `env:` map, `required=`, the `app.env` heredoc, `DEPLOYMENT.md`, and `test/setup-env.ts`.

## Out of scope (per the ticket)

Per-type/per-channel user preferences; per-agency manifest and the PWA QA pass (PAC-153 §2/§3); digests; every trigger other than the single bug-report producer in PR1 (PAC-127 and the feature tickets); `BroadcastChannel` multi-tab dedupe; a soft-delete convention for anything but `pushSubscriptions` (PAC-155).
