Recommended order

Wave 1 — pilots (establish the template on easy wins)

1. tagService (26 lines, zero deps, only consumers: TagsModule + 1 MCP tool) — the ideal first migration. Small enough that the whole pattern fits in one PR: move the SQL into TagsService with injected DatabaseService, retire the
   legacy file, convert its tests to overrideProvider(DATABASE_CONNECTION).
2. categoryService (31 lines, same shape) — immediate repeat to confirm the template.
3. todoService (120 lines, classic CRUD with transactions + broadcast) — first "full-shaped" domain: prepared statements, db.transaction, WebSocket broadcast, 3 MCP tools. After this one, the recipe is settled for everything else.

The pilots deliberately include MCP consumers, because they force the one open design decision early: MCP tools run outside the Nest container, so either the migrated module keeps thin function exports delegating to a shared instance,
or the MCP layer gets a handle to the Nest app (app.get(TodoService)). Better to settle that on a 26-line service than on authService.

Wave 2 — cross-cutting leverage (parallel to wave 3, high payoff)

4. permissions (149 lines, zero deps, 17 Nest consumers) → an injectable PermissionsService (done 2026-07 — every module wrapper, the airtrail-import controller and PluginHostDepsFactory now inject it; the cache stays module-scoped so the DI singleton and permissions.bridge — kept for mcp/_shared.ts + adminService/authService/backupService/collectionsService — share one invalidation). Every module wrapper already calls checkPermission; this converts the single most-imported seam in one move.
5. auditLog (171 lines, 13 Nest consumers) → AuditService (done 2026-07 — writeAudit is the injectable; getClientIp and the log*/LOG_LEVEL logger stay plain modules in nest/audit/ (client-ip.ts, audit-log.logger.ts with its frozen-at-import level + mkdir as a documented parity exception); audit.bridge covers mcp/index, oauthProvider and the legacy airtrail/immich/oauth services).
6. tripAccess (9 lines) — don't migrate, delete: it's a wrapper around canAccessTrip, which DatabaseService now exposes. Absorb its 11 call sites opportunistically.

Wave 3 — domain services with existing modules, low fan-in

7. dayNoteService (done 2026-07), tripInviteService (done 2026-07), assignmentService (done 2026-07), shareService (done 2026-07), settingsService (done 2026-07), fileService (done 2026-07), collabService (done 2026-07), packingService (done 2026-07) — each maps 1:1 to a Nest module that's already a thin delegate; none is imported by more than one
   other legacy service.

Wave 4 — the coupled cluster (order matters here)

8. dayService → budgetService → reservationService in that order: reservations depend on both (budget-item linking, day resolution), so migrating the dependencies first lets ReservationsService inject the finished versions instead of
   importing legacy functions. — **Correction (migration-graph.md, borne out by the migration): the claimed ordering constraint doesn't exist at the service layer.** reservationService (done 2026-07) imported neither budgetService nor
   dayService; the budget/day coupling lives in the Nest wrapper's budget-sync seam and the MCP registrars, which keep their legacy imports until those domains migrate. Reservations went first as the frontier residue fold; dayService
   (done 2026-07 — the 592-line service folded into the wrapper `DaysService`, the accommodations seam in `nest/reservations/` now injects it, and the hand-rolled reorder/insert transactions became `db.transaction()`) followed;
   budgetService is next in the cluster (the Wave-2 permissions + auditLog pair is done 2026-07; the exchangeRateService fold that precedes it per migration-graph.md is done 2026-07 — folded into `nest/budget/` as the dep-free `ExchangeRatesService`, injected by `BudgetService` and `PluginHostDepsFactory`, with `exchange-rates.bridge.ts` covering the legacy budgetService FX seams and the mcp budget registrar — so budgetService is now frontier-ready).
9. Then placeService (7 internal deps, mostly on things migrated by now) and tripService (10 deps — the biggest hub; last in this wave, since nearly everything it needs will already be injectable).

Wave 5 — the heavyweights, last

10. adminService (14 Nest + 11 MCP consumers), journeyService/atlasService/vacayService (done 2026-07 — pulled forward as a zero-dependency frontier member, see migration-graph.md)/collectionsService/mapsService (big but self-contained), and finally the auth stack (authService at 1494 lines with 18 MCP consumers, plus
    oauthService/oidcService/passkeyService) — highest risk, most consumers, security-sensitive; do it when the pattern is thoroughly proven. backupService also stays late: it owns closeDb/reinitialize lifecycle, which is deliberately
    outside the DI wrapper.

Two special cases to keep in mind: airportService is lazily required by db/database.ts at boot (the flight-endpoint backfill) — whenever it migrates, that call should move into Nest's bootstrap instead, or you recreate the circular
import; and notifications/notificationService are imported by 6+ other services, so like the wave-4 cluster they should migrate before their dependents or keep function shims in the interim.

The through-line: each finished migration lets that domain's tests drop vi.mock('db/database') for overrideProvider(DATABASE_CONNECTION), so the mock seam shrinks wave by wave and disappears with the auth stack. Want me to start on
tagService as the pilot?

