import type { Category } from '@trek/shared';
import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { CategoriesService } from './categories.service';

/**
 * Non-Nest entry point for the categories domain — for code running OUTSIDE
 * the Nest container (currently only the plugin RPC host; the MCP tool and
 * resource moved to the DI-discovered categories.mcp.ts). Exports only the
 * legacy services/categoryService names still consumed outside the container,
 * 1:1, so repointing a consumer is an import-path-only diff. Inside the
 * container, inject CategoriesService instead.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton (same pattern as tags.bridge.ts).
 */
const categories = new CategoriesService(new DatabaseService(db));

export function listCategories(): Category[] {
  return categories.list();
}
