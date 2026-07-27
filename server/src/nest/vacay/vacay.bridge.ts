import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { VacayService } from './vacay.service';

/**
 * Non-Nest entry point for the vacay domain — for code running OUTSIDE the
 * Nest container (the legacy services/tripService.ts, which shifts a trip
 * owner's vacation entries when the trip window moves; the vacay MCP tools and
 * resources moved to the DI-discovered vacay.mcp.ts, and the plugin RPC host
 * injects VacayService via PluginHostDepsFactory). Exports only the legacy
 * services/vacayService names still consumed outside the container, 1:1, so
 * repointing a consumer is an import-path-only diff. Inside the container,
 * inject VacayService instead. Delete this file when tripService migrates.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton.
 */
const vacay = new VacayService(new DatabaseService(db));

export function shiftOwnerEntriesForTripWindow(
  ownerId: number,
  oldStart: string,
  oldEnd: string,
  newStart: string
): void {
  return vacay.shiftOwnerEntriesForTripWindow(ownerId, oldStart, oldEnd, newStart);
}
