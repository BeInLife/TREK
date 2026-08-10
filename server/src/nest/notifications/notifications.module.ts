import { Module } from '@nestjs/common';
import { AdminNotificationPreferencesController, NotificationsController } from './notifications.controller';
import { NotificationsMcp } from './notifications.mcp';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { ReminderJobsService } from './reminder-jobs.service';
import { NtfyService } from './transports/ntfy.service';
import { WebhookService } from './transports/webhook.service';
import { MailerModule } from './mailer/mailer.module';
import { AuthModule } from '../auth/auth.module';
import { SchedulingModule } from '../scheduling/scheduling.module';

/** Notifications domain (L6 leaf module). Registered in AppModule.
 *  AuthModule feeds NotificationsMcp's demo gate; MailerModule carries SMTP,
 *  which lives outside this module so AuthService can send the password-reset
 *  mail without AuthModule and NotificationsModule importing each other.
 *  NotificationsService and NotificationPreferencesService are exported for
 *  in-container consumers (AdminController's dev test send and preferences tab,
 *  the plugin RPC surface, HostSurfaceRpc). */
@Module({
  imports: [AuthModule, MailerModule, SchedulingModule],
  controllers: [NotificationsController, AdminNotificationPreferencesController],
  providers: [NotificationsService, NotificationPreferencesService, WebhookService, NtfyService, NotificationsMcp, ReminderJobsService],
  exports: [NotificationsService, NotificationPreferencesService],
})
export class NotificationsModule {}
