import { Module } from '@nestjs/common';
import { CollabController } from './collab.controller';
import { CollabService } from './collab.service';
import { CollabMcp } from './collab.mcp';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [PermissionsModule],
  controllers: [CollabController],
  providers: [CollabService, CollabMcp],
  // For in-container consumers (PluginHostDepsFactory).
  exports: [CollabService],
})
export class CollabModule {}
