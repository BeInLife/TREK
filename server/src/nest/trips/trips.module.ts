import { Module } from '@nestjs/common';
import { DaysModule } from '../days/days.module';
import { FilesModule } from '../files/files.module';
import { PackingModule } from '../packing/packing.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { TodoModule } from '../todo/todo.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

/** Trips aggregate root (C1 — Phase 3). Uses exact strangler prefixes so it does
 *  not capture the nested sub-domain mounts (collab, files, ...). */
@Module({
  imports: [TodoModule, PackingModule, FilesModule, ReservationsModule, DaysModule, PermissionsModule],
  controllers: [TripsController],
  providers: [TripsService],
})
export class TripsModule {}
