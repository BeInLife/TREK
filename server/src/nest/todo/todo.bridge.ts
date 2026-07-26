import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { TodoService } from './todo.service';

/**
 * Non-Nest entry point for the todo domain — for code running OUTSIDE the
 * Nest container (the plugin RPC host and the legacy get_trip_summary
 * registrar in src/mcp/tools/trips.ts; the todo MCP tools and resource moved
 * to the DI-discovered todo.mcp.ts). Exports only the legacy
 * services/todoService names still consumed outside the container, 1:1, so
 * repointing a consumer is an import-path-only diff. Inside the container,
 * inject TodoService instead.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton (same pattern as categories.bridge.ts).
 */
const todos = new TodoService(new DatabaseService(db));

export function listItems(tripId: string | number) {
  return todos.listItems(tripId);
}

export function createItem(tripId: string | number, data: Parameters<TodoService['createItem']>[1]) {
  return todos.createItem(tripId, data);
}

export function updateItem(
  tripId: string | number,
  id: string | number,
  data: Parameters<TodoService['updateItem']>[2],
  bodyKeys: string[]
) {
  return todos.updateItem(tripId, id, data, bodyKeys);
}

export function deleteItem(tripId: string | number, id: string | number): boolean {
  return todos.deleteItem(tripId, id);
}
