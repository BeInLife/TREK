import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { ShareService } from './share.service';
import type { SharePermissions } from './share.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Non-Nest entry point for the share domain — for code running OUTSIDE the
 * Nest container (the legacy share-link tools in src/mcp/tools/trips.ts; those
 * stay in the trips registrar because their `trips:share` scope gate has no
 * declarative `access: { group, mode }` equivalent yet). Exports only the
 * legacy services/shareService names still consumed outside the container,
 * 1:1, so repointing a consumer is an import-path-only diff. Inside the
 * container, inject ShareService instead.
 * Delete this file when the legacy MCP trips registrar migrates.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton.
 */
const share = new ShareService(new DatabaseService(db), new SettingsService(new DatabaseService(db)));

export function createOrUpdateShareLink(tripId: string, createdBy: number, permissions: SharePermissions) {
  return share.createOrUpdate(tripId, createdBy, permissions);
}

export function getShareLink(tripId: string) {
  return share.get(tripId);
}

export function deleteShareLink(tripId: string) {
  return share.remove(tripId);
}
