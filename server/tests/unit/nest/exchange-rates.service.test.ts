/**
 * Unit tests for the DI-native ExchangeRatesService — FX-SVC-001 through
 * FX-SVC-020. New suite: the legacy services/exchangeRateService.ts had no
 * dedicated tests; the budget-domain fold moves it inside the src/nest/**
 * coverage gate. 001–018 pin the fetch/cache/convert behavior byte-for-byte
 * (including the parity quirks: `|| 'EUR'` falsy coercion, stale-cache
 * fallback, the `>1 keys` failure heuristic, silent catch → null); 019–020 pin
 * the exchange-rates.bridge delegation and the module-scoped cache shared
 * between the DI instance and the bridge instance.
 *
 * The rate cache is deliberately MODULE-scoped, so it persists across tests in
 * this file — every case uses its own base currency to stay isolated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExchangeRatesService } from '../../../src/nest/budget/exchange-rates.service';
import { getRates as bridgeGetRates, convertWithRates as bridgeConvertWithRates } from '../../../src/nest/budget/exchange-rates.bridge';

const TTL_MS = 6 * 60 * 60 * 1000; // mirrors the service's 6h TTL

// A minimal Frankfurter-shaped success response (array of { quote, rate }).
const okResponse = (data: unknown) => ({ ok: true, json: async () => data });

const svc = new ExchangeRatesService();

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => okResponse([{ quote: 'USD', rate: 1.08 }]));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ExchangeRatesService.getRates', () => {
  it('FX-SVC-001: falls back to EUR for a falsy base (|| coercion, not ??)', async () => {
    const rates = await svc.getRates('');
    expect(fetchMock).toHaveBeenCalledWith('https://api.frankfurter.dev/v2/rates?base=EUR');
    expect(rates).toEqual({ EUR: 1, USD: 1.08 });
  });

  it('FX-SVC-002: upper-cases the base for the request and the self-rate seed', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([{ quote: 'GBP', rate: 0.85 }]));
    const rates = await svc.getRates('usd');
    expect(fetchMock).toHaveBeenCalledWith('https://api.frankfurter.dev/v2/rates?base=USD');
    expect(rates).toEqual({ USD: 1, GBP: 0.85 });
  });

  it('FX-SVC-003: seeds base = 1, indexes by quote and skips malformed entries', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([
      { quote: 'USD', rate: 1.08 },
      { quote: 'GBP', rate: 0.85 },
      { quote: 42, rate: 1 }, // non-string quote → skipped
      { quote: 'JPY' }, // missing rate → skipped
      null, // null entry → skipped
    ]));
    const rates = await svc.getRates('CHF');
    expect(rates).toEqual({ CHF: 1, USD: 1.08, GBP: 0.85 });
  });

  it('FX-SVC-004: returns null on a non-ok upstream response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => [] });
    expect(await svc.getRates('NOK')).toBeNull();
  });

  it('FX-SVC-005: returns null when the response body is not an array', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ USD: 1.08 }));
    expect(await svc.getRates('SEK')).toBeNull();
  });

  it('FX-SVC-006: returns null when fetch throws (silent catch, no logging)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await svc.getRates('DKK')).toBeNull();
  });

  it('FX-SVC-007: treats a response that yields only the self-rate as failure (>1 keys heuristic)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse([]));
    expect(await svc.getRates('CZK')).toBeNull();
  });

  it('FX-SVC-008: serves the cached rates within the TTL without refetching', async () => {
    const first = await svc.getRates('PLN');
    const second = await svc.getRates('PLN');
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('FX-SVC-009: refetches once the TTL has elapsed', async () => {
    vi.useFakeTimers();
    await svc.getRates('HUF');
    vi.advanceTimersByTime(TTL_MS + 1);
    fetchMock.mockResolvedValueOnce(okResponse([{ quote: 'USD', rate: 1.2 }]));
    const rates = await svc.getRates('HUF');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(rates).toEqual({ HUF: 1, USD: 1.2 });
  });

  it('FX-SVC-010: quirk — falls back to the stale cache (beyond the TTL) when the upstream fails', async () => {
    vi.useFakeTimers();
    const first = await svc.getRates('RON');
    vi.advanceTimersByTime(TTL_MS + 1);
    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(await svc.getRates('RON')).toBe(first);
  });

  it('FX-SVC-011: coalesces concurrent fetches for the same base into one request', async () => {
    let release!: (v: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const a = svc.getRates('ISK');
    const b = svc.getRates('ISK');
    release(okResponse([{ quote: 'USD', rate: 1.08 }]));
    const [ra, rb] = await Promise.all([a, b]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rb).toBe(ra);
  });

  it('FX-SVC-012: returns null on failure when nothing is cached', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => [] });
    expect(await svc.getRates('BGN')).toBeNull();
  });
});

describe('ExchangeRatesService.convertWithRates', () => {
  const rates = { EUR: 1, USD: 1.08, BAD: 0, NEG: -2 };

  it('FX-SVC-013: identity when from equals base (case-insensitive)', () => {
    expect(svc.convertWithRates(10, 'eur', 'EUR', rates)).toBe(10);
  });

  it('FX-SVC-014: identity when the rates map is null', () => {
    expect(svc.convertWithRates(10, 'USD', 'EUR', null)).toBe(10);
  });

  it('FX-SVC-015: a falsy from means "already in base" (|| coercion) → identity', () => {
    expect(svc.convertWithRates(10, null, 'EUR', rates)).toBe(10);
    expect(svc.convertWithRates(10, undefined, 'EUR', rates)).toBe(10);
    expect(svc.convertWithRates(10, '', 'EUR', rates)).toBe(10);
  });

  it('FX-SVC-016: identity when the from-currency has no rate', () => {
    expect(svc.convertWithRates(10, 'JPY', 'EUR', rates)).toBe(10);
  });

  it('FX-SVC-017: identity for a zero or negative rate', () => {
    expect(svc.convertWithRates(10, 'BAD', 'EUR', rates)).toBe(10);
    expect(svc.convertWithRates(10, 'NEG', 'EUR', rates)).toBe(10);
  });

  it('FX-SVC-018: divides by the rate ("units of X per 1 base")', () => {
    expect(svc.convertWithRates(10.8, 'USD', 'EUR', rates)).toBeCloseTo(10);
  });
});

describe('exchange-rates.bridge', () => {
  it('FX-SVC-019: getRates delegates and shares the module-scoped cache with the DI instance', async () => {
    // Prime the cache through the DI-style instance…
    const primed = await svc.getRates('AUD');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // …then the bridge (its own instance) must serve the same cached feed.
    expect(await bridgeGetRates('AUD')).toBe(primed);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('FX-SVC-020: convertWithRates delegates 1:1', () => {
    expect(bridgeConvertWithRates(21.6, 'USD', 'EUR', { EUR: 1, USD: 1.08 })).toBeCloseTo(20);
    expect(bridgeConvertWithRates(5, 'EUR', 'EUR', null)).toBe(5);
  });
});
