# Plugin RPC boundary — migration to Nest DI

Status: **Option A implemented (2026-07)** — the wiring layer is now
`host/plugin-host-deps.factory.ts` (`@Injectable() PluginHostDepsFactory`),
with process-wide host state split into `host/plugin-host-state.ts`. Option B
below remains the roadmap.
Goal: make the host side of the plugin boundary fully Nest-native, in step with
the ongoing legacy-service migration (`src/nest/README.md`, "Migrating a legacy
`src/services/*` service" recipe). The **process boundary itself does not
change** — only how the host sources and organizes its dependencies.

---

## 1. Where we are today

The plugin runtime has three layers. Only the third is "un-Nest".

| Layer | File(s) | Role | Nest-native? |
|---|---|---|---|
| Sandbox / transport | `supervisor/plugin-supervisor.ts`, `runtime/plugin-host-entry.ts`, `protocol/envelope.ts` | Forked child per plugin, IPC envelopes, permission tables, actor resolution, rate limiting, RSS policing | Intentionally not — this is the security boundary |
| Enforcement | `host/rpc-host.ts` (~1330 lines) | `PluginRpcHost`: builds a per-plugin method map at spawn — a handler is registered **only if the plugin holds the unlocking permission** (registration = authorization). Depends only on the `HostDeps` interface | Neutral — decoupled by design |
| **Wiring** | `host/plugin-host-deps.factory.ts` (was `create-rpc-host.ts`) | Fills the ~130-member `HostDeps` object. Since Option A: an `@Injectable() PluginHostDepsFactory` with the DI-native domain services (`BudgetService`, `ReservationsService`, `TagsService`, `CategoriesService`, `TodoService`, `PluginOAuthService`) constructor-injected; legacy `services/*` domains stay plain function imports until their own migration. Raw `db`/`broadcast` also stay until injectable equivalents exist | **Yes (Option A)** — drains further per §3 |
| Host state | `host/plugin-host-state.ts` | Deliberately module-level (NOT a provider): the per-plugin data-DB map (`getPluginDataDb`/`closePluginDataDb`) and daily broker budgets (`budgetFor`/`pluginBudgetUsage`). Must be one shared instance across host recreations, and is read by `PluginsService`, which the factory imports from — folding it into the injectable would create a provider cycle | Intentionally not |

Key fact that made Option A cheap: the wiring is **called from inside a Nest
provider** — `PluginRuntimeService` binds `hostDeps.create(id, granted, this)`
in its supervisor field initializer (the arrow resolves `this.hostDeps` lazily
at spawn time, so field-initializer ordering is safe). Unlike the MCP handler
(mounted pre-`app.init()`, needs `registry-handoff.ts`), **no handoff seam is
needed here** — plain constructor injection is used.

### The bridge pattern (mostly retired)

`<domain>.bridge.ts` shims existed for one reason: a domain's SQL moved into a
DI-only service and the legacy function module was deleted, but the wiring
layer didn't inject — so a module-level shim re-exported the legacy names over
a hand-built instance. Option A deleted `tags.bridge.ts` and
`categories.bridge.ts` (the plugin host was their only consumer).
**`todo.bridge.ts` survives** for exactly one remaining consumer that genuinely
runs outside the container: the legacy `get_trip_summary` registrar in
`src/mcp/tools/trips.ts`. Delete it when that registrar migrates to the
DI-discovered MCP registry. New bridges should only be added for genuinely
non-Nest consumers (legacy MCP registrars, scheduler, websocket) — the plugin
host no longer needs them, ever.

### What never changes (the invariants)

These are the sandbox. Every option below leaves them untouched:

- One forked child process per plugin; IPC envelope protocol (`req`/`res`/`evt`).
- `protocol/envelope.ts` stays a **zero-runtime-import module** and stays the
  **single source of truth** for `KNOWN_METHODS`, `METHOD_PERMISSION`,
  `KNOWN_PERMISSIONS` (it is loaded by both host and child).
- Registration-is-authorization: an ungranted method is *absent*, not guarded.
- Host-side acting-user resolution (`_inv` map in the supervisor) — a plugin
  can never name an arbitrary user.
- Scrubbed child env, Node `--permission` flags, RSS ceiling, heartbeat
  reaping, crash backoff.
- The error taxonomy (`PERMISSION_DENIED`, `UNKNOWN_METHOD`, `BAD_PARAMS`,
  `RESOURCE_FORBIDDEN`, …) and audit trail.

We also explicitly **rejected** modelling the IPC boundary as a
`@nestjs/microservices` custom transporter ("Option C"): the supervisor's
security model is bespoke and load-bearing, and hiding it behind Nest's
microservice abstractions would obscure the boundary for near-zero payoff.

---

## 2. Option A — inject the wiring layer (DONE, 2026-07)

**What shipped:** `create-rpc-host.ts` became two files:

- `host/plugin-host-deps.factory.ts` — `@Injectable() PluginHostDepsFactory`
  with constructor deps `BudgetService`, `ReservationsService`, `TagsService`,
  `CategoriesService`, `TodoService`, `PluginOAuthService` (the last was
  previously `new`-ed **per call** inside the `getOAuthToken` closure).
  `create(id, granted, router)` returns the `PluginRpcHost` with the same
  ~130-member `HostDeps` object — closures over `this.*` for DI domains, still
  plain imports for legacy `services/*`. `DatabaseService` is deliberately NOT
  injected: after the singletons went away it had zero remaining uses (inline
  SQL uses the raw `db` proxy until those domains migrate).
- `host/plugin-host-state.ts` — the process-wide maps (`dataDbs`, `budgets`)
  and their accessors, kept module-level on purpose (see §1 table).

`PluginRuntimeService` takes the factory as a third, type-optional constructor
param (same convention as `registry?` — tests construct without it, Nest always
injects it) and binds `this.hostDeps.create(id, granted, this)` in the
supervisor field initializer.

**Module wiring:** `TagsModule`/`CategoriesModule`/`BudgetModule`/
`ReservationsModule`/`PackingModule` gained `exports: [XService]` (`TodoModule`
already exported), and `PluginsModule` imports all six. The dependency graph
moved from hidden (bridge files) to explicit (the container). `DatabaseModule`
is `@Global`, so no import needed for it.

**Interaction with the service-migration track:** legacy `services/*` functions
(place, day, files, collab, …) stay as plain imports inside the
factory *until their own domain migrates*. Each future migration then swaps one
import for one injected service (+ module export/import) — **no more bridge
files for the plugin host, ever**. The factory's import list shrinks
monotonically as the recipe in `src/nest/README.md` proceeds (packing and
day-notes swapped in 2026-07; trip-invite migrated without touching the
factory — it was never imported here; assignments swapped in 2026-07; next
factory swap: whichever Wave-3 domain the factory imports migrates next —
shareService/fileService/collabService are all imported here).

### Test impact (as landed)

- `tests/unit/plugins/rpc-host.test.ts` — **unchanged** (constructs
  `PluginRpcHost` directly with hand-built `HostDeps`).
- `tests/unit/plugins/plugin-host-deps.factory.test.ts` (was
  `create-rpc-host.test.ts`) — the six DI-domain path mocks became constructor
  stubs (nine stubs as of the 2026-07 assignments migration); the ~25
  legacy-service path mocks remain; a file-local shim keeps the
  historical `createRealRpcHost(id, granted)` call sites and supplies a default
  no-op router.
- Bridge delegation tests (TAG-SVC-016..020, CAT-SVC-016) — deleted with the
  bridges (owner-scoping etc. already covered by the service-level cases).
- `tests/helpers/plugin-host.ts` — `createPluginRuntime()` builds the runtime
  the way Nest would (real services over the test DB) for the suites that fork
  real plugin children.

---

## 3. Option B — decorator-driven RPC registry (the end state)

**What:** mirror the `@trek/nest-mcp` pilot for the plugin RPC surface.
Per-domain `<domain>.rpc.ts` classes with declarative metadata, discovered at
boot, from which the supervisor builds each plugin's granted method map.

```ts
// nest/tags/tags.rpc.ts (sketch)
@RpcController()
export class TagsRpc {
  constructor(private readonly tags: TagsService) {}

  @RpcMethod({ method: 'tags.list', permission: 'db:read:tags' })
  list(_params: unknown, ctx: RpcCtx) {
    return this.tags.list(requireActor(ctx));
  }
}
```

A registry service (same shape as `McpRegistryService`: `DiscoveryService` +
`MetadataScanner`, `OnModuleInit` scan, fail-fast `validate()`) replaces the
hand-built method map. `PluginRpcHost` shrinks to dispatch + shared resource
gates (`tripRead`, `requireTripEdit`, addon gates) offered as helpers the
domain classes call.

**The one hard constraint:** `envelope.ts` remains the single source of truth.
Decorator metadata inevitably duplicates the method→permission mapping, so the
registry's boot-time `validate()` must assert, fail-fast at app start:

1. every `@RpcMethod` names a method present in `KNOWN_METHODS`;
2. its declared permission **equals** `METHOD_PERMISSION[method]`;
3. every `KNOWN_METHOD` has exactly one handler (no orphans, no duplicates).

That turns today's implicit convention into a checked invariant — a strict
improvement over the status quo, where a table/registration mismatch is only
found by tests (or not at all).

**What does *not* map onto Nest:** the resource gates are not HTTP guards.
There is no request context; the acting user comes from the supervisor's
`_inv` map. Don't force `CanActivate` — keep the gates as plain helpers (or a
thin wrap around dispatch). Option B buys *structure and colocation*, not
Nest's HTTP middleware machinery.

### Pros

- **Kills the compounding cost.** One new plugin capability = one decorated
  method on the domain class + one `envelope.ts` table entry. Today it is six
  edits across two monoliths. Over months-to-years of API growth this is the
  dominant term.
- **One mental model for the whole codebase.** A complete domain becomes
  `x.controller.ts` + `x.service.ts` + `x.mcp.ts` + `x.rpc.ts` + `x.module.ts`
  — same folder, same discovery pattern, same test style as the proven
  nest-mcp pilot. New contributors learn one shape.
- **Dissolves the monoliths.** `plugin-host-deps.factory.ts` disappears; `rpc-host.ts`
  shrinks to a small dispatch core. Per-domain diffs, per-domain tests, less
  merge contention.
- **Boot-time validation** of the method/permission tables (see above).
- **Strangler-compatible.** The registry can coexist with the legacy method
  map exactly like the nest-mcp registry coexists with the legacy tool
  registrars: migrated domains register via decorators, the rest stay in the
  old map until their turn. No big-bang cutover.

### Cons

- **Prerequisites.** Only worth starting once a domain's logic is a DI service;
  doing it before the service migration just wraps legacy function imports in
  decorator dressing. Today only tags and categories qualify.
- **Real up-front build:** the decorator/registry package (or a generalized
  discovery core shared with `nest-mcp`), the validate() logic, a
  `createTestRegistry`-style harness, and migration of the two big test suites
  (`rpc-host.test.ts`'s `HostDeps`-shaped tests do **not** survive this one).
- **Duplication risk** between decorators and `envelope.ts` if validate() is
  skipped or weakened — the mitigation is mandatory, not optional.
- The supervisor/registry seam needs care: method maps are per-plugin
  (filtered by grants at spawn), so the registry must expose
  "build map for grant-set", not a global attach.

### Test impact

- New per-domain RPC test files (mirroring `tools-<domain>.test.ts` on the MCP
  side) + a registry unit suite.
- `rpc-host.test.ts` progressively shrinks to the dispatch core;
  `plugin-host-deps.factory.test.ts` is deleted at the end of the drain.
- Integration suites (`tests/integration/plugins/*`, real fork/IPC) are the
  parity net — they must pass unchanged throughout, same role
  `tests/integration/categories.test.ts` played for the categories migration.

---

## 4. Sequencing (the actual plan)

A is not an alternative to B — **A is the first commit of B's journey**, and
none of it is throwaway.

1. ~~**Now / opportunistically — Option A.**~~ **Done (2026-07).** Injectable
   factory, tags/categories bridges deleted, wiring test rewritten against
   stubs (see §2).
2. **Per domain, as the service migrations proceed** (`packingService`,
   `dayNoteService` and `assignmentService` done 2026-07; `tripInviteService`
   done 2026-07 with no factory impact — it was never imported here; next per
   `src/nest/README.md`): migrate the
   service to DI as usual; the factory swaps one legacy import for one
   injected service. Optionally pilot `tags.rpc.ts` here — tags is small and
   already fully DI on HTTP + MCP.
3. **Once ~half the domains are DI-native — commit to Option B.** Build the
   registry package, validate() against `envelope.ts`, then drain the method
   map domain by domain — the same strangler pattern that retired the Express
   API and is retiring the legacy MCP registrars.
4. **Never — Option C** (Nest microservices transporter over the IPC channel).

### Decision triggers

- ~~**Start A** whenever there's a free session; it has no prerequisites.~~ Done.
- **Start B** when (a) the majority of plugin-facing domains have DI services,
  or (b) the plugin API surface is about to grow significantly (new SDK
  capability wave) — whichever comes first.
- **Stop at A** only if the plugin API is declared frozen: with no method
  growth, B's compounding payoff never materializes.

---

## 5. Key files (for whoever picks this up)

| File | Why it matters |
|---|---|
| `src/nest/plugins/host/plugin-host-deps.factory.ts` | The wiring layer (Option A's product); Option B eventually deletes it |
| `src/nest/plugins/host/plugin-host-state.ts` | Process-wide host state (data-DB map, broker budgets) — module-level on purpose, see §1 |
| `src/nest/plugins/host/rpc-host.ts` | Enforcement core; `HostDeps` interface is the seam A preserved and B drains |
| `src/nest/plugins/protocol/envelope.ts` | Single source of truth for methods/permissions — must stay zero-import; B validates against it |
| `src/nest/plugins/plugin-runtime.service.ts` | The provider that owns the factory call site (supervisor field initializer) |
| `src/nest/plugins/supervisor/plugin-supervisor.ts` | Sandbox lifecycle — untouched by both options |
| `src/nest/todo/todo.bridge.ts` | The one surviving bridge — kept only for the legacy `get_trip_summary` MCP registrar |
| `src/mcp/registry-handoff.ts` | The MCP precedent for non-container code — **not needed here**; documented to explain why |
| `nest-mcp/` (`@trek/nest-mcp`) | The proven decorator/registry/discovery blueprint Option B mirrors |
| `src/nest/README.md` | The per-service DI migration recipe this roadmap rides on |
| `tests/unit/plugins/plugin-host-deps.factory.test.ts` | The wiring suite (bore most of A's one-time test cost) |
| `tests/unit/plugins/rpc-host.test.ts` | Survived A untouched; shrinks under B |
