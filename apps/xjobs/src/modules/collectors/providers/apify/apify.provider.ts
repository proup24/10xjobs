import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getApifyToken, type EnvironmentVariables } from 'src/config';

@Injectable()
export class ApifyActorProvider {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async run(
    actor: string,
    input: Record<string, unknown>,
    maxChargeUsd: number,
  ): Promise<unknown[]> {
    const token = getApifyToken(this.config);
    const url = `https://api.apify.com/v2/acts/${actor.replace('/', '~')}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&maxTotalChargeUsd=${maxChargeUsd}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(
        `Apify actor ${actor} failed with HTTP ${response.status}`,
      );
    const payload: unknown = await response.json();
    if (!Array.isArray(payload))
      throw new Error(`Apify actor ${actor} returned a non-array dataset`);
    return payload;
  }
}
