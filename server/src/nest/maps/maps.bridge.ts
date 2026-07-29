import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { MapsService } from './maps.service';

/**
 * Non-Nest entry point for the maps domain — for code running OUTSIDE the Nest
 * container (the legacy placeService's placeEnrichment helper and the legacy
 * places MCP registrar in src/mcp/tools/places.ts; the geo MCP tools moved to
 * the DI-discovered maps.mcp.ts, and transitService's User-Agent comes from the
 * pure maps.helpers.ts). Exports only the legacy services/mapsService names
 * still consumed outside the container, 1:1, so repointing a consumer is an
 * import-path-only diff. Inside the container, inject MapsService instead.
 * Delete this file when the place domain migrates.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton.
 */
const maps = new MapsService(new DatabaseService(db));

export function getMapsKey(userId: number) {
  return maps.getMapsKey(userId);
}

export function searchPlaces(
  userId: number,
  query: string,
  lang?: string,
  locationBias?: { lat: number; lng: number; radius?: number },
) {
  return maps.searchPlaces(userId, query, lang, locationBias);
}

export function getPlacePhoto(userId: number, placeId: string, lat: number, lng: number, name?: string) {
  return maps.getPlacePhoto(userId, placeId, lat, lng, name);
}
