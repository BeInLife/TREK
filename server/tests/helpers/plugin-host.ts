import { DatabaseService } from '../../src/nest/database/database.service';
import { PluginRuntimeService } from '../../src/nest/plugins/plugin-runtime.service';
import type { PluginRegistryService } from '../../src/nest/plugins/registry/registry.service';
import { PluginHostDepsFactory } from '../../src/nest/plugins/host/plugin-host-deps.factory';
import { PluginOAuthService } from '../../src/nest/plugins/plugin-oauth.service';
import { BudgetService } from '../../src/nest/budget/budget.service';
import { ExchangeRatesService } from '../../src/nest/budget/exchange-rates.service';
import { ReservationsService } from '../../src/nest/reservations/reservations.service';
import { TagsService } from '../../src/nest/tags/tags.service';
import { CategoriesService } from '../../src/nest/categories/categories.service';
import { TodoService } from '../../src/nest/todo/todo.service';
import { PackingService } from '../../src/nest/packing/packing.service';
import { DayNotesService } from '../../src/nest/days/day-notes.service';
import { DaysService } from '../../src/nest/days/days.service';
import { AssignmentsService } from '../../src/nest/assignments/assignments.service';
import { LlmConfigResolver } from '../../src/nest/llm-parse/llm-config.resolver';
import { SettingsService } from '../../src/nest/settings/settings.service';
import { FilesService } from '../../src/nest/files/files.service';
import { CollabService } from '../../src/nest/collab/collab.service';
import { VacayService } from '../../src/nest/vacay/vacay.service';
import { PermissionsService } from '../../src/nest/permissions/permissions.service';
import { AuditService } from '../../src/nest/audit/audit.service';
import { AddonsService } from '../../src/nest/addons/addons.service';

/**
 * Hand-wired counterpart of the PluginsModule DI graph for no-Nest tests
 * (same pattern as mcp-test-controllers.ts): real domain services over the
 * test DB, so runtime tests exercise the same wiring production gets from
 * the container.
 */
export function createHostDepsFactory(dbs: DatabaseService): PluginHostDepsFactory {
  const permissions = new PermissionsService(dbs);
  const exchangeRates = new ExchangeRatesService();
  const budget = new BudgetService(dbs, permissions, exchangeRates);
  const addons = new AddonsService(dbs);
  return new PluginHostDepsFactory(
    budget,
    new ReservationsService(dbs, permissions, budget),
    new TagsService(dbs),
    new CategoriesService(dbs),
    new TodoService(dbs, permissions),
    new PackingService(dbs, permissions),
    new PluginOAuthService(dbs),
    new DayNotesService(dbs, permissions),
    new AssignmentsService(dbs, permissions),
    new LlmConfigResolver(new SettingsService(dbs), dbs, addons),
    dbs,
    new FilesService(dbs, permissions),
    new CollabService(dbs, permissions),
    new VacayService(dbs),
    new DaysService(dbs, permissions),
    permissions,
    exchangeRates,
    addons,
  );
}

/** A PluginRuntimeService constructed the way Nest would: with a real host-deps factory. */
export function createPluginRuntime(dbs: DatabaseService, registry?: PluginRegistryService): PluginRuntimeService {
  return new PluginRuntimeService(dbs, new AuditService(dbs), new AddonsService(dbs), registry, createHostDepsFactory(dbs));
}
