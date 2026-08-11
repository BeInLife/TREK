import { db } from '../../db/database';
import { JourneyDomainService } from '../journey/journey-domain.service';
import { TrekPhotosRepository } from '../photos/trek-photos.repository';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PermissionsService } from '../permissions/permissions.service';
import { QueryHelpersService } from '../query-helpers/query-helpers.service';
import { UnsplashService } from '../unsplash/unsplash.service';
import { PlacePhotoCacheService } from '../place-photos/place-photo-cache.service';
import { RuntimeEnvService } from '../app-config/runtime-env.service';
import { TripsService } from './trips.service';
import { TodoService } from '../todo/todo.service';
import { PackingService } from '../packing/packing.service';
import { FilesService } from '../files/files.service';
import { ReservationsService } from '../reservations/reservations.service';
import { DaysService } from '../days/days.service';
import { BudgetService } from '../budget/budget.service';
import { ExchangeRatesService } from '../budget/exchange-rates.service';
import { CollabService } from '../collab/collab.service';
import { VacayService } from '../vacay/vacay.service';
import { PlacesService } from '../places/places.service';
import { MapsService } from '../maps/maps.service';
import { UserCleanupService } from '../auth/user-cleanup.service';
import { AccommodationsService } from '../accommodations/accommodations.service';
import { TripMembersService } from '../trip-members/trip-members.service';
import { TripReadModelService } from '../trip-read-model/trip-read-model.service';
import { notificationsInstance } from '../notifications/notifications.instance';
import { EphemeralTokenService } from '../auth/ephemeral-token.service';

/**
 * Verified-permanent cycle-dodge for the trip domain. Three in-container
 * consumers cannot inject the backing services: budget.mcp.ts (getTripOwner /
 * listMembers / getTripSummary), packing.mcp.ts (getTripSummary) and
 * costs.rpc.ts (listTripsForUser). Every direction was checked 2026-08-11 and
 * every one closes a real module cycle — TripsModule imports BudgetModule and
 * PackingModule, TripReadModelModule imports both, and TripMembersModule
 * imports BudgetModule, so none of TripsService, TripReadModelService or
 * TripMembersService can be injected into the budget/packing surfaces without
 * forwardRef. Exports only what those three consume, 1:1. Everything else
 * injects the services. This file dies if the trip read model ever stops
 * importing the budget/packing domains, not before.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton.
 */
const dbs = () => new DatabaseService(db);
// One instance, not one per consumer: the in-flight dedup only works if the
// stampede guard is shared (see PlacePhotoCacheService).
const photoCache = new PlacePhotoCacheService(dbs(), new RuntimeEnvService());
const journeyDomain = new JourneyDomainService(dbs(), new RealtimeService(), new TrekPhotosRepository(dbs()));
const budget = new BudgetService(dbs(), new PermissionsService(dbs()), new ExchangeRatesService(), new RealtimeService());
const permissions = new PermissionsService(dbs());
const realtime = new RealtimeService();
const days = new DaysService(dbs(), permissions, realtime, new QueryHelpersService(dbs()));
const accommodations = new AccommodationsService(dbs(), permissions, realtime);
const reservations = new ReservationsService(dbs(), permissions, budget, realtime, notificationsInstance());
const places = new PlacesService(dbs(), permissions, realtime, new MapsService(dbs(), photoCache), new QueryHelpersService(dbs()), new UnsplashService(dbs(), new RuntimeEnvService()), photoCache, journeyDomain);
const trips = new TripsService(
  dbs(),
  reservations,
  days,
  permissions,
  budget,
  new VacayService(dbs(), realtime, notificationsInstance()),
  realtime,
  new UnsplashService(dbs(), new RuntimeEnvService()),
);
const members = new TripMembersService(dbs(), budget, new UserCleanupService(dbs(), budget), permissions, realtime, notificationsInstance());
const readModel = new TripReadModelService(
  dbs(),
  members,
  days,
  accommodations,
  budget,
  new PackingService(dbs(), permissions, realtime, notificationsInstance()),
  reservations,
  new CollabService(dbs(), permissions, realtime, notificationsInstance()),
  places,
  new TodoService(dbs(), permissions, realtime),
  new FilesService(dbs(), permissions, realtime, new EphemeralTokenService()),
);

export function getTripOwner(tripId: string | number) {
  return trips.getOwner(tripId);
}

export function listMembers(tripId: string | number, tripOwnerId: number) {
  return members.listMembers(tripId, tripOwnerId);
}

export function getTripSummary(tripId: number, viewerUserId?: number) {
  return readModel.getTripSummary(tripId, viewerUserId);
}

/**
 * Every trip the user can access. Used by CostsRpc for the cross-trip cost feed:
 * BudgetModule cannot import TripsModule, because TripsModule already imports
 * BudgetModule, and injecting it would need a forwardRef'd cycle. Same reason
 * budget.mcp.ts reaches for this file.
 */
export function listTripsForUser(userId: number) {
  return trips.list(userId, null) as Array<{ id: number }>;
}
