import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { PackingModule } from '../packing/packing.module';
import { TodoModule } from '../todo/todo.module';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

/** Trips aggregate root (C1 — Phase 3). Uses exact strangler prefixes so it does
 *  not capture the nested sub-domain mounts (collab, files, ...). */
@Module({
  imports: [TodoModule, PackingModule, FilesModule],
  controllers: [TripsController],
  providers: [TripsService],
})
export class TripsModule {}
