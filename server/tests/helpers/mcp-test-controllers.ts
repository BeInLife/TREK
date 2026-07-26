import { createTestRegistry, type McpRegistry } from '@trek/nest-mcp';
import { db } from '../../src/db/database';
import { trekMcpAccessPolicy } from '../../src/mcp/nest-mcp-policy';
import { AssignmentsMcp } from '../../src/nest/assignments/assignments.mcp';
import { AssignmentsService } from '../../src/nest/assignments/assignments.service';
import { CategoriesMcp } from '../../src/nest/categories/categories.mcp';
import { CategoriesService } from '../../src/nest/categories/categories.service';
import { DatabaseService } from '../../src/nest/database/database.service';
import { DayNotesMcp } from '../../src/nest/days/day-notes.mcp';
import { DayNotesService } from '../../src/nest/days/day-notes.service';
import { PackingMcp } from '../../src/nest/packing/packing.mcp';
import { PackingService } from '../../src/nest/packing/packing.service';
import { TagsMcp } from '../../src/nest/tags/tags.mcp';
import { TagsService } from '../../src/nest/tags/tags.service';
import { TodoMcp } from '../../src/nest/todo/todo.mcp';
import { TodoService } from '../../src/nest/todo/todo.service';

/**
 * Hand-wired counterpart of the boot-time discovery in McpRegistryService,
 * for the no-Nest MCP harness. One line per migrated domain — add the new
 * @McpController instance here when a domain moves off the legacy registrar
 * fan-out. Constructing against the `db` Proxy keeps per-file vi.mock's of
 * src/db/database flowing through (same pattern as todo.bridge.ts).
 */
export function createMcpTestRegistry(): McpRegistry {
  const dbService = new DatabaseService(db);
  return createTestRegistry(
    [
      new TagsMcp(new TagsService(dbService)),
      new CategoriesMcp(new CategoriesService(dbService)),
      new TodoMcp(new TodoService(dbService)),
      new PackingMcp(new PackingService(dbService)),
      new DayNotesMcp(new DayNotesService(dbService)),
      new AssignmentsMcp(new AssignmentsService(dbService)),
    ],
    { accessPolicy: trekMcpAccessPolicy },
  );
}
