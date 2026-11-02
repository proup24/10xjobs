import { Injectable, Logger } from '@nestjs/common';

/** USD per token, as OpenRouter lists it. */
export interface Price {
  prompt: number;
  completion: number;
}

/**
 * Per-model prices, loaded at worker startup. A response without a numeric
 * cost is estimated from its tokens, so the daily budget never counts a paid
 * call as free.
 */
@Injectable()
export class ModelPricing {
  private readonly logger = new Logger(ModelPricing.name);
  private readonly prices = new Map<string, Price>();
  private readonly warned = new Set<string>();

  set(prices: Map<string, Price>): void {
    for (const [model, price] of prices) this.prices.set(model, price);
  }

  get(model: string): Price | undefined {
    return this.prices.get(model);
  }

  /** The reported cost, or `inputTokens × prompt + outputTokens × completion`. */
  costOf(
    model: string,
    reported: number | null,
    tokens: { input: number; output: number },
  ): number {
    if (reported !== null) return reported;
    const price = this.prices.get(model);
    if (!this.warned.has(model)) {
      this.warned.add(model);
      this.logger.warn(
        price
          ? `OpenRouter reported no cost for ${model}; estimating it from tokens and list prices`
          : `OpenRouter reported no cost for ${model}, and no price is loaded; counting it as 0`,
      );
    }
    if (!price) return 0;
    return tokens.input * price.prompt + tokens.output * price.completion;
  }
}
