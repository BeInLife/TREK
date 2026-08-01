# NestJS migration layer — module & test guide

This folder holds the co-hosted NestJS app that incrementally strangles the legacy
Express API (see the "Brownfield Rewrite" board). Until a prefix is migrated, the
top-level dispatcher in `src/index.ts` routes it to the legacy app; migrated
prefixes go to Nest. **Weather (`weather/`) is the reference implementation** — copy
its shape when migrating a new domain.

## Module layout (per domain)

```
shared/src/<domain>/<domain>.schema.ts(.spec.ts)   # Zod contract — single source of truth
server/src/nest/<domain>/<domain>.service.ts        # business logic (ported 1:1 from the Express service)
server/src/nest/<domain>/<domain>.controller.ts     # same routes/verbs/params/status codes as Express
server/src/nest/<domain>/<domain>.module.ts         # registered in app.module.ts
```

Add the prefix to `DEFAULT_NEST_PREFIXES` in `strangler.ts` to route it to Nest
(operators can override at runtime via the `NEST_PREFIXES` env var — instant
rollback, no redeploy). Trip-scoped mounts use a pattern prefix with a `:param`
segment (e.g. `/api/trips/:tripId/packing`); the matcher routes only that nested
mount to Nest and leaves the sibling trip routes (days, places, ...) on Express.

## Migrated so far

- **Phase 1 (leaf):** weather, airports, config (public), system-notices, maps,
  categories, tags, notifications, atlas.
- **Phase 2 (trip sub-domains):** vacay (addon), packing, todo.
- **DI-native services (legacy `src/services/*` deleted):** tags, categories,
  todo, packing, day-notes, trip-invite, assignments, share, settings, files,
  collab, vacay, reservations, day, permissions, audit, budget, trip, maps,
  transit, place, transit-itinerary, collections — see the migration recipe
  below.

## Cross-cutting Foundation pieces

- `common/idempotency.interceptor.ts` — global `APP_INTERCEPTOR` replaying the
  client's `X-Idempotency-Key` on mutations, mirroring the legacy
  `applyIdempotency` middleware so retried writes don't double-apply.
- `strangler.ts` — supports both static prefixes and `:param` pattern prefixes.
- `app-config/` — the `@nestjs/config` binding (`AppConfigModule`, global). Never
  read `process.env` in a module (ESLint enforces this): inject a boot-stable
  namespace via its `registerAs` token (`@Inject(mcpConfig.KEY) … ConfigType<…>`)
  or read runtime-toggled values live through `RuntimeEnvService` / `readEnv()`
  from `src/app-config`. The classification and invariants live in
  `src/app-config/README.md`.

## Parity gotchas worth remembering

- A POST that answers with `res.json` in Express stays **200**; add `@HttpCode(200)`
  (Nest defaults POST to 201). Creates that Express sends as 201 need nothing.
- Static sub-routes that collide with a `:id` param (e.g. `/in-app/all` vs
  `/in-app/:id`, `/reorder` vs `/:id`) must be declared **before** the param route.
- Reproduce bespoke admin/error wording exactly — e.g. notifications' `test-smtp`
  returns `{ error: 'Admin only' }`, not the AdminGuard's `Admin access required`.
- Trip-scoped routes verify trip access (404) and the relevant permission (403)
  per handler and forward `X-Socket-Id` to the WebSocket broadcast.

## Parity is law

A migrated route must be **byte-identical** for the client: same URL, method,
query/body, HTTP status, `Set-Cookie`, and JSON body — including bespoke error
strings. Where the legacy route returns a hand-written error (e.g. weather's
`{ error: 'Latitude and longitude are required' }`), reproduce that exact body in
the controller rather than relying on the generic `ZodValidationPipe` envelope.

## How to write the tests

Every module ships three kinds of tests; the coverage gate (`vitest.config.ts`,
scoped to `src/nest/**`) requires ≥80%.

1. **Service / controller unit spec** — `tests/unit/nest/<domain>.controller.test.ts`.
   Instantiate the controller with a mocked service; assert status codes, the exact
   `{ error }` bodies, and that inputs are forwarded correctly (defaults, coercion).
   See `weather.controller.test.ts`.

2. **Parity test** — `tests/parity/<domain>.parity.test.ts`. Mock the shared service
   identically for both apps, then fire the same request at the Express route and the
   Nest controller with the `expectParity()` harness (`tests/parity/parity.ts`) and
   assert identical status + body. This is the gate before flipping the toggle.
   See `weather.parity.test.ts`.

3. **e2e** — `tests/e2e/<domain>.e2e.test.ts`. Boot the Nest module against a temp
   in-memory SQLite db via the shared harness (`tests/e2e/harness.ts`:
   `createTempDb`/`seedUser`/`sessionCookie`), exercising the **real** `JwtAuthGuard`
   end-to-end (401 without cookie, 200 with a signed session). Mock external I/O
   (HTTP/etc.). See `weather.e2e.test.ts`.

## Definition of Done (per module)

Contract in `@trek/shared` → service ported 1:1 → controller with identical routes →
validation/error parity → unit + parity + e2e tests over the gate → prefix toggled to
Nest → parity verified on the demo DB → **then** decommission the old Express
route/service (separate step, after the toggle is confirmed in prod) → frontend points
at the typed contract (Frontend Track).

## Migrating a legacy `src/services/*` service into its Nest module (recipe)

Pilot: **tags** (`services/tagService.ts` → `nest/tags/tags.service.ts` +
`nest/tags/tags.bridge.ts`); categories followed the same shape (and piloted the
first `@Resource` in `categories.mcp.ts`); todo followed too (and piloted the
first `@ResourceTemplate` plus the `when` addon gate in `todo.mcp.ts`, and the
first in-container consumer wiring: `TripsService` injects `TodoService` via
`exports: [TodoService]` instead of using the bridge); packing followed (the
largest port so far: a 17-tool + 2-resource `packing.mcp.ts` with inline admin
gates, and the first `PluginHostDepsFactory` swap done as part of a service
migration — no bridge entry for the plugin host); day-notes followed (the first
migration needing **no bridge at all**: after its three tools + resource moved
to `day-notes.mcp.ts` and the plugin host injection, nothing outside the
container consumed it); trip-invite followed (the smallest port: no MCP
surface, no plugin-host import and no bridge — the SQL folded straight into
`trip-invite.service.ts`); assignments followed (a 7-tool `assignments.mcp.ts`,
the plugin-host swap, and a bridge kept only for the two legacy registrars —
places and reservations — that borrow its existence checks; the batch loaders
stay in `services/queryHelpers.ts`, shared with the unmigrated place
service); share followed (never imported by the plugin host, and its three MCP
tools stay in the legacy trips registrar — their `trips:share` scope gate has
no declarative `access: { group, mode }` equivalent — so the port is the SQL
fold plus a 3-export `share.bridge.ts` for `mcp/tools/trips.ts`); settings
followed (no MCP surface, no bridge, and the first migration that converted an
in-container plain-function consumer into a provider instead of bridging it:
`llm-parse/llm-config.resolver.ts` became the injectable `LlmConfigResolver`,
injected by `LlmParseService` and `PluginHostDepsFactory`); files followed (no
MCP surface and no addon gate; the load-time constants + pure helpers consumed
by three controllers' module-scope multer configs moved to
`files.constants.ts`, and `files.bridge.ts` survives with a single export —
the request-time `getAllowedExtensions` app_settings read those configs need
outside DI — while every function consumer, including the plugin host and
`TripsService`, injects `FilesService`); collab followed (a 12-tool +
3-resource `collab.mcp.ts` that piloted **composite `when` gates** — the collab
addon AND the per-sub-feature `getCollabFeatures()` flags (notes/polls/chat)
that the legacy registrar and resources checked at registration time — plus
the plugin-host swap and a 3-export `collab.bridge.ts` for the two remaining
legacy consumers, `tripService`'s trip summary and `mcp/tools/trips.ts`);
vacay followed (the largest MCP port yet — a 26-tool + 3-resource
`vacay.mcp.ts`, including the first fixed-URI `@Resource` behind a `when`
addon gate — plus the plugin-host swap and a 1-export `vacay.bridge.ts` for
`tripService`'s trip-window entry shift; the DTO ratchet for its 13
grandfathered body contracts landed as a sibling commit); reservations
followed (the residue fold: the wrapper `ReservationsService` was already
DI-native at the edge, so the 626-line legacy module folded into it — a 5-tool
+ 1-resource `reservations.mcp.ts`, the plugin host's last plain-function
reservation import (`notifyBookingChange`) swapped for the injected service,
`TripsService` and `BookingImportService` converted from function imports to
injection, and a 9-export + 3-type `reservations.bridge.ts` for the legacy
`tripService`, the airtrail import/sync pair and the still-legacy transports
registrar (the transit registrar has since migrated to `transit.mcp.ts`); the
DTO ratchet for its 4 grandfathered body contracts
landed as a sibling commit, which also loosened the shared positions schema to
the real wire contract — `day_plan_position` optional, pinned by RESV-006);
day followed (the 592-line legacy `dayService` folded into the existing
wrapper `DaysService` — including the accommodation SQL that
`nest/reservations/accommodations.service.ts` now reaches via an injected
`DaysService` — with the hand-rolled `BEGIN`/`COMMIT` blocks in
reorder/insert converted to `db.transaction()`; a 7-tool + 2-resource
`days.mcp.ts`, the plugin host's 11-symbol import swapped for the injected
service, `TripsService` + the assignments/reservations MCP controllers
converted to injection, and a 6-export `days.bridge.ts` for the legacy
`tripService` and the still-legacy transports registrar (transit has since
migrated); the DTO
ratchet for its 4 day + 2 accommodation grandfathered body contracts landed
as a sibling commit);
permissions followed (the first Wave-2 **cross-cutting** migration and the
first greenfield module in the series — no prior wrapper, controller, MCP
surface or DTO of its own: a new `nest/permissions/` whose
`PermissionsService` is injected by 16 domain services, the airtrail-import
controller and `PluginHostDepsFactory` (its 16th constructor dep) in one move,
plus a 5-function `permissions.bridge.ts` for `mcp/tools/_shared.ts` — one
repoint covering every `hasTripPermission` call site — and the four legacy
consumers adminService/authService/backupService/collectionsService; the
permissions **cache stays module-scoped** in `permissions.service.ts` on
purpose, so the bridge instance and the container singleton share one cache
and backup-restore's bridge-side `invalidatePermissionsCache()` flushes what
request handlers serve; the domain e2e suites swapped their path mocks for a
`vi.spyOn(app.get(PermissionsService), 'checkPermission')` instance spy);
auditLog followed (the other Wave-2 half, split into five files: the
injectable `AuditService` (`writeAudit` over `DatabaseService`), the pure
`client-ip.ts` (files.constants precedent — the four getClientIp-only
controllers stay plain imports), the deliberately side-effectful plain
`audit-log.logger.ts` — frozen-at-import `LOG_LEVEL` and the import-time
`data/logs` mkdir are a documented parity exception to the no-side-effects
rule because `index.ts` lazy-requires it pre-container and tests/setup.ts
sets the level pre-import — plus `audit.module.ts` and a full-surface
`audit.bridge.ts` for `mcp/index.ts`, `mcp/oauthProvider.ts` and the legacy
airtrail/immich/oauth services, while log*-only consumers (index.ts's lazy
require strings, scheduler, globalMiddleware, notifications) point at the
logger directly; 8 controllers + `PluginRuntimeService` inject `AuditService`,
and the domain e2e suites dropped the audit mock entirely — writeAudit runs
for real against an `audit_log` table in their temp DBs).
The exchangeRateService fold followed (the pure-infra FX helper — Frankfurter
fetch + module-scoped 6h cache, no SQL, no controller, no MCP registrar of its
own — folded into `nest/budget/` as a dep-free `ExchangeRatesService`, injected
by `BudgetService` and `PluginHostDepsFactory` (its 17th constructor dep); the
rate **cache stays module-scoped** like the permissions cache, so any
out-of-container instance and the container singleton share one cached
upstream feed).
budgetService followed (the 755-line Wave-4 money core folded into the wrapper
`BudgetService`: items/members/payers CRUD, the FX freeze + rebase paths and
the settlement maths with `splitEqualShares` gone private; the freeze-then-write
composites kept their wrapper names while the raw settlement writes became
`insertSettlement`/`applySettlementUpdate` so the MCP paths keep skipping the
freeze; the 11-tool `mcp/tools/budget.ts` registrar + 3 `resources.ts` budget
resources moved to `budget.mcp.ts`; TripsService, ReservationsService (+ its
MCP class) and BookingImportService inject `BudgetService`; a 4-export
`budget.bridge.ts` serves the legacy tripService/userCleanupService and the
trips/transports registrars; `exchange-rates.bridge.ts` was deleted with its
last consumers, and the controller adopted `budget.dto.ts` — all nine
allow-list entries removed).
tripService followed (the 1121-line Wave-4 hub — the biggest fold — moved into
the wrapper `TripsService`: TRIP_SELECT + list/create/get, the
`generateDays` two-phase renumber engine, the updateTrip date-shift
transaction, the member/guest lifecycle (#973/#1362), the ICS export with its
module-scoped tz-validity cache, `copyTripById` and `getTripSummary`; its six
bridge imports became injected services (CollabService + VacayService joined
the constructor); the 10-tool trips registrar + 3 `resources.ts` trip
resources + the trip-summary prompt moved to `trips.mcp.ts` — the first
`@Prompt` use, with the fire-once static-token deprecation notice now riding
the `registry.attach` ctx — and the 3 share-link tools it carried moved to
`share.mcp.ts` on the `canShareTrips` predicate (delete_trip and the
canReadTrips reads are predicates too — the broadened legacy gates have no
declarative equivalent); FeedsService and the plugin host inject
`TripsService` (its 20th constructor dep); a 3-export `trips.bridge.ts`
serves the legacy prompts registrar and budget.mcp.ts's owner/member seam
(injecting there would need a forwardRef'd TripsModule↔BudgetModule cycle);
`todo.bridge.ts`, `share.bridge.ts`, `collab.bridge.ts` and `vacay.bridge.ts`
were deleted with their last consumers and the unused days/budget bridge
exports pruned; the controller adopted `trips.dto.ts` — all seven allow-list
entries removed).
mapsService followed (the 1429-line geo core — Google Places, Nominatim,
Overpass mirror racing, Wikimedia photos, Maps-URL resolution — folded into the
wrapper `MapsService`; the pure parser/UA/POI-category helpers moved to
`maps.helpers.ts` as plain exports (files.constants/client-ip precedent —
the DI-native TransitService's User-Agent imports from there, not a bridge), the module-scoped
POI cache / photo-fetch semaphore / frozen Overpass mirrors stayed module-scoped
on purpose (permissions-cache precedent: any out-of-container instance and the
DI singleton share them); the 3 geo tools left the mixed `mcp/tools/mapsWeather.ts`
registrar for the decorator-driven `maps.mcp.ts` (the registrar file survives —
its weather + airport tools await their own migrations); BookingImportService
injects `MapsService` for its Nominatim geocoding, and a 3-export
`maps.bridge.ts` served the legacy placeEnrichment helper and the places
registrar — both absorbed by the 2026-07 place fold, which deleted the bridge).
transitService followed (the first fully SQL-free domain fold — the 333-line
Transitous/MOTIS proxy became a dep-free `TransitService` (no
`DatabaseService`; the ExchangeRatesService precedent), its response cache,
frozen-at-import `TRANSIT_API_BASE` and lazy User-Agent memo staying
module-scoped on purpose; the pure `deriveTransitStats` + mode whitelist +
itinerary types moved to `transit.helpers.ts` (maps.helpers precedent) so the
downstream legacy `transitItineraryService` needed no bridge (since relocated
into the domain as `transit-itinerary.helpers.ts`); the whole 3-tool
`mcp/tools/transit.ts` registrar moved to `transit.mcp.ts` — the two geo
search tools on `access: { group: 'geo', mode: 'read' }` and
`create_transit_journey` on `reservations:write`, with its days/reservations
bridge imports becoming injected `DaysService`/`ReservationsService` (+
`DatabaseService` for `canAccessTrip`) — leaving **zero bridge files** and the
transports registrar as `days.bridge.ts`'s last consumer).
placeService followed (the step-4 tail: the 1029-line place core — the
CRUD + ratings SQL, the GPX/KML/KMZ importers and the Google/Naver list
importers — folded into the wrapper `PlacesService`, with the pure pieces
(frozen XML parsers, the KMZ unpacker, the dedup predicates, the Google
hex-id parsers, `reclaimPhotoCache`) moving to `places.helpers.ts` on the
maps.helpers precedent; the 10-tool `mcp/tools/places.ts` registrar + the
`trek://trips/{tripId}/places` resource moved to `places.mcp.ts` —
`search_place` came along because its gate is `places:read`, not the geo
group, and now injects `MapsService`; TripsService, DaysMcp,
BookingImportService and the plugin host (its 21st constructor dep) inject
`PlacesService`, leaving **zero bridge files** for the domain; the two
`assignments.bridge` imports stay in `places.mcp.ts` on purpose —
AssignmentsModule imports DaysModule and DaysModule now imports
PlacesModule, so injecting would close a
DaysModule → PlacesModule → AssignmentsModule → DaysModule cycle
(reservations.mcp.ts uses the same seam for the same reason). The sibling
`placeEnrichment` fold went further than the recipe's minimum: the 168-line
helper's DB/websocket/Maps half became `PlacesService` methods over the
injected `DatabaseService`/`RealtimeService`/`MapsService` and its pure
match selector joined `places.helpers.ts`, which retired **`maps.bridge.ts`**
with its last consumer. The DTO ratchet for its 7 grandfathered body
contracts landed as a third commit, which also loosened
`placeBulkUpdateRequestSchema.ids` (`.min(1)` dropped) so the endpoint's
empty-list short-circuit stays reachable, and retired three bespoke 400
strings — 'Place name is required', 'ids must be an array of numbers' and
'URL is required' — in favour of the pipe envelope, accepting that a
malformed body now 400s ahead of the trip-access 404 (the todo/trips trade).
transitItineraryService followed (the first pure-helpers relocation with no
service fold at all — the 287-line module is 100% pure, so the recipe's SQL /
bridge / DTO / plugin-host steps were all no-ops: the Zod itinerary schemas +
endpoint/metadata builders moved byte-identical to
`transit-itinerary.helpers.ts`, next to `transit.helpers.ts`; the schemas
**must** stay module-level plain exports because `transit.mcp.ts` consumes
them inside `@Tool({ inputSchema })` decorators, which evaluate at module load
before any container exists; the sole consumer — the in-container
`transit.mcp.ts` — was a one-import repoint, closing step 4 of the
dependency-honest order; the legacy module had no direct suite, so a new
21-case `TRANSIT-ITIN-*` characterization suite now pins all 12 superRefine
error strings, the `??` time fallbacks, the coordinate tolerances and the
reservation endpoint/metadata builder).
collectionsService followed (the biggest single fold yet — 1024 lines / 28
exports into `CollectionsService` over DatabaseService + PermissionsService +
RealtimeService, with the `deleteOldCollectionCover` path re-anchored one
directory deeper and the `sendInvite` lazy notificationService `import()`
kept, collab precedent; the 25-tool legacy registrar `mcp/tools/collections.ts`
moved to `collections.mcp.ts` — at relocation time deliberately with NO
`when:` addon gate, since the legacy registrar registered unconditionally
while REST/plugin-host gate on the addon; the trailing `fix(server)` quirk
commit then gated all 25 tools (the addon ships disabled by default, so the
ungated surface was live on fresh installs) alongside wrapping every
multi-statement write in `db.transaction()`, making the bulk ops
all-or-nothing, and forwarding `X-Socket-Id` on the from-trip saves — each
pinned by a new 23-case `tools-collections` characterization suite plus the
`COLLECTIONS-SVC-090…092` band (the legacy registrar had no tool-level tests
at all);
the plugin host swapped its 7 collections imports for the injected service —
its 22nd constructor dep — and NO bridge was needed anywhere; the dead
`buildDedupSet` module helper was dropped in the move, the only line that
didn't relocate verbatim).
Repeat these steps per
service (next up: **the notifications fan-in** —
per the dependency-honest order in
`migration-graph.md`). This is a
**pure relocation** — byte-identical
SQL, statuses, bodies, and error strings. The plugin RPC host is **no longer a
bridge consumer**: since Option A of `src/nest/plugins/DI-MIGRATION.md` it
injects domain services via `PluginHostDepsFactory`, so a migrated domain adds
`exports: [XService]` + a `PluginsModule` import instead of a bridge entry.
Only legacy `src/mcp` registrars (and scheduler/websocket code) still need
bridges.

1. **Move the SQL** into `<domain>.service.ts` as methods over an injected
   `DatabaseService` (`this.db.all<T>/get<T>/run/prepare/transaction`; strict
   constructor injection, no `@Optional()`). Preserve every quirk: falsy-coercion
   defaults (`x || fallback`, never `??`), post-insert/post-update re-selects (no
   RETURNING), `COALESCE` semantics. If a controller already wraps the legacy
   functions, do not change the service's method surface. The module needs no
   `imports: [DatabaseModule]` — it's `@Global`.
2. **Add `<domain>.bridge.ts`** next to the service **only if non-Nest consumers
   exist** (legacy MCP tool registrars, scheduler, websocket — the plugin RPC
   host now injects instead, see above). It builds a module-level instance over
   the shared connection Proxy — `new XService(new DatabaseService(db))`,
   reinitialize-proof, same pattern as `nest/todo/todo.bridge.ts` — and exports
   the legacy function names 1:1.
   Container code injects the service; only outside-container code imports the
   bridge. When porting an MCP registrar, note the `access: { group, mode }`
   markers are typed against the scope-derived `ScopeGroup` union and
   boot-validated by `trekMcpValidateAccess` (`src/mcp/nest-mcp-policy.ts`) —
   an unknown group, or `mode: 'write'` on a read-only group (`geo`,
   `weather`), fails app boot. *(Design decision, settled with the tags pilot:
   MCP tools stay outside the container and use the bridge. The alternative — handing the Nest app to the
   MCP layer via `app.get(XService)` — was rejected: it would thread the container
   through `mcpHandler` + every tool registrar and force a Nest bootstrap into the
   container-less `tests/helpers/mcp-harness.ts` used by ~25 MCP suites.)*
3. **Repoint non-Nest consumers** — import-path-only diffs from
   `services/<x>Service` to `nest/<domain>/<domain>.bridge`; call sites unchanged.
4. **Delete the legacy service** once `grep -rn "services/<x>Service" src tests`
   only hits the tests you're rewriting.
5. **Tests:**
   - Move `tests/unit/services/<x>Service.test.ts` →
     `tests/unit/nest/<domain>.service.test.ts`, preserving case IDs. Construct the
     service directly — `new XService(new DatabaseService(testDb))` — no
     TestingModule, no `overrideProvider` (repo convention). Add one delegation
     case per bridge export: the bridge sits under `src/nest/**`, inside the ≥80%
     coverage gate, and these cases pin it deterministically.
   - Convert the module e2e to the DI-native pattern (exemplar
     `tests/e2e/trips.e2e.test.ts`): temp-db DDL for the domain's tables,
     `imports: [DatabaseModule, <Domain>Module]`, real SQL assertions. Keep only
     the `vi.mock('../../src/db/database', …)` — the auth guard still reads users
     through the singleton, and `DatabaseModule`'s factory picks up the same
     mocked db. Drop the legacy-service mock entirely.
   - Suites that mocked the legacy module mock the bridge path instead — same
     factory shape, path-only change. (For the plugin host suite,
     `plugin-host-deps.factory.test.ts`, the domain becomes a constructor stub
     instead of a path mock.)
6. **Verify** (from `server/`): `npm run typecheck`, `test:unit`,
   `test:integration`, `test:e2e`, `lint:check`, `test:coverage`.
