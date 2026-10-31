import { Injectable } from '@nestjs/common';

@Injectable()
export class GreenhousePostingProvider {
  async fetch(url: string): Promise<unknown> {
    const parsed = new URL(url);
    if (!/(^|\.)greenhouse\.io$/i.test(parsed.hostname))
      throw new Error('Unsupported Greenhouse posting URL');
    const match = /\/(?:embed\/)?([^/]+)\/jobs\/(\d+)/.exec(parsed.pathname);
    if (!match)
      throw new Error('Greenhouse URL does not identify a board posting');
    const response = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(match[1]!)}/jobs/${match[2]}?content=true`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (response.status === 404)
      throw new Error('Greenhouse posting is closed or unavailable');
    if (!response.ok)
      throw new Error(`Greenhouse API returned HTTP ${response.status}`);
    return response.json();
  }
}
