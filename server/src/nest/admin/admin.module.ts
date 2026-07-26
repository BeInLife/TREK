import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PluginsModule } from '../plugins/plugins.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PluginsModule, SettingsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
