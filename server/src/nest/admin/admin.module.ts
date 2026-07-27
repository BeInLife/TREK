import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PluginsModule } from '../plugins/plugins.module';
import { SettingsModule } from '../settings/settings.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PluginsModule, SettingsModule, AuditModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
