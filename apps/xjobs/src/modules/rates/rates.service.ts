import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ISO_4217 } from 'src/modules/facts/rules/currency';
import {
  RATES_FETCH_TIMEOUT_MS,
  RATES_SOURCE_URL,
} from './config/rates.config';
import { RatesRepository } from './rates.repository';

/** Nest injection token for the fetch function; tests stub it, production uses the global. */
export const RATES_FETCH = Symbol('RATES_FETCH');

/** Keeps the daily rates fresh; on any failure the last good rows stay. */
@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);

  constructor(
    private readonly repo: RatesRepository,
    @Optional()
    @Inject(RATES_FETCH)
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** Whether the table holds any rate. */
  async hasRates(): Promise<boolean> {
    return (await this.repo.all()).size > 0;
  }

  /** Fetches the source and upserts the ISO 4217 rates; never throws. */
  async refresh(): Promise<{ updated: number }> {
    try {
      const response = await this.fetchFn(RATES_SOURCE_URL, {
        signal: AbortSignal.timeout(RATES_FETCH_TIMEOUT_MS),
      });
      if (!response.ok)
        throw new Error(`rates source answered HTTP ${response.status}`);
      const body = (await response.json()) as {
        result?: unknown;
        rates?: unknown;
      };
      if (body.result !== 'success')
        throw new Error(`rates source result was ${String(body.result)}`);
      if (typeof body.rates !== 'object' || body.rates === null)
        throw new Error('rates source returned no rates');
      const rates = new Map<string, number>();
      for (const [code, value] of Object.entries(body.rates)) {
        if (
          ISO_4217.has(code) &&
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value > 0
        )
          rates.set(code, value);
      }
      await this.repo.upsertMany(rates);
      return { updated: rates.size };
    } catch (error) {
      this.logger.warn(
        `Rates refresh failed, keeping the last rates: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { updated: 0 };
    }
  }
}
