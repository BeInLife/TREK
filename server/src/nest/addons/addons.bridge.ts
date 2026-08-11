import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { AddonsService } from './addons.service';

/**
 * Non-Nest entry point for the addons domain — pinned by the MCP/OAuth
 * transport (src/mcp/index.ts) and the pre-init platform.routes Express
 * router, both mounted BEFORE app.init(), so the container is not available
 * to them; systemNotices/conditions.ts reads it too until its enablement
 * check is threaded in from the DI side. Inside the container, inject
 * AddonsService instead (the `when:` gates in *.mcp.ts files do, via
 * addon-gate.ts). Delete this file when the MCP/OAuth mount moves behind the
 * container.
 *
 * Only the enablement READ is bridged, as an uncached per-call query on
 * purpose: admin toggles must stay immediately visible without invalidation
 * wiring.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton.
 */
const addons = new AddonsService(new DatabaseService(db));

export function isAddonEnabled(addonId: string): boolean {
  return addons.isAddonEnabled(addonId);
}
