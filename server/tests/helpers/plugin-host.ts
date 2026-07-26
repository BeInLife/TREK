import { DatabaseService } from '../../src/nest/database/database.service';
import { PluginRuntimeService } from '../../src/nest/plugins/plugin-runtime.service';
import type { PluginRegistryService } from '../../src/nest/plugins/registry/registry.service';
import { PluginHostDepsFactory } from '../../src/nest/plugins/host/plugin-host-deps.factory';
import { PluginOAuthService } from '../../src/nest/plugins/plugin-oauth.service';
import { BudgetService } from '../../src/nest/budget/budget.service';
import { ReservationsService } from '../../src/nest/reservations/reservations.service';
import { TagsService } from '../../src/nest/tags/tags.service';
import { CategoriesService } from '../../src/nest/categories/categories.service';
import { TodoService } from '../../src/nest/todo/todo.service';
import { PackingService } from '../../src/nest/packing/packing.service';

/**
 * Hand-wired counterpart of the PluginsModule DI graph for no-Nest tests
 * (same pattern as mcp-test-controllers.ts): real domain services over the
 * test DB, so runtime tests exercise the same wiring production gets from
 * the container.
 */
export function createHostDepsFactory(dbs: DatabaseService): PluginHostDepsFactory {
  return new PluginHostDepsFactory(
    new BudgetService(dbs),
    new ReservationsService(dbs),
    new TagsService(dbs),
    new CategoriesService(dbs),
    new TodoService(dbs),
    new PackingService(dbs),
    new PluginOAuthService(dbs),
  );
}

/** A PluginRuntimeService constructed the way Nest would: with a real host-deps factory. */
export function createPluginRuntime(dbs: DatabaseService, registry?: PluginRegistryService): PluginRuntimeService {
  return new PluginRuntimeService(dbs, registry, createHostDepsFactory(dbs));
}
