import { describe, expect, it } from 'vitest';
import { channelConfig } from './index';

describe('channelConfig', () => {
  it('has operational settings for every channel and no static searches or schedules', () => {
    expect(Object.values(channelConfig)).toHaveLength(4);
    for (const config of Object.values(channelConfig)) {
      for (const key of ['keywords', 'locations', 'queries', 'terms'])
        expect(config.discovery).not.toHaveProperty(key);
      for (const key of ['schedule', 'enabled', 'initialLookbackHours'])
        expect(config).not.toHaveProperty(key);
    }
  });
});
