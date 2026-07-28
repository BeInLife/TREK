import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CollabService } from './collab.service';
import { PermissionsService } from '../permissions/permissions.service';

/**
 * Non-Nest entry point for the collab domain — for code running OUTSIDE the
 * Nest container (the legacy trip-summary builder in src/services/tripService.ts
 * and the legacy get_trip_summary registrar in src/mcp/tools/trips.ts; the
 * collab MCP tools and resources moved to the DI-discovered collab.mcp.ts, and
 * the plugin RPC host injects CollabService via PluginHostDepsFactory). Exports
 * only the legacy services/collabService names still consumed outside the
 * container, 1:1, so repointing a consumer is an import-path-only diff. Inside
 * the container, inject CollabService instead. Delete this file when
 * tripService and the legacy MCP trips registrar migrate.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton.
 */
const collab = new CollabService(new DatabaseService(db), new PermissionsService(new DatabaseService(db)), new RealtimeService());

export function listNotes(tripId: string | number) {
  return collab.listNotes(tripId);
}

export function listPolls(tripId: string | number) {
  return collab.listPolls(tripId);
}

export function countMessages(tripId: string | number): number {
  return collab.countMessages(tripId);
}
