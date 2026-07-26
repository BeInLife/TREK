import { Module } from '@nestjs/common';
import { TripShareController, SharedController } from './share.controller';
import { ShareService } from './share.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [TripShareController, SharedController],
  providers: [ShareService],
})
export class ShareModule {}
