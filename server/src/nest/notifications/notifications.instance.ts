import { db } from '../../db/database';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MailerService } from './mailer/mailer.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NtfyService } from './transports/ntfy.service';
import { WebhookService } from './transports/webhook.service';
import { NotificationsService } from './notifications.service';

/**
 * The out-of-container NotificationsService, for the bridges that hand-build
 * their collaborators (trips.bridge and airtrail.bridge — the permanent
 * cycle-dodges; this file lives exactly as long as either does). The reminder
 * crons that used to reach it through a dedicated send bridge inject the
 * container singleton now (ReminderJobsService); that bridge is gone.
 *
 * One instance, module-scoped, because the channel registry is: the built-ins
 * registered in the constructor and the channels the plugin runtime pushes in
 * have to be visible on every path. A second copy would silence plugin channels
 * for whichever caller got it.
 *
 * Module-level construction is safe: `db` is the reinitialize-proof Proxy onto
 * the shared better-sqlite3 singleton.
 */
const dbs = new DatabaseService(db);
const mailer = new MailerService(dbs);
const notifications = new NotificationsService(
  dbs,
  new RealtimeService(),
  mailer,
  new WebhookService(dbs),
  new NtfyService(dbs),
  new NotificationPreferencesService(dbs, mailer),
);

export function notificationsInstance(): NotificationsService {
  return notifications;
}
