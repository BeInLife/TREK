Recommended order

Wave 1 — pilots (establish the template on easy wins)

1. tagService (26 lines, zero deps, only consumers: TagsModule + 1 MCP tool) — the ideal first migration. Small enough that the whole pattern fits in one PR: move the SQL into TagsService with injected DatabaseService, retire the
   legacy file, convert its tests to overrideProvider(DATABASE_CONNECTION).
2. categoryService (31 lines, same shape) — immediate repeat to confirm the template.
3. todoService (120 lines, classic CRUD with transactions + broadcast) — first "full-shaped" domain: prepared statements, db.transaction, WebSocket broadcast, 3 MCP tools. After this one, the recipe is settled for everything else.

The pilots deliberately include MCP consumers, because they force the one open design decision early: MCP tools run outside the Nest container, so either the migrated module keeps thin function exports delegating to a shared instance,
or the MCP layer gets a handle to the Nest app (app.get(TodoService)). Better to settle that on a 26-line service than on authService.

Wave 2 — cross-cutting leverage (parallel to wave 3, high payoff)

4. permissions (149 lines, zero deps, 17 Nest consumers) → an injectable PermissionsService. Every module wrapper already calls checkPermission; this converts the single most-imported seam in one move.
5. auditLog (171 lines, 13 Nest consumers) → AuditService.
6. tripAccess (9 lines) — don't migrate, delete: it's a wrapper around canAccessTrip, which DatabaseService now exposes. Absorb its 11 call sites opportunistically.

Wave 3 — domain services with existing modules, low fan-in

7. dayNoteService (done 2026-07), tripInviteService (done 2026-07), assignmentService (done 2026-07), shareService (done 2026-07), settingsService (done 2026-07), fileService (done 2026-07), collabService (done 2026-07), packingService (done 2026-07) — each maps 1:1 to a Nest module that's already a thin delegate; none is imported by more than one
   other legacy service.

Wave 4 — the coupled cluster (order matters here)

8. dayService → budgetService → reservationService in that order: reservations depend on both (budget-item linking, day resolution), so migrating the dependencies first lets ReservationsService inject the finished versions instead of
   importing legacy functions.
9. Then placeService (7 internal deps, mostly on things migrated by now) and tripService (10 deps — the biggest hub; last in this wave, since nearly everything it needs will already be injectable).

Wave 5 — the heavyweights, last

10. adminService (14 Nest + 11 MCP consumers), journeyService/atlasService/vacayService/collectionsService/mapsService (big but self-contained), and finally the auth stack (authService at 1494 lines with 18 MCP consumers, plus
    oauthService/oidcService/passkeyService) — highest risk, most consumers, security-sensitive; do it when the pattern is thoroughly proven. backupService also stays late: it owns closeDb/reinitialize lifecycle, which is deliberately
    outside the DI wrapper.

Two special cases to keep in mind: airportService is lazily required by db/database.ts at boot (the flight-endpoint backfill) — whenever it migrates, that call should move into Nest's bootstrap instead, or you recreate the circular
import; and notifications/notificationService are imported by 6+ other services, so like the wave-4 cluster they should migrate before their dependents or keep function shims in the interim.

The through-line: each finished migration lets that domain's tests drop vi.mock('db/database') for overrideProvider(DATABASE_CONNECTION), so the mock seam shrinks wave by wave and disappears with the auth stack. Want me to start on
tagService as the pilot?

