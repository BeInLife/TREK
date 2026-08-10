/**
 * Retired. Every cron moved into its owning Nest domain, scheduled through
 * CronRegistrarService (src/nest/scheduling/):
 *
 *   auto-backup          → nest/backup/auto-backup.job.ts
 *   trip/todo reminders  → nest/notifications/reminder-jobs.service.ts
 *   version check        → nest/admin/version-check.job.ts
 *   demo reset           → nest/admin/demo-reset.job.ts
 *   idempotency purge    → nest/common/idempotency-cleanup.job.ts
 *   trek-photo sweep     → nest/memories/trek-photo-cache.job.ts
 *   place-photo sweep    → nest/place-photos/place-photo-cache.job.ts
 *   airtrail poll        → nest/integrations/airtrail-sync.job.ts
 *
 * Only this shutdown no-op remains for index.ts; the file is deleted next.
 */
function stop(): void {
  // Nest owns every job now — nestApp.close() stops them via the registrar.
}

export { stop };
