import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { PermissionsService } from './permissions.service';

/**
 * Non-Nest entry point for the permissions domain — pinned by the MCP
 * transport's hasTripPermission helper (src/mcp/tools/_shared.ts), which the
 * pre-app.init() MCP/OAuth mount evaluates before the container exists.
 * Inside the container, inject PermissionsService instead. Delete this file
 * when the MCP/OAuth mount moves behind the container.
 *
 * The permissions cache is module-scoped in permissions-cache.ts, so this
 * instance and the container singleton share one cache (backup restores
 * invalidate it through that module directly).
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton.
 */
const permissions = new PermissionsService(new DatabaseService(db));

export function checkPermission(
  actionKey: string,
  userRole: string,
  tripUserId: number | null,
  userId: number,
  isMember: boolean
): boolean {
  return permissions.checkPermission(actionKey, userRole, tripUserId, userId, isMember);
}
