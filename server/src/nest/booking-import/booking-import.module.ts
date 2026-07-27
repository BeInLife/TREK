import { Module } from '@nestjs/common';
import { BookingImportController } from './booking-import.controller';
import { BookingImportService } from './booking-import.service';
import { ImportJobsService } from './import-jobs.service';
import { KitineraryExtractorService } from './kitinerary-extractor.service';
import { FeaturesController } from './features.controller';
import { LlmParseModule } from '../llm-parse/llm-parse.module';
import { ReservationsModule } from '../reservations/reservations.module';

@Module({
  imports: [LlmParseModule, ReservationsModule],
  controllers: [BookingImportController, FeaturesController],
  providers: [BookingImportService, KitineraryExtractorService, ImportJobsService],
})
export class BookingImportModule {}
