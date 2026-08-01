import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { AtlasService } from './atlas.service';

/**
 * Non-Nest entry point for the atlas domain — for code running OUTSIDE the
 * Nest container. Sole consumer today: the legacy services/authService
 * (getTravelStats resolves reservation endpoints to countries and subtracts
 * the user's hidden ones). The atlas MCP tools and resources moved to the
 * DI-discovered atlas.mcp.ts, and the plugin RPC host injects AtlasService,
 * so neither needs this. Exports only the legacy services/atlasService names
 * authService still consumes, 1:1, so the repoint is an import-path-only
 * diff. Inside the container, inject AtlasService instead. Delete this file
 * when authService migrates.
 *
 * getCountryFromCoords is pure geo (no DB) and re-exported straight from the
 * atlas-geo helper module; its poly/box indexes are module-scoped there, so
 * this entry point and the container share one copy (#1576).
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton (same pattern as permissions.bridge.ts).
 */
const atlas = new AtlasService(new DatabaseService(db));

export { getCountryFromCoords } from './atlas-geo';

export function getHiddenCountries(userId: number): Set<string> {
  return atlas.getHiddenCountries(userId);
}
