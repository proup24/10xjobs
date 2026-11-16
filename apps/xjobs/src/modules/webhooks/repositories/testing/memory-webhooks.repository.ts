import type { Labels } from '@xjobs/database/matches';
import type { PayloadInput } from '../../payload/build';
import { WebhooksRepository } from '../webhooks.repository';

/** In-memory WebhooksRepository for unit tests. */
export class MemoryWebhooksRepository extends WebhooksRepository {
  inputs = new Map<string, PayloadInput>();
  samples = new Map<string, PayloadInput>();
  labels: Labels = {
    positions: [],
    seniorities: [],
    techs: [],
    countries: [],
    regions: [],
    cities: [],
    languages: [],
    currencies: [],
    contractTypes: [],
  };

  loadPayloadInput(deliveryId: string): Promise<PayloadInput | null> {
    return Promise.resolve(this.inputs.get(deliveryId) ?? null);
  }

  loadLabels(): Promise<Labels> {
    return Promise.resolve(this.labels);
  }

  latestQualifiedForUser(userId: string): Promise<PayloadInput | null> {
    return Promise.resolve(this.samples.get(userId) ?? null);
  }
}
