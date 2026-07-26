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
  collab — see the migration recipe below.

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
stay in `services/queryHelpers.ts`, shared with the unmigrated day/place
services); share followed (never imported by the plugin host, and its three MCP
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
legacy consumers, `tripService`'s trip summary and `mcp/tools/trips.ts`).
Repeat these steps per
service (next up: vacayService). This is a **pure relocation** — byte-identical
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
   bridge. *(Design decision, settled with the tags pilot: MCP tools stay outside
   the container and use the bridge. The alternative — handing the Nest app to the
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
