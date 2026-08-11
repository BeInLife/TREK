import { Module } from '@nestjs/common';
import { AddonsModule } from '../addons/addons.module';
import { SystemNoticesController } from './system-notices.controller';
import { SystemNoticesService } from './system-notices.service';

/** System-notices domain. Registered in AppModule. */
@Module({
  imports: [AddonsModule],
  controllers: [SystemNoticesController],
  providers: [SystemNoticesService],
})
export class SystemNoticesModule {}
