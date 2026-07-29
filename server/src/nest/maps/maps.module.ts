import { Module } from '@nestjs/common';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';
import { MapsMcp } from './maps.mcp';

/**
 * Maps / geo domain (L3 leaf module). Registered in AppModule. Exports
 * MapsService for the in-container consumers (BookingImportModule's Nominatim
 * geocoding); out-of-container code goes through maps.bridge.ts.
 */
@Module({
  controllers: [MapsController],
  providers: [MapsService, MapsMcp],
  exports: [MapsService],
})
export class MapsModule {}
