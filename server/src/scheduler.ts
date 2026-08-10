import cron, { type ScheduledTask } from 'node-cron';
import { readEnv } from './app-config';
import { logInfo, logError } from './nest/audit/audit-log.logger';

/**
 * What the scheduler needs from the Nest container.
 *
 * The shapes are structural on purpose: the scheduler names the capability it
 * wants, never the provider class — importing a provider class here would pull
 * its module graph into a file that must stay loadable without a container
 * (which is what the unit tests rely on).
 *
 * index.ts fills this in from the container after buildApp(), the way
 * bootstrap.ts hands the /mcp handler its registry. Nothing here is resolved at
 * import time.
 */
export interface SchedulerDeps {
  placePhotos: { sweepOrphans(): number };
  airtrail: { runAirtrailSync(): Promise<void> };
}

let deps: SchedulerDeps | undefined;

/** Hand the scheduler its container-resolved dependencies. Call after app.init(). */
export function setSchedulerDeps(next: SchedulerDeps): void {
  deps = next;
}

// Demo mode: hourly reset of demo user data
let demoTask: ScheduledTask | null = null;

function startDemoReset(): void {
  if (demoTask) { demoTask.stop(); demoTask = null; }
  if (!readEnv().demo.enabled) return;

  demoTask = cron.schedule('0 * * * *', () => {
    try {
      const { resetDemoUser } = require('./demo/demo-reset');
      resetDemoUser();
    } catch (err: unknown) {
      logError(`Demo reset: ${err instanceof Error ? err.message : err}`);
    }
  });
  logInfo('Demo hourly reset scheduled');
}

// Version check: daily at 9 AM — notify admins if a new TREK release is available
let versionCheckTask: ScheduledTask | null = null;

function startVersionCheck(): void {
  if (versionCheckTask) { versionCheckTask.stop(); versionCheckTask = null; }

  const tz = readEnv().app.tz || 'UTC';
  versionCheckTask = cron.schedule('0 9 * * *', async () => {
    try {
      const { checkAndNotifyVersion } = require('./nest/admin/admin.bridge');
      await checkAndNotifyVersion();
    } catch (err: unknown) {
      logError(`Version check: ${err instanceof Error ? err.message : err}`);
    }
  }, { timezone: tz });
}

// Idempotency key cleanup: nightly at 3 AM — delete keys past their TTL.
// The TTL must exceed any realistic offline window: the TREK client replays
// queued mutations with their X-Idempotency-Key when it reconnects, so a key
// GC'd before the device comes back online would let the replay create a
// duplicate. 24h was far too short for a multi-day offline trip; default 30d,
// overridable via IDEMPOTENCY_TTL_SECONDS (default lives in app-config).
let idempotencyCleanupTask: ScheduledTask | null = null;

function idempotencyTtlSeconds(): number {
  return readEnv().session.idempotencyTtlSeconds;
}

interface PurgeDb {
  prepare(sql: string): { run(...args: unknown[]): { changes: number } };
}

/** Delete idempotency keys older than the configured TTL. Returns rows removed.
 *  The db is injectable for testing; the cron job uses the default. */
function purgeExpiredIdempotencyKeys(
  now: number = Date.now(),
  ttlSeconds: number = idempotencyTtlSeconds(),
  database: PurgeDb = require('./db/database').db,
): number {
  const cutoff = Math.floor(now / 1000) - ttlSeconds;
  const result = database.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(cutoff);
  return result.changes;
}

function startIdempotencyCleanup(): void {
  if (idempotencyCleanupTask) { idempotencyCleanupTask.stop(); idempotencyCleanupTask = null; }

  const tz = readEnv().app.tz || 'UTC';
  idempotencyCleanupTask = cron.schedule('0 3 * * *', () => {
    try {
      const removed = purgeExpiredIdempotencyKeys();
      if (removed > 0) {
        logInfo(`Idempotency cleanup: removed ${removed} expired key(s)`);
      }
    } catch (err: unknown) {
      logError(`Idempotency cleanup: ${err instanceof Error ? err.message : err}`);
    }
  }, { timezone: tz });
}

// Trek photo cache cleanup: every 2 hours — evict disk files and DB rows past their 1h TTL
/**
 * The cache sweep, reached from outside the container.
 *
 * Constructed per call rather than injected: the cron runs before/independently
 * of any request, and the service holds no state of its own — the stampede
 * guard it does own is a module-scoped Map, deliberately shared with the
 * container instance. Required lazily so a boot without the nest graph (some
 * tests) does not pull it in.
 */
function sweepTrekPhotoCache(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TrekPhotoCacheService } = require('./nest/memories/trek-photo-cache.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseService } = require('./nest/database/database.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { db } = require('./db/database');
  new TrekPhotoCacheService(new DatabaseService(db)).sweepExpired();
}

let trekPhotoCacheTask: ScheduledTask | null = null;

function startTrekPhotoCacheCleanup(): void {
  if (trekPhotoCacheTask) { trekPhotoCacheTask.stop(); trekPhotoCacheTask = null; }

  // Run once immediately on startup to evict any entries left over from a previous run
  try {
    sweepTrekPhotoCache();
  } catch { /* cache dir may not exist yet — harmless */ }

  trekPhotoCacheTask = cron.schedule('0 */2 * * *', () => {
    try {
      sweepTrekPhotoCache();
    } catch (err: unknown) {
      logError(`Trek photo cache cleanup: ${err instanceof Error ? err.message : err}`);
    }
  });
}

// Place-photo (Google/Wikimedia) cache cleanup: nightly — reclaim cached files and
// meta rows no place references anymore (deleted places/trips, overwritten image_url).
let placePhotoCacheTask: ScheduledTask | null = null;

function startPlacePhotoCacheCleanup(): void {
  if (placePhotoCacheTask) { placePhotoCacheTask.stop(); placePhotoCacheTask = null; }

  const sweep = () => {
    try {
      if (!deps) {
        logError('Place-photo cache cleanup: skipped, the scheduler was started without its container dependencies');
        return;
      }
      const removed = deps.placePhotos.sweepOrphans();
      if (removed > 0) logInfo(`Place-photo cache cleanup: removed ${removed} orphaned file(s)/row(s)`);
    } catch (err: unknown) {
      logError(`Place-photo cache cleanup: ${err instanceof Error ? err.message : err}`);
    }
  };

  // Run once on startup to reclaim orphans left over from before this sweeper existed.
  sweep();

  const tz = readEnv().app.tz || 'UTC';
  placePhotoCacheTask = cron.schedule('30 3 * * *', sweep, { timezone: tz });
}

// AirTrail sync: poll connected instances on an interval and reconcile linked
// flights both ways (#214). The per-tick enable gate (addon + setting) lives in
// runAirtrailSync, so toggling the addon takes effect without a restart.
let airtrailSyncTask: ScheduledTask | null = null;

function startAirTrailSync(): void {
  if (airtrailSyncTask) { airtrailSyncTask.stop(); airtrailSyncTask = null; }

  const { db } = require('./db/database');
  const getSetting = (key: string) => (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  const raw = parseInt(getSetting('airtrail_poll_interval_minutes') || '5', 10);
  const minutes = Number.isFinite(raw) && raw >= 1 && raw <= 59 ? raw : 5;
  const tz = readEnv().app.tz || 'UTC';
  logInfo(`AirTrail sync: scheduled every ${minutes}m`);

  airtrailSyncTask = cron.schedule(`*/${minutes} * * * *`, async () => {
    try {
      if (!deps) {
        logError('AirTrail sync: skipped, the scheduler was started without its container dependencies');
        return;
      }
      await deps.airtrail.runAirtrailSync();
    } catch (err: unknown) {
      logError(`AirTrail sync tick failed: ${err instanceof Error ? err.message : err}`);
    }
  }, { timezone: tz });
}

function stop(): void {
  if (demoTask) { demoTask.stop(); demoTask = null; }
  if (versionCheckTask) { versionCheckTask.stop(); versionCheckTask = null; }
  if (idempotencyCleanupTask) { idempotencyCleanupTask.stop(); idempotencyCleanupTask = null; }
  if (trekPhotoCacheTask) { trekPhotoCacheTask.stop(); trekPhotoCacheTask = null; }
  if (placePhotoCacheTask) { placePhotoCacheTask.stop(); placePhotoCacheTask = null; }
  if (airtrailSyncTask) { airtrailSyncTask.stop(); airtrailSyncTask = null; }
}

export { stop, startDemoReset, startVersionCheck, startIdempotencyCleanup, purgeExpiredIdempotencyKeys, startTrekPhotoCacheCleanup, startPlacePhotoCacheCleanup, startAirTrailSync };
