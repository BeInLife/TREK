import { createTestRegistry, type McpRegistry } from '@trek/nest-mcp';
import { db } from '../../src/db/database';
import { trekMcpAccessPolicy, trekMcpValidateAccess } from '../../src/mcp/nest-mcp-policy';
import { AssignmentsMcp } from '../../src/nest/assignments/assignments.mcp';
import { AssignmentsService } from '../../src/nest/assignments/assignments.service';
import { BudgetMcp } from '../../src/nest/budget/budget.mcp';
import { BudgetService } from '../../src/nest/budget/budget.service';
import { ExchangeRatesService } from '../../src/nest/budget/exchange-rates.service';
import { CategoriesMcp } from '../../src/nest/categories/categories.mcp';
import { CategoriesService } from '../../src/nest/categories/categories.service';
import { CollabMcp } from '../../src/nest/collab/collab.mcp';
import { CollabService } from '../../src/nest/collab/collab.service';
import { DatabaseService } from '../../src/nest/database/database.service';
import { DayNotesMcp } from '../../src/nest/days/day-notes.mcp';
import { DayNotesService } from '../../src/nest/days/day-notes.service';
import { DaysMcp } from '../../src/nest/days/days.mcp';
import { DaysService } from '../../src/nest/days/days.service';
import { PackingMcp } from '../../src/nest/packing/packing.mcp';
import { PackingService } from '../../src/nest/packing/packing.service';
import { PermissionsService } from '../../src/nest/permissions/permissions.service';
import { ReservationsMcp } from '../../src/nest/reservations/reservations.mcp';
import { ReservationsService } from '../../src/nest/reservations/reservations.service';
import { TagsMcp } from '../../src/nest/tags/tags.mcp';
import { TagsService } from '../../src/nest/tags/tags.service';
import { TodoMcp } from '../../src/nest/todo/todo.mcp';
import { TodoService } from '../../src/nest/todo/todo.service';
import { VacayMcp } from '../../src/nest/vacay/vacay.mcp';
import { VacayService } from '../../src/nest/vacay/vacay.service';
import { RealtimeService } from '../../src/nest/realtime/realtime.service';

/**
 * Hand-wired counterpart of the boot-time discovery in McpRegistryService,
 * for the no-Nest MCP harness. One line per migrated domain — add the new
 * @McpController instance here when a domain moves off the legacy registrar
 * fan-out. Constructing against the `db` Proxy keeps per-file vi.mock's of
 * src/db/database flowing through (same pattern as todo.bridge.ts).
 */
export function createMcpTestRegistry(): McpRegistry {
  const dbService = new DatabaseService(db);
  const permissionsService = new PermissionsService(dbService);
  const realtimeService = new RealtimeService();
  const daysService = new DaysService(dbService, permissionsService, realtimeService);
  const exchangeRatesService = new ExchangeRatesService();
  const budgetService = new BudgetService(dbService, permissionsService, exchangeRatesService, realtimeService);
  return createTestRegistry(
    [
      new TagsMcp(new TagsService(dbService)),
      new CategoriesMcp(new CategoriesService(dbService)),
      new TodoMcp(new TodoService(dbService, permissionsService, realtimeService)),
      new PackingMcp(new PackingService(dbService, permissionsService, realtimeService)),
      new BudgetMcp(budgetService, exchangeRatesService, dbService),
      new ReservationsMcp(new ReservationsService(dbService, permissionsService, budgetService, realtimeService), daysService, budgetService),
      new DayNotesMcp(new DayNotesService(dbService, permissionsService, realtimeService)),
      new DaysMcp(daysService, dbService),
      new AssignmentsMcp(new AssignmentsService(dbService, permissionsService, realtimeService), daysService),
      new CollabMcp(new CollabService(dbService, permissionsService, realtimeService)),
      new VacayMcp(new VacayService(dbService, realtimeService)),
    ],
    { accessPolicy: trekMcpAccessPolicy, validateAccess: trekMcpValidateAccess },
  );
}
