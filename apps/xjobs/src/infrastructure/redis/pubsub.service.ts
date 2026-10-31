import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { RedisConfig } from 'src/config';
import { REDIS_SETTINGS } from './settings.module';
import { RedisConnections } from './connections';

type Listener = (message: unknown) => void | Promise<void>;

@Injectable()
export class PubSubService implements OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);
  private readonly listeners = new Map<string, Set<Listener>>();
  // Serialize subscription mutations, including concurrent unsubscribe/resubscribe.
  private subscriptionChange: Promise<unknown> = Promise.resolve();

  constructor(
    @Inject(RedisConnections) private readonly connections: RedisConnections,
    @Inject(REDIS_SETTINGS) private readonly settings: RedisConfig,
  ) {
    this.connections.subscriber.on('message', this.onMessage);
  }

  private channel(channel: string): string {
    if (!channel) throw new Error('Pub/sub channel must not be empty');
    return `${this.settings.prefix}:events:${channel}`;
  }

  private readonly onMessage = (channel: string, raw: string): void => {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      this.logger.warn('Discarded malformed pub/sub message');
      return;
    }
    for (const listener of this.listeners.get(channel) ?? []) {
      void Promise.resolve()
        .then(() => listener(message))
        .catch(() => {
          this.logger.warn('Pub/sub listener failed');
        });
    }
  };

  private change<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.subscriptionChange.then(operation);
    this.subscriptionChange = result.catch(() => undefined);
    return result;
  }

  async publish(channel: string, message: unknown): Promise<number> {
    const serialized = JSON.stringify(message);
    if (serialized === undefined)
      throw new Error('Pub/sub message must be JSON serializable');
    return this.connections.publisher.publish(
      this.channel(channel),
      serialized,
    );
  }

  async subscribe(
    channel: string,
    listener: Listener,
  ): Promise<() => Promise<void>> {
    const name = this.channel(channel);
    // A distinct wrapper lets the same callback subscribe more than once safely.
    const local: Listener = (value) => listener(value);
    await this.change(async () => {
      let listeners = this.listeners.get(name);
      if (!listeners) {
        listeners = new Set();
        this.listeners.set(name, listeners);
        try {
          await this.connections.subscriber.subscribe(name);
        } catch (error) {
          this.listeners.delete(name);
          throw error;
        }
      }
      listeners.add(local);
    });
    return () =>
      this.change(async () => {
        const listeners = this.listeners.get(name);
        if (!listeners?.delete(local)) return;
        if (listeners.size === 0) {
          this.listeners.delete(name);
          await this.connections.subscriber.unsubscribe(name);
        }
      });
  }

  onModuleDestroy(): void {
    this.connections.subscriber.off('message', this.onMessage);
    this.listeners.clear();
  }
}
