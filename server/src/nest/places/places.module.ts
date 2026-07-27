import { Module } from '@nestjs/common';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';
import { PermissionsModule } from '../permissions/permissions.module';

/** Places domain (S8 — Phase 2 trip sub-domain). Depends on L4 Categories + L5 Tags. */
@Module({
  imports: [PermissionsModule],
  controllers: [PlacesController],
  providers: [PlacesService],
})
export class PlacesModule {}
