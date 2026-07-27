import { Module } from '@nestjs/common';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';
import { ExchangeRatesService } from './exchange-rates.service';
import { PermissionsModule } from '../permissions/permissions.module';

/** Budget domain (S4 — Phase 2 trip sub-domain). Registered in AppModule. */
@Module({
  imports: [PermissionsModule],
  controllers: [BudgetController],
  providers: [BudgetService, ExchangeRatesService],
  // For in-container consumers (PluginHostDepsFactory).
  exports: [BudgetService, ExchangeRatesService],
})
export class BudgetModule {}
