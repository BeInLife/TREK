# Server modernization roadmap

Written 2026-07-28, after the budgetService migration and the domain-coherence audit.
Companion docs: `migrate.md` (service wave list), `migration-graph.md` (dependency-honest
order, regenerated 2026-07-28), `audit_report/domain-coherence-audit.md` (the 73 verified
coherence findings — IDs like `auth-1` below refer to it), `server/src/nest/README.md`
(the per-domain migration recipe), `server/src/nest/plugins/DI-MIGRATION.md` (plugin host,
Option B), `guards-audit.md` (request-pipeline guard audit, 2026-08-01 — authorization
before the Zod pipe; see the "Request-pipeline guards" stream below).

> **Status 2026-08-10 — the migration itself is finished.** Phases 0–5 all landed:
> `src/services/` was deleted (`49652816`) and `server/eslint.config.mjs` now errors
> on any import of it; every wave domain has a Nest module; the body-contract
> allow-list is empty; the guards capstone (default-deny `GlobalAuthGuard` +
> `@Public()` + boot ratchet) shipped. The "deliberately late" plugin RPC decorator
> registry (Option B) and the backupService fold also landed. Still open below:
> guard slices 1/3 and their parked decisions, the last three tokenization
> registries, the operational-hardening items (all but the CI de-flake), and the
> bridge endgame — see the re-checked "Definition of done" at the bottom.

## Sequencing principles (learned from what already worked)

1. **Cross-cutting seams migrate early and cheap** — the permissions + auditLog precedent:
   a small injectable + module-scoped cache + a bridge for legacy callers, swept through
   consumers. Do this for anything imported by "nearly everything" *before* the big domains.
2. **Coherence fixes ride their domain's migration** — the exchangeRate→budget precedent:
   misplaced code moves into its true domain *as part of* that domain's fold (parity first,
   quirk fixes in a trailing `fix(server)` commit), not as a separate big-bang project.
   Only the fixes that reshape the migration graph itself go first.
3. **Parity is law, ratchets stay on** — every migration is byte-identical relocation +
   DTO adoption (the boot gate enforces allow-list shrinkage), verified by the full suite.
4. **Wrap globals behind injectables before replacing them** — the DatabaseService
   precedent: an `@Injectable` facade first (mechanical sweep), transport swap later,
   invisible behind the facade.

---

## Phase 0 — cross-cutting quick wins (before more domain migrations)

- [x] **`getAppUrl()` / `getMcpSafeUrl()` → `src/app-config`** (done 2026-07-28; findings `auth-2`,
  `notifications-1`, `admin-3`, `mcp-1` — four auditors independently). Two functions,
  near-zero risk. Deletes the fake `→ notifications` edges for auth, oidc, webauthn,
  plugin-oauth, maps, transit, the MCP issuer and `index.ts`. Do first: it shrinks the
  notifications cluster before Phase 2 migrates it.
- [x] **Extract addons from adminService** (done 2026-07-28; findings `admin-1`;
  permissions-style: DI `AddonsService` methods + `addons.bridge.ts` for legacy callers —
  the module-scoped cache was deliberately skipped: the legacy reads were uncached per-call
  queries and `updateAddon` (still in adminService) has no invalidation hook, so a cache
  would change admin-toggle visibility; revisit when `updateAddon` moves in Wave 5).
  `isAddonEnabled` was imported by nearly every domain incl. every `.mcp.ts` `when:` gate.
  Removed the biggest fan-in from the Wave-5 admin god-service.
- [x] **Injectable `RealtimeService` over the ws singleton** (done 2026-07-29: `@Global`
  RealtimeModule, call-time delegation so the 106 `vi.mock('src/websocket')` suites keep
  intercepting, arity-preserving pass-through; all 17 `nest/` importers + 9 bridges swept;
  typed against the registry in a follow-up commit) (DatabaseService pattern:
  `@Injectable` wrapping `broadcast`/`broadcastToUser`, module-scoped so bridge instances
  share it). Sweep migrated `nest/` services to inject it instead of
  `import { broadcast } from '../../websocket'`. This is step 1 of the WebSocket goal —
  the actual `@WebSocketGateway` transport swap comes much later, invisibly, behind this
  facade. Do NOT rewrite the ws server itself (auth/rooms/heartbeat/rate-limiting is
  production-grade; audit says extend, don't rewrite). Pair with the **WS event contract
  registry** (see "Tokenization & registries") — the facade is the choke point where the
  typed event signature lands.

## Phase 1 — tripService migration (done 2026-07)

The hub: no blockers left, six bridge consumers die (budget/collab/days/packing/
reservations/vacay bridges become injections). Includes, per the standard recipe:
- MCP: port the trips registrar (+ prompts/resources seams) to `trips.mcp.ts`.
- DTOs: trips controller adopts shared-schema DTOs, allow-list entries removed.
- Coherence fixes to fold in (trailing fix commits): `trip-1` (ICS engine → own module),
  `collections-3` (guest-erasure ownership), `collections-7` (cover-file reclamation
  helper out of the trips god-file), and the registrar drift findings `mcp-5`
  (update_trip hand-wired rebase ordering) die with the MCP port.

## Phase 2 — notifications cluster → notificationService (+ scheduler) (done 2026-08)

Smaller after Phase 0. Unblocks the maps chain and the admin corner.
- Migrate `notifications.ts` + `notificationService` + prefs + inApp + channelRegistry as
  one unit (they are one concept in five files — see notifications section of the audit).
- Migrated domains then replace the lazy `import('...notificationService')` sends with the
  injected service.
- **Scheduler** — **done 2026-08-10**: `src/scheduler.ts` is deleted; every cron is
  a provider in its owning domain, registered through `CronRegistrarService`
  (`src/nest/scheduling/` — `@nestjs/schedule` + a NODE_ENV=test gate so the
  shared `buildApp()` harness never ticks). `notifications.bridge` and
  `admin.bridge` died with it, `SchedulerDeps`/`setSchedulerDeps` too, and
  `node-cron` left `package.json` (the plugin host's job scheduler moved to the
  `cron` package). Reminder enable-gates are per-tick now — a settings change
  takes effect at the next run without a restart.

## Phase 3 — geo chain: maps → transit → place → transitItinerary (done 2026-07/08)

- Fold `placeEnrichment` into places (the helper-fold pattern).
- Pull third-party API-key ownership into the maps/integrations domain: authService's
  `updateMapsKey`/`updateApiKeys`/`validateKeys` probes and the duplicated admin-maps-key
  SQL (`auth-4`) — maps becomes sole owner of key resolution.
- `airportService` can go any time; when it does, move the db-boot backfill (a WRITE into
  `reservation_endpoints` at module-eval time, finding `places-1`) into Nest bootstrap.

## Phase 4 — the Wave-5 corner, restructured by the audit (done 2026-08-09)

Order inside the corner: **atlas → auth-split → admin → oauth** (oidc/passkey ride auth).
- **atlas** first, and it takes `getTravelStats` out of authService with it (the original
  archetype finding) — the `auth → atlas` edge is deleted, not bridged.
- **authService is migrated as a three-way split**, not as one domain (`auth-1`, `auth-3`,
  `auth-4`, `auth-5`):
  - `nest/auth` — credentials, sessions, MFA, tokens, password reset (dependency-clean,
    crown-jewel code: relocate, don't rework);
  - a **users/profile domain** — getCurrentUser/stripUserForClient, avatar (+ multer
    wiring out of the auth controller), settings, user directory, account lifecycle
    (deleteAccount + userCleanup seams);
  - **admin instance settings out of `/api/auth`** — getAppSettings/updateAppSettings
    (SMTP, channels, webhooks, the scheduler restart) belong to nest/admin; route parity
    can keep the URL, ownership moves. `getAppConfig` becomes a platform aggregator
    composing per-domain accessors (`auth-5`).
  - MCP-token CRUD (`mcp-3`) moves toward the MCP domain; invite-token triplication
    (`auth-7`/`admin-10`) gets one owner.
- **admin** (already slimmed by Phase 0 addons + packing-template relocation `admin-2`/
  `collections-1` — templates belong to packing and can move whenever packing-side work
  happens), then **oauth**, merging the diverged `mcp/oauthProvider.ts` half into the one
  OAuth domain (`mcp-2`).

## Phase 5 — remainder (done 2026-08-09/10 — `src/services/` deleted in `49652816`)

- memories/ cluster → journeyService → journeyShareService; collectionsService any time
  (its notificationService edge is lazy; fix `collections-2`'s cross-domain place writes
  during its fold).
- Leaves any time: weatherService, wikiService, airportService (see Phase 3 note).
- backupService last by design (owns the closeDb/reinitialize lifecycle).

## Seam-ownership decisions to make (before the code that touches them)

From the audit's "shared concepts owned in halves" theme — each needs a single-owner
decision, ideally settled when the neighboring migration opens the files anyway:
- [ ] **reservation↔budget link lifecycle** (`budget-1`, `budget-2`, `days-2`): today split
  across budget (`syncReservationPrice` writes reservations), reservations
  (syncBudgetOn* + raw budget_items SQL) and days. Likely owner: reservations orchestrates,
  budget/days expose domain methods.
- [x] **accommodations** (`days-1`): SQL+MCP in days, REST in reservations — pick one home.
  (done 2026-08-10, `3d522be0` "Give accommodations one home instead of two halves" —
  `nest/accommodations/` is the single owner.)
- [ ] **per-domain user erasure** (`collections-4`, `collections-5`): domain-owned erasure
  methods vs the central userCleanupService — pick a convention before the users domain
  exists (Phase 4 forces this).
- [ ] **todo riding packing's addon + permission** (`collections-6`): decide if that's a
  product decision (document it) or an accident (give todo its own addon/permission).

## Tokenization & registries — kill the string contracts

Several security- and sync-critical contracts are typo-prone free strings today, even where
a registry already exists but isn't enforced. The repo already has the right precedents:
`SCOPES` (`mcp/scopes.ts`, `as const` + derived `Scope` type), `ADDON_IDS` (`addons.ts`),
plugin `KNOWN_PERMISSIONS` (`plugins/protocol/envelope.ts`, shared host+child, sdk-mirrored
with parity tests), the notifications `channelRegistry`, and the boot-time fail-closed
ratchet (`validateBodyContracts`). The pattern to replicate: **one `as const` registry, a
derived union type at every call site, and a boot gate that refuses unknown tokens.**
Ordered by value:

- [x] **WS event contract registry in `@trek/shared`** (done 2026-07-29: authoritative
  count is **65 trip + 29 user = 94** events, not 52; `TREK_WS_EVENTS` +
  `TrekWsPayload<E>`; RealtimeService overloads enforce registry keys at compile time
  (`plugin:` namespace is the escape hatch); client switches became enumerable lookups
  with a registry-parity test — 46 handled, 29 handled via dedicated listeners,
  19 explicitly ignored; payload schemas are loose scaffolding, tighten opportunistically;
  8 payload-drift shapes documented as unions in the schema's DRIFT comments) — Today
  **52 distinct event names** are broadcast server-side but only **33 appear** in the
  client's `remoteEventHandler` switch, and the budget migration just proved payload-shape
  drift is real (the MCP `{item}` payloads were silent client no-ops — audit finding, fixed
  2026-07-28). Mechanism: `shared/src/realtime/events.schema.ts` with event-name constants
  + a Zod payload schema per event; server `broadcast()`/`RealtimeService` typed against it
  (event name must be a registry key, payload must satisfy its schema), client handler
  switching exhaustively over the same union (unhandled event = compile-time or test-time
  error, not silence). Do it **with Phase 0's `RealtimeService`** — the facade is the
  natural choke point to introduce the typed signature; migrate events opportunistically.
- [x] **Typed MCP access groups + boot validation** (done 2026-07-28: `ScopeGroup`
  derived from `SCOPES`, `McpAccessGroupRegistry` augmentation types every
  `access.group`, `trekMcpValidateAccess` boot gate refuses unknown group/mode
  combos incl. `write` on read-only `geo`/`weather`; legacy `canRead`/`canWrite`
  now take `ScopeGroup`) — `access: { group: 'vacay', mode:
  'write' }` appears ~100+ times across `.mcp.ts` files as free strings. A typo'd group
  never matches a real scope: scoped tokens get denied (fail closed) but `scopes: null`
  sessions pass (fail open) — silent scope-model drift either way. Mechanism: derive a
  `ScopeGroup` union from `SCOPES` and type the decorator's `access.group` against it via
  the same `declare module '@trek/nest-mcp'` augmentation already used for `McpContext`
  (keeps nest-mcp extraction-clean); plus a **boot gate in the MCP registry**: at discovery
  time, refuse to boot on an `access.group`/tool-name/`when` combination that doesn't
  resolve against `SCOPES` — the body-contract ratchet pattern applied to the MCP surface.
  The registry the user-facing scopes UI reads (`SCOPE_INFO`) then serves decorators, the
  legacy `canRead/canWrite`, and the OAuth consent screen from one source.
- [ ] **Permission-action tokens** — `checkPermission('budget_edit', …)` /
  `hasTripPermission('packing_edit', …)` at 90+ call sites; the actions are already
  defined once as data in `permissions.service.ts` (key + defaultLevel + allowedLevels)
  but nothing types the call sites against that table. Mechanism: export
  `PERMISSION_ACTIONS as const` + `PermissionAction` union from the permissions domain and
  type `checkPermission`/`hasTripPermission`/the bridge against it. Candidate for
  `@trek/shared` if the client's permission store uses the same keys (verify — if yes,
  it's the same single-source rule as the Zod contracts).
- [ ] **Audit-action tokens** — 73 `writeAudit('admin.addon_update' …)`-style call sites
  with dotted free strings; a typo silently mis-files audit rows forever. Low effort:
  `AUDIT_ACTIONS as const` in `nest/audit/`, typed `writeAudit`. Opportunistic — sweep a
  domain's actions whenever a migration touches it.
- [ ] **`app_settings` key registry** — keys are scattered (partial `ADMIN_SETTINGS_KEYS`
  in authService, OIDC rows in adminService, 14 inline reads in `getAppConfig`) with
  ownership split across auth/admin (findings `auth-1`, `auth-5`). Fold the registry into
  the Phase 4 admin-settings relocation: one typed key catalog, per-domain accessors, no
  raw `app_settings` string queries outside the owning module.
- [ ] **Verify, don't rebuild, the good ones** — `ADDON_IDS` (ensure every `when:` gate
  and client addon check derives from it, no re-typed literals), plugin
  `KNOWN_PERMISSIONS`/`HOOK_PERMISSION` (already parity-tested against plugin-sdk — the
  model the others should follow), i18n keys (already typed via `TranslationStrings`).
  Small constants worth a home while passing by: `trek_session` cookie name,
  `X-Socket-Id` / `X-Idempotency-Key` headers.

## Request-pipeline guards — authorization before validation (audited 2026-08-01)

Full audit with call sites, error-string parity landmines, do-not-guard list and
sequencing: **`guards-audit.md`**. The finding in one line: authentication is already a
guard (runs before the global `ZodValidationPipe`), but authorization — trip access 404s,
`checkPermission` 403s, admin/demo/addon gates — is almost entirely inline in
handlers/services, so unauthorized callers with invalid bodies see Zod 400s before
access errors. Same strangler discipline as the DI migration: each conversion is a
wire-behavior change (400↔403/404 ordering), one focused commit per slice, ordering
pinned by tests.

- [ ] **Slice 1 — trivial toggle guards** (mostly open 2026-08-10): `PluginsEnabledGuard`
  (9 duplicated 503 blocks), `DevLinkEnabledGuard`, `McpEnabledGuard` (7 call sites,
  keep 403), the two drop-in `AdminGuard` conversions (guards-audit.md §2.2–2.5, §5.1)
  — all still inline. Two items resolved differently: `DemoUploadGuard` was
  **deliberately rejected as a guard** — guards run before the multipart parser, so
  throwing yields ECONNRESET instead of 403 (PROFILE-015); the dedup landed as the
  shared `nest/common/demo-write.ts` helper instead. And the three hand-written addon
  guards collapsed into one `AddonGuard` + `@RequireAddon` (`22d178d2`).
- [x] **Slice 2 — `TripAccessGuard` + `@RequirePermission`** (landed 2026-08-09,
  `8c0280e2` + `94221a6d`; the decorator shipped as `@RequirePermission` with a
  `@Trip()` param decorator, not the planned `@RequireTripPermission`): 13 controllers
  on `TripAccessGuard`, 81 `@RequirePermission` sites, **zero** inline `checkPermission`
  left in controllers. Remaining tail (as predicted, the bespoke-string domains):
  **trips** (7 bespoke 403 strings), **share**, **trip-invite**, **feeds** (still
  hand-rolled trip-access SQL, §4.7), and partial conversions in **files** (guard
  per-handler but permissions inline — one class-level decorator can't express
  upload/edit/delete; upload stays off the guard for the multipart reason),
  **places** and **collab** (old `requireTrip` helpers still present).
- [ ] **Slice 3 — per-resource guards** (1 of 3 done 2026-08-10): `TripOwnerGuard` is
  done (`45611e25`-era; applied to the 4 trip-members routes, deliberately skipping
  `PermissionsService` so admins can't transfer trips). Still open: `JourneyRoleGuard`
  (16 inline `Not allowed` 403s remain; + align its 403-for-invisible enumeration
  signal to the collections 404-first idiom) and `PhotoAccessGuard` (memories
  cross-user access still inline `canAccessUserPhoto`) (§2.6–2.8).
- [x] **Capstone ratchet — global `APP_GUARD` `JwtAuthGuard` + `@Public()` decorator**
  (done 2026-08-10, `ffb73fac` "Turn protection from opt-in into default-deny" +
  `be8081c3` MFA guard): `GlobalAuthGuard` + `MfaPolicyGuard` as `APP_GUARD`s,
  `@Public()`/`@OptionalAuth()` decorators, and the boot-time
  `validate-route-guards.ts` ratchet (`PUBLIC_ROUTE_ALLOW_LIST`). One deviation from
  §6's plan: instead of sweeping the per-controller `@UseGuards(JwtAuthGuard)` sites,
  the global guard *stands down* for any route with a declared guard chain (reads
  `GUARDS_METADATA`, resolves `req.user` without throwing so MFA still sees the
  caller) — that solves the addon-404-before-401 ordering caveat. MFA middleware
  folded (one intended behavior change: public `/api` routes no longer 403 MFA-less
  logged-in users); all four dead middleware files deleted (`939452f9`, `9814480a`,
  `be8081c3` — `src/middleware/` now holds only `globalMiddleware.ts`).
- [ ] **Decisions parked in the audit** (still open 2026-08-10): the missing server-side
  `documents` addon gate (only ungated addon without a load-bearing parity comment,
  §4.2 — `/api/trips/:tripId/files` still serves with the addon off); rate-limit
  unification (§4.4 — **half done**: one shared `RateLimitService`/`RateLimitModule`
  now serves 5 modules, but `transit.mcp.ts`, backup, `mcp/index.ts` and the plugin
  host still roll their own, and no `@RateLimit` decorator exists). Do NOT guard the body-dependent
  checks (collections owner checks, `PUT /trips/:id`'s body-derived permission key,
  vacay) or the fail-soft plugin contribution routes — the audit's §3 list is load-bearing.

## Continuous streams (not phases)

- **DTO ratchet**: every migration includes its domain's DTOs; remaining allow-list entries
  for already-migrated domains are independent hour-scale filler tasks. The boot gate keeps
  this honest.
- **MCP decorator ports**: every migration moves its legacy registrar to `<domain>.mcp.ts`;
  registrar-drift findings (`mcp-4`, `mcp-5`, `mcp-6`) die as their domains port.
- **Quirk-fix trailing commits**: parity migration first, verified-defect fixes in a
  separate `fix(server)` commit (established pattern).

## Deliberately late

- **Option B decorator RPC registry** (DI-MIGRATION.md §3) — **done 2026-08-09**
  (`7b11680c` decorator kit → `f72aba0c` full rollout; `PluginsModule` split into
  four with per-domain coverage gates, `6680bc7c`).
- **True `@WebSocketGateway` transport swap**: behind the Phase 0 `RealtimeService` facade,
  whenever — it becomes an implementation detail.
- **`index.ts` boot dismantling**: the scheduler went with Phase 2 (2026-08-10 —
  Nest lifecycle owns every cron); MCP/ws wiring migrate into Nest lifecycle hooks
  opportunistically; the db `reinitialize` Proxy retires only with backupService,
  last.

## Operational hardening — will bite soonest (verified 2026-07-28)

Not architecture, but the things most likely to hurt before the phases above finish:

- [x] **De-flake the CI gate.** (done — see the Status block below; the checkbox lagged
  the work.) `test:coverage` is the merge gate (test.yml) and it can
  exit 1 spuriously: reproduced 2026-07-28 — an `EnvironmentTeardownError` from
  `vacay.service.test.ts`, caused by a fire-and-forget dynamic
  `import('services/notificationService')` resolving after the vitest environment tore
  down. A flaky main gate trains everyone to re-run, and then real failures slip. Fix the
  race (await/guard the lazy sends in tests — and note Phase 2's injected notifications
  removes the pattern entirely), sweep the expected-error stderr noise (SQLITE_ERROR spam
  makes real failures invisible in logs), and watch the coverage run's cost (~11 min of
  module imports under istanbul instrumentation and growing with every migration).
  - **Status 2026-07-28** (commits `c7dc38a5` + `80f39585`, test-side only, zero `src/`
    changes):
    - *Race*: defensively closed — global `afterEach` drain in `tests/setup.ts` settles
      the unawaited import/`.then` chains while DB + worker env are alive, plus vacay-style
      `beforeAll` warm-ups in the cold suites (unit trips.service, integration
      vacay/collab/packing/trips). Mechanism verified against vitest 4.1.9 source (the
      dynamic import's host-RPC fetch is what teardown rejects; warmed URLs skip the RPC);
      NOT reproduced locally in ~110 stress runs (fast machine — CI's 2-core runner is
      where the window is wide), so keep an eye on the gate before calling it dead.
    - *Noise*: swept — green `test:unit` stderr went 8,249 → ~195 lines
      (`tests/setup.console-noise.ts`, two exact-pattern filters: migrations
      duplicate-column replay artifact + the vitest-only airportService backfill require
      failure). Remaining follow-up if wanted: ~168 stdout `[DB] Running migration N/M`
      lines per test file.
    - *Cost* (watch item, unchanged): two clean gate runs at 52s wall on a 16-thread dev
      box, but cumulative import time ~657s vs ~97s actual test time — instrumented
      module imports are ~6.6× the tests themselves and scale with migrated-module count,
      not test count. Phase 2's injected notifications still deletes the send pattern
      entirely.
- [ ] **Migration-identity safety.** `schema_version` is a single integer and a step's
  identity is its array position; append-only is enforced only by convention plus a
  hygiene test, and failed steps log "Non-fatal migration step failed" and continue.
  The bite: two branches each appending "step N" merge cleanly, and instances migrated at
  different times silently diverge. Add: a named/checksummed applied-migrations ledger
  (keep positional order, record identity), a boot-time collision check, and an automatic
  pre-migration snapshot (backupService already knows how) before any pending step runs.
- [ ] **Swallowed cross-domain side-effect failures.** 11 `catch → console.error` sites in
  `nest/**` services alone — mostly the sync seams (reservation↔budget item creation,
  price sync, booking-import costs). These silently lose user-visible data: a booking
  saves, its expense doesn't, nobody is told. Define one policy (at minimum: audit-log the
  failure + emit a client-visible warning event; ideally a small retry queue for the
  money-adjacent ones) and sweep the seams — pairs naturally with the seam-ownership
  decisions above, since each seam gets one owner anyway. The client-side rule already
  exists ("optimistic writes must reconcile — no silent catch"); this is its server twin.
- [ ] **Dependency currency.** No automation visible for dependency updates (better-sqlite3
  ABI bumps, Nest majors, the Express adapter). Pick a cadence or a bot (Renovate/
  dependabot) before the gap gets expensive; the plugin-sdk's standalone lockfile doubles
  the surface.

## Definition of done (so "finished" is checkable, not vibes)

The migration/modernization is complete when all of these hold — each is grep- or
gate-verifiable, worth re-checking after every phase:

- `server/src/services/` contains only the deliberate plain-module helpers listed in
  `migration-graph.md`'s classification (no domain service files).
- Zero `*.bridge.ts` files remain (bridge deletion notes in each file say when).
- The `db` Proxy is imported only by `DatabaseModule`/`database.ts` internals and
  backupService's lifecycle code; every other consumer injects `DatabaseService`.
- `index.ts` is thin: no hand-booted scheduler/ws/MCP wiring (Nest lifecycle owns them);
  the db-boot airport backfill is gone (`places-1`).
- `src/mcp/tools.ts` fan-out is empty (registry attach only); `src/mcp/resources.ts` gone.
- `body-contract-allow-list.ts` is empty and deleted (gate removed with it).
- Tests: no `vi.mock('src/db/database')` outside DatabaseService's own tests — the
  through-line promise in `migrate.md`.
- The tokenization boot gates (MCP access groups, WS events) are on and non-empty.

**Re-checked 2026-08-10** (after the `src/services/` deletion):

- ✅ `src/services/` gone — deleted outright, plus the ESLint wall.
- ✅ No `vi.mock('src/db/database')` outside DatabaseService's own tests.
- ✅ `src/mcp/tools.ts` is registry-attach-only (3 live lines); all 24 domains on
  `<domain>.mcp.ts`, prompts included.
- ✅ Tokenization boot gates on (`nest-mcp-policy.ts`, `validateBodyContracts`,
  `validate-route-guards.ts`).
- 🟡 `body-contract-allow-list.ts` is **empty** (`ba7d55f9` cleared the last 17) but
  the file + boot gate still exist — arguably keep the gate as the ratchet.
- ✅ (2026-08-10) The scheduler is Nest-owned: `src/scheduler.ts` deleted, every
  cron a domain provider on `CronRegistrarService` (`src/nest/scheduling/`),
  `node-cron` out of `package.json`. `index.ts` no longer boots any cron and its
  `shutdown()` rides `nestApp.close()`. The db-boot airport backfill was already
  gone (`9c46f31c`); ws/MCP wiring remain its hand-booted seams.
- 🟡 (re-checked 2026-08-11, after the bridge fold) **8** `*.bridge.ts` files
  remain, each shrunk to the exports its consumers import and carrying a
  truthful header. The honest split: **5 pinned by one seam**, the
  pre-`app.init()` MCP/OAuth mount (`oauth`, `audit`, `addons`, `auth`,
  `permissions` — these die together if that mount ever moves behind the
  container), and **3 verified-permanent cycle-dodges** (trips ←
  budget.mcp/packing.mcp/costs.rpc — TripsModule/TripReadModelModule/
  TripMembersModule all import the budget/packing domains; assignments ←
  places.mcp — DaysModule → PlacesModule → AssignmentsModule → DaysModule;
  airtrail ← reservations.controller). The 2026-08-10 endgame executed: the 4
  dead ones deleted (`8e4261ed`), `journey.bridge` + `src/mcp/resources.ts`
  retired with the journey-resource migration, `budget.bridge` deleted
  (UserCleanupService injects BudgetService; BudgetModule dropped AuthModule),
  and the backup-restore / systemNotices in-container edges folded
  (`permissions-cache.ts`, threaded `addonEnabled`).
- ✅ (2026-08-11) `src/mcp/resources.ts` gone — the 4 journey resources are
  decorator-registered on `journey.mcp.ts`; `journey.bridge` died with it.
- ❌ The `db` proxy is still imported outside DatabaseModule:
  `mcp/oauthProvider.ts`, `mcp/tools/_shared.ts`, and the surviving bridges —
  the MCP/OAuth seam above (`websocket.ts` is a re-export stub with no `db`
  import since the gateway move; the scheduler's cron-path imports are gone).

## Keep in mind — ORM / data-layer swap (not scheduled, just recorded)

An ORM move is under consideration but deliberately NOT a roadmap phase. What to remember
when the time comes (discussed 2026-07-28):

- **The sync/async decision dominates everything.** better-sqlite3 being synchronous is
  load-bearing: `db.transaction()` cannot contain an `await` (the budget FX-freeze design
  exists because of this), controllers return without racing broadcasts, and there are no
  async gaps inside multi-statement writes. Prisma/TypeORM/MikroORM/Kysely are all
  Promise-based — adopting one is a rewrite of the concurrency model, not a data-layer
  swap. **Drizzle** is the mainstream option that keeps sync semantics over
  better-sqlite3; its schema-as-code + migration generator would also address the
  migration-identity item in "Operational hardening". Decide sync-vs-async first, via a
  short spike with hard criteria: sync preserved? byte-parity strategy for the documented
  SQL quirks (COALESCE/CASE sentinels, INSERT OR IGNORE, lastInsertRowid)? migration story
  vs the positional `schema_version`?
- **Do NOT pre-build an abstract DatabaseService or hand-rolled repository interfaces.**
  Abstraction at the `prepare/get/all/run` level is the wrong seam (no ORM can be
  implemented behind it), and interfaces designed before the target is chosen get shaped
  around today's implementation — every ORM imposes its own repository/entity idioms.
  Premature abstraction here is negative work.
- **The migration IS the ORM prep.** Each fold consolidates a domain's SQL into one
  injectable class — that's most of what a repository layer provides. The table-ownership
  seam decisions (see "Seam-ownership decisions") are the true ORM prerequisites: entities
  need one owner per table.
- **Cheap conventions worth adopting when convenient** (no parity risk):
  large NEW folds may split into `<domain>.service.ts` (logic/permissions/broadcasts) +
  `<domain>.repository.ts` (SQL, still over the concrete `DatabaseService`, byte-identical)
  — tripService is the natural first candidate; and per-domain typed row types
  (`SettlementRow` pattern → a `rows.ts` per domain) as proto-entities. Don't retrofit
  finished domains until the target is chosen.

## Known not-covered (future audits)

- **Client-side coherence**: this audit was server-only; client CLAUDE.md notes the
  files bypassing the store→repo→api layering — a parallel audit + ratchet is its own
  project. **The debt is growing**: ~137 files at the 2026-07 count, **~190** at a
  2026-08-10 recount (components 98, mobile 55, pages 31, plus sync/services/hooks),
  with no lint/CI ratchet holding the line.
- Low-severity audit findings not scheduled above remain valid opportunistic fixes — see
  `audit_report/domain-coherence-audit.md` per-domain sections.
