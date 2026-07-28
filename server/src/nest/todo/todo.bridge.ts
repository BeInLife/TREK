import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TodoService } from './todo.service';
import { PermissionsService } from '../permissions/permissions.service';

/**
 * Non-Nest entry point for the todo domain — for code running OUTSIDE the
 * Nest container (the legacy get_trip_summary registrar in
 * src/mcp/tools/trips.ts; the todo MCP tools and resource moved to the
 * DI-discovered todo.mcp.ts, and the plugin RPC host injects TodoService via
 * PluginHostDepsFactory). Exports only the legacy services/todoService names
 * still consumed outside the container, 1:1, so repointing a consumer is an
 * import-path-only diff. Inside the container, inject TodoService instead.
 * Delete this file when the legacy MCP trips registrar migrates.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton.
 */
const todos = new TodoService(new DatabaseService(db), new PermissionsService(new DatabaseService(db)), new RealtimeService());

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
