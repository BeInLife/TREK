import { ExchangeRatesService } from './exchange-rates.service';

/**
 * Non-Nest entry point for the exchange-rates fold — for code running OUTSIDE
 * the Nest container (the legacy `services/budgetService.ts` FX-freeze/rebase
 * seams and the legacy `get_settlement_summary` registrar in
 * src/mcp/tools/budget.ts; the plugin RPC host injects ExchangeRatesService via
 * PluginHostDepsFactory). Exports the legacy services/exchangeRateService names
 * 1:1, so repointing a consumer is an import-path-only diff. Inside the
 * container, inject ExchangeRatesService instead.
 * Delete this file when the budgetService migration lands.
 *
 * Module-level construction is safe: the service has no dependencies and no
 * side effects at construction; its rate cache is module-scoped in
 * exchange-rates.service.ts, so this instance and the DI singleton share one
 * cached upstream feed.
 */
const fx = new ExchangeRatesService();

export function getRates(base: string) {
  return fx.getRates(base);
}

/** Unconsumed today (no call sites) — re-exported for 1:1 legacy surface parity. */
export function convertWithRates(
  amount: number,
  from: string | null | undefined,
  base: string,
  rates: Record<string, number> | null,
): number {
  return fx.convertWithRates(amount, from, base, rates);
}
