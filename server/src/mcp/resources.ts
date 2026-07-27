import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp';
import { canAccessTrip } from '../db/database';
import { listTrips, getTrip, getTripOwner, listMembers } from '../services/tripService';
import { listDays, listAccommodations } from '../services/dayService';
import { listPlaces } from '../services/placeService';
import { listBudgetItems, getPerPersonSummary, calculateSettlement } from '../services/budgetService';
import { listBucketList, listVisitedCountries, getStats as getAtlasStats, listManuallyVisitedRegions } from '../services/atlasService';
import { getNotifications } from '../services/inAppNotifications';
import { isAddonEnabled } from '../services/adminService';
import { ADDON_IDS } from '../addons';
import { canAccessJourney, getJourneyFull, listEntries, listJourneys } from '../services/journeyService';
import { canRead, canReadTrips } from './scopes';

function parseId(value: string | string[]): number | null {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function accessDenied(uri: string) {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ error: 'Trip not found or access denied' }),
    }],
  };
}

function scopeDenied(uri: string) {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ error: 'Insufficient OAuth scope to access this resource' }),
    }],
  };
}

function jsonContent(uri: string, data: unknown) {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(data, null, 2),
    }],
  };
}

export function registerResources(server: McpServer, userId: number, scopes: string[] | null): void {
  // List all accessible trips
  if (canReadTrips(scopes)) server.registerResource(
    'trips',
    'trek://trips',
    { description: 'All trips the user owns or is a member of', mimeType: 'application/json' },
    async (uri) => {
      const trips = listTrips(userId, 0);
      return jsonContent(uri.href, trips);
    }
  );

  // Single trip detail
  if (canReadTrips(scopes)) server.registerResource(
    'trip',
    new ResourceTemplate('trek://trips/{tripId}', { list: undefined }),
    { description: 'A single trip with metadata and member count', mimeType: 'application/json' },
    async (uri, { tripId }) => {
      const id = parseId(tripId);
      if (id === null || !canAccessTrip(id, userId)) return accessDenied(uri.href);
      const trip = getTrip(id, userId);
      return jsonContent(uri.href, trip);
    }
  );

  // Days with assigned places
  if (canReadTrips(scopes)) server.registerResource(
    'trip-days',
    new ResourceTemplate('trek://trips/{tripId}/days', { list: undefined }),
    { description: 'Days of a trip with their assigned places', mimeType: 'application/json' },
    async (uri, { tripId }) => {
      const id = parseId(tripId);
      if (id === null || !canAccessTrip(id, userId)) return accessDenied(uri.href);

      const { days } = listDays(id);
      return jsonContent(uri.href, days);
    }
  );

  // Places in a trip
  if (canRead(scopes, 'places')) server.registerResource(
    'trip-places',
    new ResourceTemplate('trek://trips/{tripId}/places', { list: undefined }),
    { description: 'All places/POIs in a trip, optionally filtered by assignment status (e.g. ?assignment=unassigned)', mimeType: 'application/json' },
    async (uri, { tripId }) => {
      const id = parseId(tripId);
      if (id === null || !canAccessTrip(id, userId)) return accessDenied(uri.href);
      const assignment = uri.searchParams.get('assignment') as 'all' | 'unassigned' | 'assigned' | null;
      const places = listPlaces(String(id), { assignment: assignment ?? undefined });
      return jsonContent(uri.href, places);
    }
  );

  // Budget items
  if (isAddonEnabled(ADDON_IDS.BUDGET) && canRead(scopes, 'budget')) server.registerResource(
    'trip-budget',
    new ResourceTemplate('trek://trips/{tripId}/budget', { list: undefined }),
    { description: 'Budget and expense items for a trip', mimeType: 'application/json' },
    async (uri, { tripId }) => {
      const id = parseId(tripId);
      if (id === null || !canAccessTrip(id, userId)) return accessDenied(uri.href);
      const items = listBudgetItems(id);
      return jsonContent(uri.href, items);
    }
  );

  // The trip-packing resource moved to the DI-discovered
  // src/nest/packing/packing.mcp.ts (@ResourceTemplate).

  // The trip-reservations resource moved to the DI-discovered
  // src/nest/reservations/reservations.mcp.ts (@ResourceTemplate).

  // The day-notes resource moved to the DI-discovered
  // src/nest/days/day-notes.mcp.ts (@ResourceTemplate).

  // Accommodations (hotels, rentals) per trip
  if (canReadTrips(scopes)) server.registerResource(
    'trip-accommodations',
    new ResourceTemplate('trek://trips/{tripId}/accommodations', { list: undefined }),
    { description: 'Accommodations (hotels, rentals) for a trip with check-in/out details', mimeType: 'application/json' },
    async (uri, { tripId }) => {
      const id = parseId(tripId);
      if (id === null || !canAccessTrip(id, userId)) return accessDenied(uri.href);
      const accommodations = listAccommodations(id);
      return jsonContent(uri.href, accommodations);
    }
  );

  // Trip members (owner + collaborators)
  if (canReadTrips(scopes)) server.registerResource(
    'trip-members',
    new ResourceTemplate('trek://trips/{tripId}/members', { list: undefined }),
    { description: 'Owner and collaborators of a trip', mimeType: 'application/json' },
    async (uri, { tripId }) => {
      const id = parseId(tripId);
      if (id === null || !canAccessTrip(id, userId)) return accessDenied(uri.href);
      const ownerRow = getTripOwner(id);
      if (!ownerRow) return accessDenied(uri.href);
      const { owner, members } = listMembers(id, ownerRow.user_id);
      return jsonContent(uri.href, { owner, members });
    }
  );

  // The trek://trips/{tripId}/collab-notes, …/collab/polls and …/collab/messages
  // resources moved to the DI-discovered src/nest/collab/collab.mcp.ts
  // (@ResourceTemplate, attached via the nest-mcp registry in registerTools).

  // The trek://trips/{tripId}/todos resource moved to the DI-discovered
  // src/nest/todo/todo.mcp.ts (@ResourceTemplate, attached via the nest-mcp
  // registry in registerTools).

  // The trek://categories resource moved to the DI-discovered
  // src/nest/categories/categories.mcp.ts (@Resource, attached via the
  // nest-mcp registry in registerTools).

  // User's bucket list
  if (isAddonEnabled(ADDON_IDS.ATLAS) && canRead(scopes, 'atlas')) server.registerResource(
    'bucket-list',
    'trek://bucket-list',
    { description: 'Your personal travel bucket list', mimeType: 'application/json' },
    async (uri) => {
      const items = listBucketList(userId);
      return jsonContent(uri.href, items);
    }
  );

  // User's visited countries
  if (isAddonEnabled(ADDON_IDS.ATLAS) && canRead(scopes, 'atlas')) server.registerResource(
    'visited-countries',
    'trek://visited-countries',
    { description: 'Countries you have marked as visited in Atlas', mimeType: 'application/json' },
    async (uri) => {
      const countries = listVisitedCountries(userId);
      return jsonContent(uri.href, countries);
    }
  );

  // Budget per-person summary
  if (isAddonEnabled(ADDON_IDS.BUDGET) && canRead(scopes, 'budget')) server.registerResource(
    'trip-budget-per-person',
    new ResourceTemplate('trek://trips/{tripId}/budget/per-person', { list: undefined }),
    { description: 'Per-person budget summary for a trip (total spent per member, split breakdown)', mimeType: 'application/json' },
    async (uri, { tripId }) => {
      const id = parseId(tripId);
      if (id === null || !canAccessTrip(id, userId)) return accessDenied(uri.href);
      const summary = getPerPersonSummary(id);
      return jsonContent(uri.href, summary);
    }
  );

  // Budget settlement
  if (isAddonEnabled(ADDON_IDS.BUDGET) && canRead(scopes, 'budget')) server.registerResource(
    'trip-budget-settlement',
    new ResourceTemplate('trek://trips/{tripId}/budget/settlement', { list: undefined }),
    { description: 'Suggested settlement transactions to balance who owes whom', mimeType: 'application/json' },
    async (uri, { tripId }) => {
      const id = parseId(tripId);
      if (id === null || !canAccessTrip(id, userId)) return accessDenied(uri.href);
      const settlement = calculateSettlement(id);
      return jsonContent(uri.href, settlement);
    }
  );

  // The trip-packing-bags resource moved to the DI-discovered
  // src/nest/packing/packing.mcp.ts (@ResourceTemplate).

  // In-app notifications
  if (canRead(scopes, 'notifications')) server.registerResource(
    'notifications-in-app',
    'trek://notifications/in-app',
    { description: "The current user's in-app notifications (most recent 50, unread first)", mimeType: 'application/json' },
    async (uri) => {
      const result = getNotifications(userId, { limit: 50 });
      return jsonContent(uri.href, result);
    }
  );

  // Atlas stats and regions (addon-gated)
  if (isAddonEnabled(ADDON_IDS.ATLAS) && canRead(scopes, 'atlas')) {
    server.registerResource(
      'atlas-stats',
      'trek://atlas/stats',
      { description: "User's atlas statistics — visited country counts and breakdown", mimeType: 'application/json' },
      async (uri) => {
        const stats = await getAtlasStats(userId);
        return jsonContent(uri.href, stats);
      }
    );

    server.registerResource(
      'atlas-regions',
      'trek://atlas/regions',
      { description: 'List of manually visited regions for the current user', mimeType: 'application/json' },
      async (uri) => {
        const regions = listManuallyVisitedRegions(userId);
        return jsonContent(uri.href, regions);
      }
    );
  }

  // The vacay resources moved to the DI-discovered src/nest/vacay/vacay.mcp.ts
  // (@McpController, attached via the nest-mcp registry in tools.ts).

  // Journey resources (Journey addon)
  if (isAddonEnabled(ADDON_IDS.JOURNEY) && canRead(scopes, 'journey')) {
    server.registerResource(
      'journeys',
      'trek://journeys',
      { description: 'All journeys owned or contributed to by the current user', mimeType: 'application/json' },
      async (uri) => {
        const journeys = listJourneys(userId);
        return jsonContent(uri.href, journeys);
      }
    );

    server.registerResource(
      'journey-detail',
      new ResourceTemplate('trek://journeys/{journeyId}', { list: undefined }),
      { description: 'Single journey with entries, contributors, and trip links', mimeType: 'application/json' },
      async (uri, { journeyId }) => {
        const id = parseId(journeyId);
        if (id === null) return accessDenied(uri.href);
        const journey = getJourneyFull(id, userId);
        if (!journey) return accessDenied(uri.href);
        return jsonContent(uri.href, journey);
      }
    );

    server.registerResource(
      'journey-entries',
      new ResourceTemplate('trek://journeys/{journeyId}/entries', { list: undefined }),
      { description: 'All entries in a journey (date, text, mood, linked trip)', mimeType: 'application/json' },
      async (uri, { journeyId }) => {
        const id = parseId(journeyId);
        if (id === null) return accessDenied(uri.href);
        const j = canAccessJourney(id, userId);
        if (!j) return accessDenied(uri.href);
        const entries = listEntries(id, userId);
        return jsonContent(uri.href, entries);
      }
    );

    server.registerResource(
      'journey-contributors',
      new ResourceTemplate('trek://journeys/{journeyId}/contributors', { list: undefined }),
      { description: 'Contributors (owners and collaborators) of a journey', mimeType: 'application/json' },
      async (uri, { journeyId }) => {
        const id = parseId(journeyId);
        if (id === null) return accessDenied(uri.href);
        const j = getJourneyFull(id, userId);
        if (!j) return accessDenied(uri.href);
        return jsonContent(uri.href, (j as any).contributors ?? []);
      }
    );
  }
}
