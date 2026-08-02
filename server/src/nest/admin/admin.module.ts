import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PluginsModule } from '../plugins/plugins.module';
import { SettingsModule } from '../settings/settings.module';
import { AuditModule } from '../audit/audit.module';
import { AddonsModule } from '../addons/addons.module';
// AuthModule exports PasskeyService for the admin passkey-reset endpoint.
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PluginsModule, SettingsModule, AuditModule, AddonsModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
