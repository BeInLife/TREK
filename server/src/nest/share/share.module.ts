import { Module } from '@nestjs/common';
import { TripShareController, SharedController } from './share.controller';
import { ShareService } from './share.service';
import { SettingsModule } from '../settings/settings.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [SettingsModule, PermissionsModule],
  controllers: [TripShareController, SharedController],
  providers: [ShareService],
})
export class ShareModule {}
