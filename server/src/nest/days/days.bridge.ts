import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { DaysService, addDays } from './days.service';

/**
 * Non-Nest entry point for the day domain — for code running OUTSIDE the
 * Nest container (the legacy services/tripService.ts and the legacy
 * transit/transports MCP registrars in src/mcp/tools/; the day MCP tools and
 * resources moved to the DI-discovered days.mcp.ts, and the plugin RPC host
 * injects DaysService via PluginHostDepsFactory). Exports only the legacy
 * services/dayService names still consumed outside the container, 1:1, so
 * repointing a consumer is an import-path-only diff. Inside the container,
 * inject DaysService instead. Delete this file when tripService and the
 * transit/transports registrars migrate.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton.
 */
const days = new DaysService(new DatabaseService(db));

export { addDays };

export function getDay(id: string | number, tripId: string | number) {
  return days.getDay(id, tripId);
}

export function listDays(tripId: string | number) {
  return days.list(tripId);
}

export function listAccommodations(tripId: string | number) {
  return days.listAccommodations(tripId);
}

export function restampReservationDates(
  tripId: string | number,
  oldDateById: Map<number, string | null>,
  newDateById: Map<number, string | null>,
): void {
  days.restampReservationDates(tripId, oldDateById, newDateById);
}

export function resyncAccommodationDays(
  tripId: string | number,
  prevDateByDayId: Map<number, string | null>,
): void {
  days.resyncAccommodationDays(tripId, prevDateByDayId);
}
