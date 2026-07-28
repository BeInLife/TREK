import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import { BudgetService } from './budget.service';
import { PermissionsService } from '../permissions/permissions.service';
import { ExchangeRatesService } from './exchange-rates.service';

/**
 * Non-Nest entry point for the budget domain — for code running OUTSIDE the
 * Nest container (the legacy services/tripService.ts and
 * services/userCleanupService.ts, and the legacy update_trip / create_transport
 * registrars in src/mcp/tools/trips.ts and src/mcp/tools/transports.ts; the
 * budget MCP tools and resources moved to the DI-discovered budget.mcp.ts, and
 * the plugin RPC host injects BudgetService via PluginHostDepsFactory).
 * Exports only the legacy services/budgetService names still consumed outside
 * the container, 1:1, so repointing a consumer is an import-path-only diff.
 * Inside the container, inject BudgetService instead. Delete this file when
 * tripService/userCleanupService and the legacy MCP registrars migrate.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton, and ExchangeRatesService keeps its FX
 * cache module-scoped on purpose so this instance and the DI singleton share
 * one cache.
 */
const budget = new BudgetService(new DatabaseService(db), new PermissionsService(new DatabaseService(db)), new ExchangeRatesService(), new RealtimeService());

export function listBudgetItems(tripId: string | number) {
  return budget.listBudgetItems(tripId);
}

export function removeUserFromBudgetItems(userId: number): void {
  budget.removeUserFromBudgetItems(userId);
}

export function rebaseTripCurrency(tripId: string | number, newCurrency: string | null | undefined): Promise<void> {
  return budget.rebaseTripCurrency(tripId, newCurrency);
}

export function linkBudgetItemToReservation(
  tripId: string | number,
  reservationId: number,
  data: Parameters<BudgetService['linkBudgetItemToReservation']>[2],
) {
  return budget.linkBudgetItemToReservation(tripId, reservationId, data);
}
