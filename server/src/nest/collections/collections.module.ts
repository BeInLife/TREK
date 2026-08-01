import { Module } from '@nestjs/common';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { CollectionsMcp } from './collections.mcp';
import { CollectionsAddonGuard } from './collections-addon.guard';
import { AddonsModule } from '../addons/addons.module';
import { PermissionsModule } from '../permissions/permissions.module';

/** Collections domain (saved-places library). Registered in AppModule.
 *  Exports CollectionsService for in-container consumers (PluginsModule's
 *  RPC host deps factory). */
@Module({
  imports: [AddonsModule, PermissionsModule],
  controllers: [CollectionsController],
  providers: [CollectionsService, CollectionsMcp, CollectionsAddonGuard],
  exports: [CollectionsService],
})
export class CollectionsModule {}
