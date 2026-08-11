import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AssignmentsService } from './assignments.service';
import { PermissionsService } from '../permissions/permissions.service';
import { QueryHelpersService } from '../query-helpers/query-helpers.service';
import { JourneyDomainService } from '../journey/journey-domain.service';
import { TrekPhotosRepository } from '../photos/trek-photos.repository';

/**
 * Verified-permanent cycle-dodge for the assignments domain. The one consumer
 * is places.mcp.ts, and the cycle is real: DaysModule → PlacesModule →
 * AssignmentsModule → DaysModule, so PlacesModule cannot import
 * AssignmentsModule back (see the note in places.mcp.ts). Everything else —
 * the DI-discovered assignments.mcp.ts, the plugin RPC surface, ItineraryRpc,
 * the controllers — injects AssignmentsService. Only the two exports
 * places.mcp.ts consumes survive; this file dies if that module cycle is ever
 * broken (e.g. an assignments read-model split), not before.
 *
 * The instance is built lazily on first call, NOT at module scope: the
 * consumer is an in-container module evaluated during container assembly, so
 * a module-level `new AssignmentsService` would crash with an uninitialized
 * class binding if an import edge ever forms a cycle through here. By the
 * time any bridge function is called, all modules have finished evaluating.
 * (`db` is the reinitialize-proof Proxy onto the shared better-sqlite3
 * singleton.)
 */
function journeyDomain(): JourneyDomainService {
  const dbs = new DatabaseService(db);
  return new JourneyDomainService(dbs, new RealtimeService(), new TrekPhotosRepository(dbs));
}

let instance: AssignmentsService | undefined;
function assignments(): AssignmentsService {
  return (instance ??= new AssignmentsService(new DatabaseService(db), new PermissionsService(new DatabaseService(db)), new RealtimeService(), new QueryHelpersService(new DatabaseService(db)), journeyDomain()));
}

export function createAssignment(dayId: string | number, placeId: string | number, notes: string | null) {
  return assignments().createAssignment(dayId, placeId, notes);
}

export function dayExists(dayId: string | number, tripId: string | number) {
  return assignments().dayExists(dayId, tripId);
}
